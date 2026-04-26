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
 * Resolve a Google sign-in to a Memu profile. Multi-profile aware:
 *
 *   1. If a profile with this email already exists → return it. (Rach signs
 *      in on her own device → finds her profile that the household admin
 *      previously invited.)
 *
 *   2. Else if there's a primary profile with NO recorded email yet → adopt
 *      this email onto the primary. (Bootstrap continuity: Hareesh signed
 *      in once before email was recorded; later sign-ins still find him.)
 *
 *   3. Else if the database is completely empty → create the primary profile
 *      from the Google identity. (First-boot.)
 *
 *   4. Otherwise → reject. The household has profiles, this email isn't one
 *      of them, and we don't auto-register strangers via Google sign-in. The
 *      household admin must explicitly invite via POST /api/profiles. This is
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
  // Step 1 — exact email match.
  if (identity.email) {
    const byEmail = await pool.query(
      'SELECT id, display_name, email, role, api_key, created_at FROM profiles WHERE email = $1 LIMIT 1',
      [identity.email]
    );
    if (byEmail.rowCount && byEmail.rows[0]) {
      return byEmail.rows[0];
    }
  }

  // Step 2 — adopt email onto primary if it has none yet.
  const primary = await pool.query(
    'SELECT id, display_name, email, role, api_key, created_at FROM profiles ORDER BY created_at ASC LIMIT 1'
  );
  if (primary.rowCount && primary.rows[0]) {
    const profile = primary.rows[0];
    if (!profile.email && identity.email) {
      await pool.query('UPDATE profiles SET email = $1 WHERE id = $2', [identity.email, profile.id]);
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

  // Step 3 — first boot: create the primary profile.
  const apiKey = generateApiKey();
  const inserted = await pool.query(
    `INSERT INTO profiles (display_name, email, role, api_key)
       VALUES ($1, $2, 'adult', $3)
     RETURNING id, display_name, email, role, api_key, created_at`,
    [identity.name, identity.email, apiKey]
  );
  const profile = inserted.rows[0];

  const personaId = `adult-${Date.now()}-${profile.id.slice(0, 4)}`;
  await pool.query(
    'INSERT INTO personas (id, profile_id, persona_label) VALUES ($1, $2, $3)',
    [personaId, profile.id, `Adult-${profile.id.slice(0, 4)}`]
  );
  await pool.query(
    `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by)
       VALUES ('person', $1, $2, 'google_signin')
     ON CONFLICT DO NOTHING`,
    [identity.name.trim(), `Adult-${profile.id.slice(0, 4)}`]
  );

  return profile;
}
