import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { pool } from '../../db/connection';
import { db, enterCollectiveContext } from '../../db/tenant';
import { generateApiKey } from '../../auth';

/**
 * Google Sign-In (OIDC) — verifies an ID token minted by Google on the mobile
 * client and maps it to a Memu profile. Single-collective MVP: the first profile
 * in the DB is always returned, so web + mobile share the same data.
 *
 * Env:
 *   GOOGLE_CLIENT_ID           — canonical server-side client ID (audience check)
 *   GOOGLE_IOS_CLIENT_ID       — optional, accepted as alternate audience
 *   GOOGLE_ANDROID_CLIENT_ID   — optional, accepted as alternate audience
 *   GOOGLE_WEB_CLIENT_ID       — optional, accepted as alternate audience
 */
const AUDIENCES = [
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
  process.env.GOOGLE_WEB_CLIENT_ID,
].filter(Boolean) as string[];

const verifier = new OAuth2Client();

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (AUDIENCES.length === 0) {
    throw new Error('No GOOGLE_CLIENT_ID configured on the server');
  }
  const ticket = await verifier.verifyIdToken({
    idToken,
    audience: AUDIENCES,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Invalid Google ID token');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture,
  };
}

/**
 * Resolve a Google sign-in to a Memu profile. Multi-profile aware:
 *
 *   1. If a profile with this email already exists → return it. (Rach signs
 *      in on her own device → finds her profile that the collective admin
 *      previously invited.)
 *
 *   2. Else if there's a primary profile with NO recorded email yet → adopt
 *      this email onto the primary. (Bootstrap continuity: Hareesh signed
 *      in once before email was recorded; later sign-ins still find him.)
 *
 *   3. Else if the database is completely empty → create the primary profile
 *      from the Google identity. (First-boot.)
 *
 *   4. Otherwise → reject. The collective has profiles, this email isn't one
 *      of them, and we don't auto-register strangers via Google sign-in. The
 *      collective admin must explicitly invite via POST /api/profiles. This is
 *      the structural privacy boundary — sign-in is authentication, not a
 *      registration backdoor.
 */
export class GoogleSignInRejected extends Error {
  constructor(public reason: 'no_invite' | 'invalid_token', message: string) {
    super(message);
    this.name = 'GoogleSignInRejected';
  }
}

export async function signInWithGoogle(identity: GoogleIdentity) {
  // Step 1 — exact email match. queryAsBootstrap so the Tier-B
  // permissive policy on profiles allows the cross-collective lookup
  // before any collective context is set. (Without bootstrap, this
  // returns zero rows even though the row exists — the policy is
  // strict by default.)
  //
  // Multi-Collective Membership spec, Story 2.2: role now lives on
  // collective_memberships, not profiles. We hydrate it from there
  // (status='active' scoped to the profile's home collective) so the
  // return shape stays compatible with the pre-spec callers.
  if (identity.email) {
    const byEmail = await db.queryAsBootstrap(
      `SELECT p.id, p.display_name, p.email, p.api_key, p.collective_id, p.created_at,
              cm.role
         FROM profiles p
         LEFT JOIN collective_memberships cm
           ON cm.profile_id = p.id
          AND cm.collective_id = p.collective_id
          AND cm.status = 'active'
        WHERE p.email = $1
        LIMIT 1`,
      [identity.email]
    );
    if (byEmail.rowCount && byEmail.rows[0]) {
      return byEmail.rows[0];
    }
  }

  // Step 2 — adopt email onto primary if it has none yet.
  const primary = await db.queryAsBootstrap(
    `SELECT p.id, p.display_name, p.email, p.api_key, p.collective_id, p.created_at,
            cm.role
       FROM profiles p
       LEFT JOIN collective_memberships cm
         ON cm.profile_id = p.id
        AND cm.collective_id = p.collective_id
        AND cm.status = 'active'
      ORDER BY p.created_at ASC
      LIMIT 1`
  );
  if (primary.rowCount && primary.rows[0]) {
    const profile = primary.rows[0];
    if (!profile.email && identity.email) {
      // The UPDATE here is on the profile we just bootstrap-read.
      // It still requires collective_id match in the FOR ALL policy's
      // USING/WITH CHECK — but the collective IS this profile's own,
      // so we enter that collective's context for the write.
      await enterCollectiveContext(profile.collective_id, async () => {
        await db.query('UPDATE profiles SET email = $1 WHERE id = $2', [identity.email, profile.id]);
      });
      profile.email = identity.email;
      return profile;
    }
    // A primary exists, has its own email, and this Google email isn't a
    // known profile. Reject — the admin must invite first.
    throw new GoogleSignInRejected(
      'no_invite',
      `No Memu profile invited for ${identity.email}. Ask your household admin to invite you in Settings → Household.`
    );
  }

  // Step 3 — first boot: create the primary profile + a fresh collective
  // for it.
  //
  // Pre-Beta Stream 1: this is structurally the same flow as
  // registerProfile()'s "no options.collectiveId" branch — create a
  // collective ex nihilo, atomically with its first profile, dealing
  // with the circular FK via deferred constraints (migration 026).
  // Delegate to the same helper rather than duplicate the transaction
  // shape. The 'detected_by' marker on the entity_registry self-row
  // is the only thing that would differ from registerProfile's
  // version, and a mismatch there isn't worth a bespoke transaction.
  const apiKey = generateApiKey();
  const collectiveId = crypto.randomUUID();
  const collectiveName = (identity.name?.trim() || 'Household') + "'s household";

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('memu.collective_id', $1, true)", [collectiveId]);

    // Profile first (deferred FK lets it reference the not-yet-created collective).
    //
    // Multi-Collective Membership spec, Story 2.2: profiles.role is
    // retired. The role for this person in their primary Collective
    // is recorded on collective_memberships (below), which is the
    // single source of truth.
    const profileRes = await client.query(
      `INSERT INTO profiles (display_name, email, api_key, collective_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, display_name, email, api_key, collective_id, created_at`,
      [identity.name, identity.email, apiKey, collectiveId],
    );
    const profile = profileRes.rows[0];

    // Collective second (FK to profiles satisfied — profile exists now).
    await client.query(
      `INSERT INTO collectives (id, type, name, primary_admin_profile_id)
       VALUES ($1, 'household', $2, $3)`,
      [collectiveId, collectiveName, profile.id],
    );

    // Membership — the relationship row that carries the role.
    // First-boot Google sign-in lands the new admin as 'adult'; the
    // collective's primary_admin_profile_id (above) marks the
    // ownership axis separately from the role axis.
    await client.query(
      `INSERT INTO collective_memberships (collective_id, profile_id, role, status)
       VALUES ($1, $2, 'adult', 'active')`,
      [collectiveId, profile.id],
    );

    const personaId = `adult-${Date.now()}-${profile.id.slice(0, 4)}`;
    await client.query(
      'INSERT INTO personas (id, profile_id, persona_label, collective_id) VALUES ($1, $2, $3, $4)',
      [personaId, profile.id, `Adult-${profile.id.slice(0, 4)}`, collectiveId],
    );
    await client.query(
      `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by, collective_id)
       VALUES ('person', $1, $2, 'google_signin', $3) ON CONFLICT DO NOTHING`,
      [identity.name.trim(), `Adult-${profile.id.slice(0, 4)}`, collectiveId],
    );

    await client.query('COMMIT');
    // Hydrate the role onto the returned shape so callers that read
    // `.role` keep working. The DB no longer carries it on profiles —
    // we know it's 'adult' because we just inserted it on the
    // membership row above.
    return { ...profile, role: 'adult' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
