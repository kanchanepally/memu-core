import { describe, it, expect } from 'vitest';
import { extractBearerToken, parseWebIdSlug, BearerVerificationError, normalizeHtu, verifyDpopProof } from './bearer';
import { createHash, randomUUID } from 'crypto';
import { generateKeyPair, SignJWT, exportJWK, calculateJwkThumbprint } from 'jose';

describe('extractBearerToken', () => {
  it('returns null when the header is missing', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('extracts a Bearer token', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('extracts a DPoP-scheme token (treated as bearer until DPoP proof check lands)', () => {
    expect(extractBearerToken('DPoP eyJ0.eyJp.sig')).toBe('eyJ0.eyJp.sig');
  });

  it('is case-insensitive on the scheme name', () => {
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('dpop xyz')).toBe('xyz');
  });

  it('trims surrounding whitespace', () => {
    expect(extractBearerToken('  Bearer   token-value  ')).toBe('token-value');
  });

  it('returns null for unsupported schemes', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('returns null when the scheme has no token after it', () => {
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});

describe('parseWebIdSlug', () => {
  it('extracts the slug from /people/<slug>', () => {
    expect(parseWebIdSlug('https://family.test/people/hareesh#me')).toBe('hareesh');
  });

  it('handles WebIDs without a fragment', () => {
    expect(parseWebIdSlug('https://family.test/people/rach')).toBe('rach');
  });

  it('decodes URL-encoded slugs', () => {
    expect(parseWebIdSlug('https://family.test/people/name%20with%20space#me')).toBe('name with space');
  });

  it('returns null for paths that do not match /people/<slug>', () => {
    expect(parseWebIdSlug('https://family.test/profile/hareesh#me')).toBeNull();
    expect(parseWebIdSlug('https://family.test/people/hareesh/extra#me')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(parseWebIdSlug('not a url at all')).toBeNull();
    expect(parseWebIdSlug('')).toBeNull();
  });
});

describe('BearerVerificationError', () => {
  it('preserves a structured reason for logging', () => {
    const err = new BearerVerificationError('jwt_invalid', 'JWT verification failed: signature');
    expect(err.reason).toBe('jwt_invalid');
    expect(err.message).toContain('signature');
    expect(err.name).toBe('BearerVerificationError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('normalizeHtu', () => {
  it('strips query and fragment per RFC 9449 §4.2', () => {
    expect(normalizeHtu('https://example.test/spaces/person/robin?ext=acp#me'))
      .toBe('https://example.test/spaces/person/robin');
  });

  it('preserves trailing slash', () => {
    expect(normalizeHtu('https://example.test/spaces/person/'))
      .toBe('https://example.test/spaces/person/');
  });

  it('returns input unchanged on parse failure', () => {
    expect(normalizeHtu('not a url')).toBe('not a url');
  });
});

describe('verifyDpopProof', () => {
  async function makeProof(params: {
    htm?: string;
    htu?: string;
    iat?: number;
    jti?: string | null;
    accessToken?: string;
    typ?: string;
    omitJwk?: boolean;
  } = {}): Promise<{ proof: string; jkt: string; accessToken: string }> {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = await exportJWK(publicKey);
    const jkt = await calculateJwkThumbprint(jwk);
    const accessToken = params.accessToken ?? 'opaque-access-token';
    const ath = createHash('sha256').update(accessToken).digest('base64url');

    const payload: Record<string, unknown> = {
      htm: params.htm ?? 'GET',
      htu: params.htu ?? 'https://example.test/spaces/person/robin',
      iat: params.iat ?? Math.floor(Date.now() / 1000),
      ath,
    };
    if (params.jti !== null) payload.jti = params.jti ?? randomUUID();

    const header: Record<string, unknown> = {
      alg: 'ES256',
      typ: params.typ ?? 'dpop+jwt',
    };
    if (!params.omitJwk) header.jwk = jwk;

    const proof = await new SignJWT(payload)
      .setProtectedHeader(header as any)
      .sign(privateKey);

    return { proof, jkt, accessToken };
  }

  it('verifies a well-formed proof and returns the JWK thumbprint', async () => {
    const { proof, jkt, accessToken } = await makeProof();
    const result = await verifyDpopProof(proof, {
      htm: 'GET',
      htu: 'https://example.test/spaces/person/robin',
      accessToken,
      expectedJkt: jkt,
    });
    expect(result.jkt).toBe(jkt);
  });

  it('rejects proof with wrong typ', async () => {
    const { proof, accessToken } = await makeProof({ typ: 'jwt' });
    await expect(
      verifyDpopProof(proof, { htm: 'GET', htu: 'https://example.test/spaces/person/robin', accessToken }),
    ).rejects.toMatchObject({ reason: 'dpop_wrong_typ' });
  });

  it('rejects proof missing the embedded jwk', async () => {
    const { proof, accessToken } = await makeProof({ omitJwk: true });
    await expect(
      verifyDpopProof(proof, { htm: 'GET', htu: 'https://example.test/spaces/person/robin', accessToken }),
    ).rejects.toMatchObject({ reason: 'dpop_missing_jwk' });
  });

  it('rejects proof when htm does not match the request method', async () => {
    const { proof, accessToken } = await makeProof({ htm: 'GET' });
    await expect(
      verifyDpopProof(proof, { htm: 'PUT', htu: 'https://example.test/spaces/person/robin', accessToken }),
    ).rejects.toMatchObject({ reason: 'dpop_htm_mismatch' });
  });

  it('rejects proof when htu does not match the request URI', async () => {
    const { proof, accessToken } = await makeProof();
    await expect(
      verifyDpopProof(proof, { htm: 'GET', htu: 'https://example.test/spaces/person/other', accessToken }),
    ).rejects.toMatchObject({ reason: 'dpop_htu_mismatch' });
  });

  it('compares htu after stripping query and fragment', async () => {
    const { proof, jkt, accessToken } = await makeProof({
      htu: 'https://example.test/spaces/person/robin',
    });
    const result = await verifyDpopProof(proof, {
      htm: 'GET',
      htu: 'https://example.test/spaces/person/robin?ext=acp#frag',
      accessToken,
      expectedJkt: jkt,
    });
    expect(result.jkt).toBe(jkt);
  });

  it('rejects proof whose iat is older than the maxAge window', async () => {
    const { proof, accessToken } = await makeProof({ iat: Math.floor(Date.now() / 1000) - 600 });
    await expect(
      verifyDpopProof(proof, { htm: 'GET', htu: 'https://example.test/spaces/person/robin', accessToken }),
    ).rejects.toMatchObject({ reason: 'dpop_iat_stale' });
  });

  it('rejects proof with no jti', async () => {
    const { proof, accessToken } = await makeProof({ jti: null });
    await expect(
      verifyDpopProof(proof, { htm: 'GET', htu: 'https://example.test/spaces/person/robin', accessToken }),
    ).rejects.toMatchObject({ reason: 'dpop_missing_jti' });
  });

  it('rejects proof when ath does not match the access token hash', async () => {
    const { proof } = await makeProof({ accessToken: 'token-A' });
    await expect(
      verifyDpopProof(proof, {
        htm: 'GET',
        htu: 'https://example.test/spaces/person/robin',
        accessToken: 'token-B',
      }),
    ).rejects.toMatchObject({ reason: 'dpop_ath_mismatch' });
  });

  it('rejects proof when the embedded JWK thumbprint does not match expectedJkt', async () => {
    const { proof, accessToken } = await makeProof();
    await expect(
      verifyDpopProof(proof, {
        htm: 'GET',
        htu: 'https://example.test/spaces/person/robin',
        accessToken,
        expectedJkt: 'wrong-thumbprint',
      }),
    ).rejects.toMatchObject({ reason: 'dpop_jkt_mismatch' });
  });

  it('skips ath check when accessToken is not provided', async () => {
    const { proof, jkt } = await makeProof();
    const result = await verifyDpopProof(proof, {
      htm: 'GET',
      htu: 'https://example.test/spaces/person/robin',
      expectedJkt: jkt,
    });
    expect(result.jkt).toBe(jkt);
  });
});
