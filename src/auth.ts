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

/**
 * Register a new profile. Returns the profile with API key.
 */
export async function registerProfile(displayName: string, email: string, role: string = 'adult', familyNames: string = '') {
  // SINGLE-TENANT MVP: Return the primary profile if it exists to keep mobile and web perfectly synced.
  const existingRes = await pool.query('SELECT id, display_name, email, role, api_key, created_at FROM profiles ORDER BY created_at ASC LIMIT 1');
  if (existingRes.rowCount > 0 && existingRes.rows[0]) {
    return existingRes.rows[0];
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
  const personaId = `${role}-${Date.now()}`;
  const personaLabel = role === 'child' ? `Child-${profile.id.slice(0, 4)}` : `Adult-${profile.id.slice(0, 4)}`;
  await pool.query(
    'INSERT INTO personas (id, profile_id, persona_label) VALUES ($1, $2, $3)',
    [personaId, profile.id, personaLabel]
  );

  // Add the registering user to the entity_registry securely
  await pool.query(
    `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by)
     VALUES ('person', $1, $2, 'onboarding') ON CONFLICT DO NOTHING`,
    [displayName.trim(), role === 'child' ? `Child-0` : `Adult-0`]
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
