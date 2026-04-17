/**
 * Story 1.6 — Account lookups for the Solid-OIDC provider.
 *
 * oidc-provider's findAccount contract: given an accountId (here, the
 * user's WebID), return an object that can emit claims. We map that to
 * the Memu profiles table and include the `webid` claim mandated by
 * Solid-OIDC — it's what clients use to discover which Pod the user
 * controls.
 *
 * Credentials: users log in with an email + password set via the login
 * flow. oidc_password_hash on the profiles row holds the bcrypt digest.
 * This is separate from the mobile-app API-key scheme because an OIDC
 * login is an interactive browser flow where the user types something.
 */

import bcrypt from 'bcryptjs';
import { pool } from '../db/connection';
import { buildWebId } from '../webid/webid';

export interface AccountClaims {
  sub: string;
  webid: string;
  name: string;
  email?: string;
  email_verified?: boolean;
}

interface ProfileRow {
  id: string;
  webid_slug: string | null;
  display_name: string;
  email: string | null;
  role: string;
  oidc_password_hash: string | null;
}

/**
 * oidc-provider's Account shape. The `claims` function is called with
 * the requested scope set; we deliberately return the full set every
 * time, because the scopes we emit — openid, profile, email, webid — are
 * all low-risk and consistent with Solid-OIDC expectations.
 */
export interface OidcAccount {
  accountId: string;
  claims(): Promise<AccountClaims>;
}

async function loadBySubject(subject: string): Promise<ProfileRow | null> {
  const res = await pool.query<ProfileRow>(
    `SELECT id, webid_slug, display_name, email, role, oidc_password_hash
       FROM profiles
      WHERE oidc_subject = $1 OR id = $1
      LIMIT 1`,
    [subject],
  );
  return res.rows[0] ?? null;
}

async function loadByEmail(email: string): Promise<ProfileRow | null> {
  const res = await pool.query<ProfileRow>(
    `SELECT id, webid_slug, display_name, email, role, oidc_password_hash
       FROM profiles
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [email],
  );
  return res.rows[0] ?? null;
}

function toAccount(row: ProfileRow): OidcAccount {
  const slug = row.webid_slug ?? row.id;
  const webid = buildWebId(slug);
  return {
    accountId: row.id,
    async claims(): Promise<AccountClaims> {
      return {
        sub: webid,
        webid,
        name: row.display_name,
        email: row.email ?? undefined,
        email_verified: row.email ? true : false,
      };
    },
  };
}

/**
 * Invoked by oidc-provider on every token/userinfo call. Return undefined
 * to signal an unknown account (oidc-provider then refuses the request).
 */
export async function findAccountByAccountId(accountId: string): Promise<OidcAccount | undefined> {
  const row = await loadBySubject(accountId);
  return row ? toAccount(row) : undefined;
}

/**
 * Login form handler — verifies the user's email + password and returns
 * the accountId (profile id) for oidc-provider's interaction result.
 */
export async function authenticateWithPassword(email: string, password: string): Promise<string | null> {
  if (!email || !password) return null;
  const row = await loadByEmail(email);
  if (!row || !row.oidc_password_hash) return null;
  const ok = await bcrypt.compare(password, row.oidc_password_hash);
  return ok ? row.id : null;
}

/**
 * Let an authenticated user set or rotate their OIDC password. Used by
 * the mobile-app Settings screen once the API-key auth has verified them.
 */
export async function setOidcPassword(profileId: string, password: string): Promise<void> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(`UPDATE profiles SET oidc_password_hash = $1 WHERE id = $2`, [hash, profileId]);
}
