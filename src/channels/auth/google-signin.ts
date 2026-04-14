import { OAuth2Client } from 'google-auth-library';
import { pool } from '../../db/connection';
import { generateApiKey } from '../../auth';

/**
 * Google Sign-In (OIDC) — verifies an ID token minted by Google on the mobile
 * client and maps it to a Memu profile. Single-tenant MVP: the first profile
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
 * Single-tenant resolver: return the primary profile, creating it from the
 * Google identity if the DB is empty. Returns the profile (including api_key)
 * for the client to store.
 */
export async function signInWithGoogle(identity: GoogleIdentity) {
  const existing = await pool.query(
    'SELECT id, display_name, email, role, api_key, created_at FROM profiles ORDER BY created_at ASC LIMIT 1'
  );
  if (existing.rowCount && existing.rows[0]) {
    const profile = existing.rows[0];
    // Opportunistically stamp the Google email onto the primary profile if it
    // hasn't been recorded yet — useful for future multi-tenant migration.
    if (!profile.email && identity.email) {
      await pool.query('UPDATE profiles SET email = $1 WHERE id = $2', [identity.email, profile.id]);
      profile.email = identity.email;
    }
    return profile;
  }

  const apiKey = generateApiKey();
  const inserted = await pool.query(
    `INSERT INTO profiles (display_name, email, role, api_key)
       VALUES ($1, $2, 'adult', $3)
     RETURNING id, display_name, email, role, api_key, created_at`,
    [identity.name, identity.email, apiKey]
  );
  const profile = inserted.rows[0];

  // Default persona and entity registry entry, same as registerProfile()
  const personaId = `adult-${Date.now()}`;
  await pool.query(
    'INSERT INTO personas (id, profile_id, persona_label) VALUES ($1, $2, $3)',
    [personaId, profile.id, `Adult-${profile.id.slice(0, 4)}`]
  );
  await pool.query(
    `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by)
       VALUES ('person', $1, 'Adult-0', 'google_signin')
     ON CONFLICT DO NOTHING`,
    [identity.name.trim()]
  );

  return profile;
}
