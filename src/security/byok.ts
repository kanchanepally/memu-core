import crypto from 'crypto';
import { pool } from '../db/connection';

export type BYOKProvider = 'anthropic' | 'gemini' | 'openai';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function resolveMasterKey(): Buffer {
  const raw = process.env.MEMU_BYOK_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'MEMU_BYOK_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it in .env before using BYOK.',
    );
  }
  // Accept base64 (44 chars) or hex (64 chars) or raw utf8 (32 bytes).
  let buf: Buffer;
  if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length === 44) {
    buf = Buffer.from(raw, 'base64');
  } else if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'utf8');
  }
  if (buf.length !== 32) {
    throw new Error(`MEMU_BYOK_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}`);
  }
  return buf;
}

interface Encrypted {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptKey(plaintext: string): Encrypted {
  const masterKey = resolveMasterKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, masterKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptKey(data: Encrypted): string {
  const masterKey = resolveMasterKey();
  const decipher = crypto.createDecipheriv(ALGO, masterKey, Buffer.from(data.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(data.authTag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(data.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

function keyHint(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length < 8) return '…';
  return `…${trimmed.slice(-4)}`;
}

export async function setProviderKey(
  profileId: string,
  provider: BYOKProvider,
  plaintext: string,
): Promise<void> {
  const role = await getProfileRole(profileId);
  if (role === 'child') {
    throw new Error('Child profiles cannot set BYOK keys.');
  }
  if (!plaintext || plaintext.trim().length < 10) {
    throw new Error('API key looks too short to be valid.');
  }
  const enc = encryptKey(plaintext.trim());
  const hint = keyHint(plaintext);

  await pool.query(
    `INSERT INTO profile_provider_keys (profile_id, provider, ciphertext, iv, auth_tag, key_hint, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     ON CONFLICT (profile_id, provider) DO UPDATE SET
       ciphertext = EXCLUDED.ciphertext,
       iv = EXCLUDED.iv,
       auth_tag = EXCLUDED.auth_tag,
       key_hint = EXCLUDED.key_hint,
       enabled = TRUE,
       updated_at = NOW()`,
    [profileId, provider, enc.ciphertext, enc.iv, enc.authTag, hint],
  );
}

export async function revokeProviderKey(profileId: string, provider: BYOKProvider): Promise<void> {
  await pool.query(
    `DELETE FROM profile_provider_keys WHERE profile_id = $1 AND provider = $2`,
    [profileId, provider],
  );
}

export async function setProviderKeyEnabled(
  profileId: string,
  provider: BYOKProvider,
  enabled: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE profile_provider_keys
       SET enabled = $3, updated_at = NOW()
       WHERE profile_id = $1 AND provider = $2`,
    [profileId, provider, enabled],
  );
}

export interface BYOKStatus {
  provider: BYOKProvider;
  hasKey: boolean;
  enabled: boolean;
  keyHint?: string;
  updatedAt?: string;
}

export async function listProviderKeyStatus(profileId: string): Promise<BYOKStatus[]> {
  const res = await pool.query(
    `SELECT provider, enabled, key_hint, updated_at
       FROM profile_provider_keys
       WHERE profile_id = $1`,
    [profileId],
  );
  return res.rows.map(r => ({
    provider: r.provider as BYOKProvider,
    hasKey: true,
    enabled: !!r.enabled,
    keyHint: r.key_hint ?? undefined,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
  }));
}

async function getProfileRole(profileId: string): Promise<string | null> {
  const res = await pool.query(`SELECT role FROM profiles WHERE id = $1`, [profileId]);
  return res.rows[0]?.role ?? null;
}

/**
 * Resolve the effective provider key for a profile's LLM call.
 * Returns null if the profile has no enabled key (caller should use deployment default).
 */
export async function resolveProviderKey(
  profileId: string,
  provider: BYOKProvider,
): Promise<{ apiKey: string; keyIdentifier: string } | null> {
  if (!process.env.MEMU_BYOK_ENCRYPTION_KEY) return null;
  try {
    const res = await pool.query(
      `SELECT ciphertext, iv, auth_tag, key_hint, enabled
         FROM profile_provider_keys
         WHERE profile_id = $1 AND provider = $2`,
      [profileId, provider],
    );
    const row = res.rows[0];
    if (!row || !row.enabled) return null;
    const plaintext = decryptKey({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
    });
    return {
      apiKey: plaintext,
      keyIdentifier: `byok:${profileId}:${provider}${row.key_hint ? `:${row.key_hint}` : ''}`,
    };
  } catch (err) {
    console.error('[BYOK] Failed to resolve provider key:', err);
    return null;
  }
}
