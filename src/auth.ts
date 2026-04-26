import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { pool } from './db/connection';

/**
 * Generate a secure API key for a new profile.
 * Format: memu_<32 hex chars> — easy to identify in logs.
 */
export function generateApiKey(): string {
  return `memu_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Look up a profile by API key. Returns the profile row or null.
 */
export async function getProfileByApiKey(apiKey: string) {
  const res = await pool.query(
    'SELECT id, display_name, role, email, ai_model, daily_query_limit FROM profiles WHERE api_key = $1',
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

export interface RegisterProfileOptions {
  /**
   * When true (default), the call short-circuits to the primary profile if
   * one already exists. This preserves the original single-tenant behaviour
   * for the public /api/register endpoint — first user creates the household,
   * subsequent calls are idempotent.
   *
   * When false, the call ALWAYS creates a fresh profile. Used by the
   * admin-driven /api/profiles endpoint to invite additional household
   * members (Rach, Robin, etc.) into the same Memu instance.
   */
  allowExisting?: boolean;
}

/**
 * Register a new profile. Returns the profile with API key.
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
    // return it instead of creating a duplicate. Keeps the original
    // single-tenant behaviour for the bootstrap flow.
    const existingRes = await pool.query(
      'SELECT id, display_name, email, role, api_key, created_at FROM profiles ORDER BY created_at ASC LIMIT 1'
    );
    if (existingRes.rowCount && existingRes.rowCount > 0 && existingRes.rows[0]) {
      return existingRes.rows[0];
    }
  }

  const apiKey = generateApiKey();

  const res = await pool.query(
    `INSERT INTO profiles (display_name, email, role, api_key)
     VALUES ($1, $2, $3, $4)
     RETURNING id, display_name, email, role, api_key, created_at`,
    [displayName, email, role, apiKey]
  );

  const profile = res.rows[0];

  // Create a default persona for the profile
  const personaId = `${role}-${Date.now()}-${profile.id.slice(0, 4)}`;
  const personaLabel = role === 'child' ? `Child-${profile.id.slice(0, 4)}` : `Adult-${profile.id.slice(0, 4)}`;
  await pool.query(
    'INSERT INTO personas (id, profile_id, persona_label) VALUES ($1, $2, $3)',
    [personaId, profile.id, personaLabel]
  );

  // Add the registering user to the entity_registry securely.
  // Use a unique anonymous_label per profile (incorporating profile id slice)
  // so multiple registrations don't collide on the legacy `Adult-0` / `Child-0`
  // labels.
  const entityLabel = role === 'child'
    ? `Child-${profile.id.slice(0, 4)}`
    : `Adult-${profile.id.slice(0, 4)}`;
  await pool.query(
    `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by)
     VALUES ('person', $1, $2, 'onboarding') ON CONFLICT DO NOTHING`,
    [displayName.trim(), entityLabel]
  );

  // Add any explicitly declared family members to the registry
  if (familyNames) {
    const names = familyNames.split(',').map(n => n.trim()).filter(Boolean);
    for (let i = 0; i < names.length; i++) {
      await pool.query(
        `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by)
         VALUES ('person', $1, $2, 'onboarding') ON CONFLICT DO NOTHING`,
        [names[i], `Family-${Date.now()}-${i}`]
      );
    }
  }

  return profile;
}
