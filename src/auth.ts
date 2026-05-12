import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { pool } from './db/connection';
import { bindCollectiveContext, db } from './db/tenant';

/**
 * Generate a secure API key for a new profile.
 * Format: memu_<32 hex chars> — easy to identify in logs.
 */
export function generateApiKey(): string {
  return `memu_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Look up a profile by API key. Returns the profile row or null.
 *
 * Pre-Beta Stream 1 — uses queryAsBootstrap so the Tier-B permissive
 * policy on profiles allows the read before any collective context is
 * known. The match is by api_key (32-byte random secret) so the read
 * surfaces exactly one row regardless of how many collectives share
 * the deployment.
 */
export async function getProfileByApiKey(apiKey: string) {
  const res = await db.queryAsBootstrap(
    'SELECT id, display_name, role, email, ai_model, daily_query_limit, collective_id FROM profiles WHERE api_key = $1',
    [apiKey]
  );
  return res.rows[0] || null;
}

/**
 * Fastify preHandler hook that enforces API key auth.
 * Attaches `request.profileId` and `request.profile` for downstream use.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing or invalid Authorization header' });
  }

  const apiKey = authHeader.slice(7); // Strip "Bearer "
  const profile = await getProfileByApiKey(apiKey);

  if (!profile) {
    return reply.code(401).send({ error: 'Invalid API key' });
  }

  // Attach to request for downstream route handlers
  (request as any).profileId = profile.id;
  (request as any).profile = profile;
}

/**
 * Pre-Beta Stream 1 — collective resolution.
 *
 * Runs after requireAuth. Loads the profile's collective, blocks any
 * request against a collective pending GDPR erasure (Stream 3), and
 * attaches `request.collectiveId` for tenant-scoped queries.
 *
 * Uses raw pool.query because:
 *   - profiles has a permissive RLS policy that allows reads when no
 *     collective context is set (which is the case here — we're trying
 *     to figure out which context to set).
 *   - collectives has no RLS at all (Tier-C — global table).
 */
export async function requireCollective(request: FastifyRequest, reply: FastifyReply) {
  const profileId = (request as any).profileId as string | undefined;
  if (!profileId) {
    return reply.code(500).send({ error: 'requireCollective called before requireAuth' });
  }

  // queryAsBootstrap so the join with profiles works before collective
  // context is set. collectives is Tier-C (no RLS) so it doesn't need
  // bootstrap; profiles needs it.
  const result = await db.queryAsBootstrap<{
    collective_id: string;
    pending_deletion_at: Date | null;
    status: string;
  }>(
    `SELECT p.collective_id, h.pending_deletion_at, h.status
       FROM profiles p
       JOIN collectives h ON h.id = p.collective_id
      WHERE p.id = $1`,
    [profileId],
  );

  const row = result.rows[0];
  if (!row) {
    return reply.code(403).send({ error: 'no_household' });
  }
  if (row.status !== 'active') {
    return reply.code(403).send({ error: 'household_inactive', status: row.status });
  }
  if (row.pending_deletion_at) {
    return reply.code(410).send({
      error: 'household_pending_deletion',
      scheduled_deletion_at: row.pending_deletion_at,
      can_cancel: true,
    });
  }

  (request as any).collectiveId = row.collective_id;

  // Enter the AsyncLocalStorage tenant context for the rest of this
  // request. Every db.query / db.transaction call from here on
  // (including inside the route handler and fire-and-forget chains)
  // sees this collective and runs inside an RLS-gated transaction.
  bindCollectiveContext(row.collective_id);
}

export interface RegisterProfileOptions {
  /**
   * When true (default), the call short-circuits to the primary profile if
   * one already exists. This preserves the original single-tenant behaviour
   * for the public /api/register endpoint — first user creates the collective,
   * subsequent calls are idempotent.
   *
   * When false, the call ALWAYS creates a fresh profile. Used by the
   * admin-driven /api/profiles endpoint to invite additional collective
   * members (Rach, Robin, etc.) into the same Memu instance.
   */
  allowExisting?: boolean;

  /**
   * Pre-Beta Stream 1 — collective placement.
   *
   * When set, the new profile joins this collective instead of becoming
   * a primary admin of a fresh one. Used by the magic-link invite flow
   * to add a member to the inviter's collective.
   *
   * When unset (default), registerProfile creates a new collective with
   * this profile as the primary admin.
   */
  collectiveId?: string;
}

/**
 * Public entry point for profile registration.
 *
 * Two structurally distinct flows live behind this dispatcher:
 *
 *   - **registerPrimaryCollectiveAndProfile** — `options.collectiveId`
 *     is unset. Creates a fresh collective AND its first (primary)
 *     profile in one transaction. Has the circular-FK problem:
 *     profile.collective_id ↔ collective.primary_admin_profile_id.
 *     Both FKs are DEFERRABLE INITIALLY DEFERRED (migration 026)
 *     so the COMMIT validates them after both rows exist.
 *
 *   - **inviteProfileToExistingCollective** — `options.collectiveId`
 *     is set. Adds a profile to a pre-existing collective. No
 *     circular FK because the collective already exists; the
 *     INSERT references it normally. Caller must already be inside
 *     that collective's context (the admin's authenticated request).
 *
 * The flows do NOT share INSERT logic. Each owns its own transaction
 * shape. Unifying them masks the distinction that makes the bootstrap
 * tractable: one creates ex nihilo, the other extends.
 *
 * The legacy `allowExisting` backstop (the public /api/register
 * route's original "if any profile exists, return it" behaviour)
 * runs before either flow.
 */
export async function registerProfile(
  displayName: string,
  email: string,
  role: string = 'adult',
  familyNames: string = '',
  options: RegisterProfileOptions = {},
) {
  const allowExisting = options.allowExisting !== false; // default true

  if (allowExisting) {
    // First-boot / public-register backstop: if a profile already exists,
    // return it instead of creating a duplicate. queryAsBootstrap so the
    // Tier-B policy permits the cross-collective read.
    const existingRes = await db.queryAsBootstrap(
      'SELECT id, display_name, email, role, api_key, collective_id, created_at FROM profiles ORDER BY created_at ASC LIMIT 1'
    );
    if (existingRes.rowCount && existingRes.rowCount > 0 && existingRes.rows[0]) {
      return existingRes.rows[0];
    }
  }

  if (options.collectiveId) {
    return inviteProfileToExistingCollective(
      options.collectiveId, displayName, email, role,
    );
  }

  return registerPrimaryCollectiveAndProfile(displayName, email, role, familyNames);
}

/**
 * Flow A — create a fresh collective and its first (primary) profile.
 *
 * The transaction structure deals with the circular-FK problem:
 *   1. Pre-generate collective_id as TEXT in JS so we can specify it
 *      on both INSERTs.
 *   2. SET LOCAL memu.collective_id = pre_generated so the WITH CHECK
 *      on profiles_write passes the soon-to-be-inserted profile row.
 *   3. INSERT the profile referencing the not-yet-existing collective
 *      (FK deferred — see migration 026).
 *   4. INSERT the collective referencing the just-created profile
 *      (FK satisfied immediately).
 *   5. INSERT persona + entity_registry rows (collective_id = the
 *      pre-generated value, picked up by their DEFAULT clause too).
 *   6. COMMIT — deferred FK on profiles.collective_id validates
 *      against the now-existing collective.
 *
 * Uses pool.connect() directly because we need transaction-local
 * SET LOCAL of the collective_id session variable to a value that
 * isn't yet known to any AsyncLocalStorage context.
 */
async function registerPrimaryCollectiveAndProfile(
  displayName: string,
  email: string,
  role: string,
  familyNames: string,
) {
  const apiKey = generateApiKey();
  const collectiveId = crypto.randomUUID();
  const collectiveName = (displayName?.trim() || 'Household') + "'s household";

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Set the RLS session variable to the pre-generated collective id
    // so the profiles_write WITH CHECK passes for the INSERT below.
    // SET LOCAL — discarded on COMMIT, doesn't leak when the connection
    // returns to the pool.
    await client.query("SELECT set_config('memu.collective_id', $1, true)", [collectiveId]);

    // Profile insert — collective_id points at the not-yet-existing
    // collective. Deferred FK lets this through; validated at COMMIT.
    const profileRes = await client.query(
      `INSERT INTO profiles (display_name, email, role, api_key, collective_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, display_name, email, role, api_key, collective_id, created_at`,
      [displayName, email, role, apiKey, collectiveId],
    );
    const profile = profileRes.rows[0];

    // Collective insert — primary_admin_profile_id references the
    // profile we just created (no FK violation). collectives is Tier-C,
    // so no RLS gates this write.
    await client.query(
      `INSERT INTO collectives (id, type, name, primary_admin_profile_id)
       VALUES ($1, 'household', $2, $3)`,
      [collectiveId, collectiveName, profile.id],
    );

    // Persona — collective_id matches the active session variable, so
    // profiles_write WITH CHECK passes. (personas is Tier-A; same
    // policy shape as everything else.)
    const personaId = `${role}-${Date.now()}-${profile.id.slice(0, 4)}`;
    const personaLabel = role === 'child' ? `Child-${profile.id.slice(0, 4)}` : `Adult-${profile.id.slice(0, 4)}`;
    await client.query(
      'INSERT INTO personas (id, profile_id, persona_label, collective_id) VALUES ($1, $2, $3, $4)',
      [personaId, profile.id, personaLabel, collectiveId],
    );

    // entity_registry self-row.
    const entityLabel = role === 'child'
      ? `Child-${profile.id.slice(0, 4)}`
      : `Adult-${profile.id.slice(0, 4)}`;
    await client.query(
      `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by, collective_id)
       VALUES ('person', $1, $2, 'onboarding', $3) ON CONFLICT DO NOTHING`,
      [displayName.trim(), entityLabel, collectiveId],
    );

    // Declared family members — onboarding-time pre-population of
    // entity_registry. Same collective_id.
    if (familyNames) {
      const names = familyNames.split(',').map(n => n.trim()).filter(Boolean);
      for (let i = 0; i < names.length; i++) {
        await client.query(
          `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by, collective_id)
           VALUES ('person', $1, $2, 'onboarding', $3) ON CONFLICT DO NOTHING`,
          [names[i], `Family-${Date.now()}-${i}`, collectiveId],
        );
      }
    }

    await client.query('COMMIT');
    return profile;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Flow B — add a profile to an existing collective.
 *
 * Structurally simpler than Flow A: the collective already exists, so
 * there's no circular FK and the deferred-constraint mechanism isn't
 * exercised. The new profile's collective_id references an existing
 * row; the INSERT satisfies the FK immediately.
 *
 * Caller must already be inside the target collective's context — the
 * admin's authenticated request, which has gone through requireAuth +
 * requireCollective and therefore has memu.collective_id = collectiveId
 * already set in AsyncLocalStorage. The validation at the top
 * confirms this contract; if the caller is in a different collective
 * (or no collective), we throw rather than silently creating a profile
 * the caller can't see.
 */
async function inviteProfileToExistingCollective(
  collectiveId: string,
  displayName: string,
  email: string,
  role: string,
) {
  const apiKey = generateApiKey();

  return db.transaction(async (client) => {
    // Verify the collective exists and is active. collectives is Tier-C,
    // no RLS, so this read works even if the caller's context is
    // somehow not yet set.
    const hhRes = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM collectives WHERE id = $1',
      [collectiveId],
    );
    if (hhRes.rowCount === 0) {
      throw new Error(`inviteProfileToExistingCollective: collective not found: ${collectiveId}`);
    }
    if (hhRes.rows[0].status !== 'active') {
      throw new Error(`inviteProfileToExistingCollective: collective not active: ${collectiveId}`);
    }

    // Profile insert. profiles_write WITH CHECK requires collective_id
    // = active context — db.transaction picked up the active context
    // from AsyncLocalStorage, so this works as long as the caller is
    // inside the same collective's context. If the caller's context is
    // a DIFFERENT collective, the INSERT is rejected by the WITH CHECK
    // (defence-in-depth: caller can't invite into a collective they
    // don't belong to).
    const profileRes = await client.query(
      `INSERT INTO profiles (display_name, email, role, api_key, collective_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, display_name, email, role, api_key, collective_id, created_at`,
      [displayName, email, role, apiKey, collectiveId],
    );
    const profile = profileRes.rows[0];

    const personaId = `${role}-${Date.now()}-${profile.id.slice(0, 4)}`;
    const personaLabel = role === 'child' ? `Child-${profile.id.slice(0, 4)}` : `Adult-${profile.id.slice(0, 4)}`;
    await client.query(
      'INSERT INTO personas (id, profile_id, persona_label, collective_id) VALUES ($1, $2, $3, $4)',
      [personaId, profile.id, personaLabel, collectiveId],
    );

    const entityLabel = role === 'child'
      ? `Child-${profile.id.slice(0, 4)}`
      : `Adult-${profile.id.slice(0, 4)}`;
    await client.query(
      `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by, collective_id)
       VALUES ('person', $1, $2, 'onboarding', $3) ON CONFLICT DO NOTHING`,
      [displayName.trim(), entityLabel, collectiveId],
    );

    return profile;
  });
}
