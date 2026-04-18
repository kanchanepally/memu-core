/**
 * Story 3.3a — verify a Solid-OIDC bearer access token.
 *
 * The Solid HTTP surface (Spaces over Solid protocol) is gated by
 * Solid-OIDC: every request carries an `Authorization: Bearer <jwt>` (or
 * `Authorization: DPoP <jwt>`) header. The token is a JWT signed by our
 * own provider's JWKS. We verify the signature locally — no DB round-trip
 * to oidc-provider's volatile token store — so the read path stays cheap
 * even when the token store has been cleared by a restart.
 *
 * What we extract: the `webid` claim (Solid-OIDC's first-class identity
 * claim, plumbed through accounts.ts at sign-in). We then look up the
 * Memu profile whose webid_slug matches the URL path of the WebID.
 *
 * What we DON'T do here:
 *   - DPoP proof verification (the HTTP-method/URL/body binding). That's
 *     a layer above this — when the spec strictness matters we'll add it
 *     in 3.3b along with write methods. Read-only access tolerates a
 *     plain bearer for early adopters.
 *   - Cross-issuer verification (tokens issued by external Solid IdPs).
 *     That's 3.3c (Solid client side); for now we only honour tokens we
 *     issued ourselves.
 *
 * Uses the nested oidc-provider/jose to avoid version skew with the
 * issuance side (see jwks.ts for the same pattern).
 */

import { pool } from '../db/connection';
import { resolveWebIdBaseUrl } from '../webid/webid';

// jwks is loaded lazily inside getKeySet() — it pulls in db/connection,
// which would force every importer of this module to have DATABASE_URL set.
// Pure helpers (extractBearerToken, parseWebIdSlug, BearerVerificationError,
// verifyDpopProof) stay importable without that.
import * as joseLib from 'jose';
type Jose = typeof import('jose');
function getJose(): Jose {
  return joseLib;
}

export interface VerifiedBearer {
  /** The webid claim from the access token (a full URL with #me fragment). */
  webid: string;
  /** webid_slug parsed from the WebID URL path. */
  slug: string;
  /** Memu profiles.id of the matching profile. */
  profileId: string;
  /** Display name + role, returned for convenience. */
  displayName: string;
  role: string;
  /**
   * JWK thumbprint from the access token's `cnf.jkt` claim, if the token
   * was issued as DPoP-bound. When present, the route handler MUST verify
   * the accompanying DPoP proof matches this thumbprint before accepting
   * the request — see verifyDpopProof.
   */
  cnfJkt?: string;
}

export class BearerVerificationError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
    this.name = 'BearerVerificationError';
  }
}

/**
 * Pull the bearer token out of `Authorization`. Accepts both `Bearer foo`
 * and `DPoP foo` — when DPoP proof verification lands we'll branch on the
 * scheme; for now we treat them as equivalent.
 */
export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = /^(Bearer|DPoP)\s+(.+)$/i.exec(authorization.trim());
  return m ? m[2].trim() : null;
}

let cachedKeySet: ReturnType<Jose['createLocalJWKSet']> | null = null;

async function getKeySet(): Promise<ReturnType<Jose['createLocalJWKSet']>> {
  if (cachedKeySet) return cachedKeySet;
  // Lazy import keeps the jwks → nested-jose chain off the module top level.
  const { loadOrCreateJwks } = await import('./jwks');
  const jwks = await loadOrCreateJwks();
  cachedKeySet = getJose().createLocalJWKSet({ keys: jwks.keys as any });
  return cachedKeySet;
}

/**
 * Reset the cached JWKS — exposed for tests and for the rare case where
 * the operator rotates the signing key without a restart.
 */
export function resetBearerCache(): void {
  cachedKeySet = null;
}

interface ProfileLookupRow {
  id: string;
  webid_slug: string | null;
  display_name: string;
  role: string;
}

/**
 * The webid claim is a URL like `https://family.memu.digital/people/hareesh#me`.
 * Parse out the slug from the `/people/<slug>` segment.
 */
export function parseWebIdSlug(webid: string): string | null {
  try {
    const url = new URL(webid);
    const m = /^\/people\/([^/]+)$/.exec(url.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

async function loadProfileBySlug(slug: string): Promise<ProfileLookupRow | null> {
  const res = await pool.query<ProfileLookupRow>(
    `SELECT id, webid_slug, display_name, role
       FROM profiles
      WHERE webid_slug = $1
      LIMIT 1`,
    [slug],
  );
  return res.rows[0] ?? null;
}

/**
 * Verify a bearer token. Throws BearerVerificationError on any failure.
 * The reason field is suitable for logging but not for response bodies —
 * keep error responses to the client opaque.
 */
export async function verifyBearer(token: string): Promise<VerifiedBearer> {
  const keySet = await getKeySet();
  const issuer = resolveWebIdBaseUrl();
  const expectedAudience = issuer; // resourceIndicators defaultResource = issuer

  let payload: Awaited<ReturnType<Jose['jwtVerify']>>['payload'];
  try {
    const result = await getJose().jwtVerify(token, keySet, {
      issuer,
      audience: expectedAudience,
    });
    payload = result.payload;
  } catch (err) {
    throw new BearerVerificationError('jwt_invalid', `JWT verification failed: ${(err as Error).message}`);
  }

  const webid = (payload as Record<string, unknown>).webid;
  if (typeof webid !== 'string' || webid.length === 0) {
    throw new BearerVerificationError('missing_webid', 'Access token has no webid claim');
  }

  const slug = parseWebIdSlug(webid);
  if (!slug) {
    throw new BearerVerificationError('invalid_webid', `Cannot parse slug from WebID: ${webid}`);
  }

  const profile = await loadProfileBySlug(slug);
  if (!profile) {
    throw new BearerVerificationError('unknown_profile', `No profile matches webid_slug ${slug}`);
  }

  const cnf = (payload as Record<string, unknown>).cnf as Record<string, unknown> | undefined;
  const cnfJkt = cnf && typeof cnf.jkt === 'string' ? cnf.jkt : undefined;

  return {
    webid,
    slug,
    profileId: profile.id,
    displayName: profile.display_name,
    role: profile.role,
    cnfJkt,
  };
}

/**
 * Verify a DPoP proof JWT (RFC 9449). The proof is a short-lived JWT in the
 * `DPoP` request header; it is signed with the same key whose JWK thumbprint
 * appears in the access token's `cnf.jkt` claim. Verification binds the
 * access token to the *holder* of that key, defeating bearer-token theft.
 *
 * Caller must supply:
 *   - htm: the request method (GET, POST, …) — case-insensitive comparison
 *   - htu: the request URI (without query/fragment per RFC 9449 §4.2)
 *   - accessToken (optional but recommended): when provided, we verify the
 *     proof's `ath` claim is base64url(SHA-256(accessToken))
 *   - expectedJkt (optional): when provided (typically from cnfJkt above),
 *     we verify the embedded JWK's thumbprint matches
 *
 * Returns the JWK thumbprint so the caller can record / compare it.
 *
 * Replay protection: we check `iat` is within ±maxAgeSeconds (default 60s)
 * and that `jti` is present. We do NOT yet maintain a jti replay cache —
 * adding one is a follow-up that needs a TTL store (Redis or pg). For now
 * the iat window is the practical brake.
 */
export async function verifyDpopProof(
  proofJwt: string,
  opts: { htm: string; htu: string; accessToken?: string; expectedJkt?: string; maxAgeSeconds?: number },
): Promise<{ jkt: string }> {
  const j = getJose();
  const maxAge = opts.maxAgeSeconds ?? 60;

  let header: Record<string, unknown>;
  try {
    header = j.decodeProtectedHeader(proofJwt) as Record<string, unknown>;
  } catch (err) {
    throw new BearerVerificationError('dpop_invalid_header', `DPoP header parse failed: ${(err as Error).message}`);
  }

  if (header.typ !== 'dpop+jwt') {
    throw new BearerVerificationError('dpop_wrong_typ', `DPoP proof typ must be dpop+jwt, got ${String(header.typ)}`);
  }
  const jwk = header.jwk as Record<string, unknown> | undefined;
  if (!jwk || typeof jwk !== 'object') {
    throw new BearerVerificationError('dpop_missing_jwk', 'DPoP proof header has no jwk');
  }
  const alg = typeof header.alg === 'string' ? header.alg : null;
  if (!alg) {
    throw new BearerVerificationError('dpop_missing_alg', 'DPoP proof header has no alg');
  }

  let payload: Record<string, unknown>;
  try {
    const key = await j.importJWK(jwk as unknown as Parameters<Jose['importJWK']>[0], alg);
    const result = await j.jwtVerify(proofJwt, key as unknown as Parameters<Jose['jwtVerify']>[1]);
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    throw new BearerVerificationError('dpop_signature_invalid', `DPoP signature invalid: ${(err as Error).message}`);
  }

  if (typeof payload.htm !== 'string' || payload.htm.toUpperCase() !== opts.htm.toUpperCase()) {
    throw new BearerVerificationError('dpop_htm_mismatch', `DPoP htm mismatch: expected ${opts.htm}, got ${String(payload.htm)}`);
  }
  if (typeof payload.htu !== 'string' || normalizeHtu(payload.htu) !== normalizeHtu(opts.htu)) {
    throw new BearerVerificationError('dpop_htu_mismatch', `DPoP htu mismatch: expected ${opts.htu}, got ${String(payload.htu)}`);
  }

  const iat = typeof payload.iat === 'number' ? payload.iat : null;
  if (iat === null) {
    throw new BearerVerificationError('dpop_missing_iat', 'DPoP proof has no iat');
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - iat) > maxAge) {
    throw new BearerVerificationError('dpop_iat_stale', `DPoP iat outside ±${maxAge}s window`);
  }

  if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
    throw new BearerVerificationError('dpop_missing_jti', 'DPoP proof has no jti');
  }

  if (opts.accessToken !== undefined) {
    const expectedAth = sha256Base64Url(opts.accessToken);
    if (payload.ath !== expectedAth) {
      throw new BearerVerificationError('dpop_ath_mismatch', 'DPoP ath does not match SHA-256 of access token');
    }
  }

  const jkt = await j.calculateJwkThumbprint(jwk as unknown as Parameters<Jose['calculateJwkThumbprint']>[0]);
  if (opts.expectedJkt !== undefined && jkt !== opts.expectedJkt) {
    throw new BearerVerificationError('dpop_jkt_mismatch', 'DPoP key thumbprint does not match access token cnf.jkt');
  }

  return { jkt };
}

/**
 * RFC 9449 §4.2 — htu is the target URI without query and fragment.
 * Compare both sides post-normalization so trailing-slash and case-in-host
 * differences don't trip us up.
 */
export function normalizeHtu(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return url;
  }
}

function sha256Base64Url(input: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(input).digest('base64url');
}
