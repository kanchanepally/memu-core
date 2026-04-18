/**
 * Story 1.6 — JWKS management for the Solid-OIDC provider.
 *
 * oidc-provider needs an asymmetric signing key for issuing id_tokens.
 * We generate an RSA keypair on first boot and persist the JWK form in
 * Postgres so tokens remain verifiable across restarts.
 *
 * The `jose` library is used for JWK generation and thumbprint calculation.
 * We import it directly as it is a top-level dependency in package.json.
 */

import { pool } from '../db/connection';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jose = require('jose') as typeof import('jose');

export interface Jwks {
  keys: import('jose').JWK[];
}

/**
 * Load the persisted JWKS, or generate one and persist it on first boot.
 * Idempotent — concurrent boots race-safely land on the same keyset
 * because of the `ON CONFLICT DO NOTHING` upsert.
 */
export async function loadOrCreateJwks(): Promise<Jwks> {
  const existing = await pool.query(
    `SELECT jwks FROM oidc_jwks WHERE key = 'current' LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].jwks as Jwks;
  }

  const { privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
  const jwk = await jose.exportJWK(privateKey);
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  // Stable key id so tokens signed with this key remain verifiable
  // after a restart even if the in-memory Provider re-loads the JWKS.
  jwk.kid = await jose.calculateJwkThumbprint(jwk);

  const jwks: Jwks = { keys: [jwk] };
  await pool.query(
    `INSERT INTO oidc_jwks (key, jwks) VALUES ('current', $1) ON CONFLICT (key) DO NOTHING`,
    [jwks],
  );

  // Re-read in case a concurrent boot beat us to the insert.
  const final = await pool.query(`SELECT jwks FROM oidc_jwks WHERE key = 'current' LIMIT 1`);
  return final.rows[0].jwks as Jwks;
}
