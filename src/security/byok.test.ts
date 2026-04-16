import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { encryptKey, decryptKey, resolveProviderKey } from './byok';

describe('BYOK crypto', () => {
  const originalKey = process.env.MEMU_BYOK_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.MEMU_BYOK_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.MEMU_BYOK_ENCRYPTION_KEY;
    else process.env.MEMU_BYOK_ENCRYPTION_KEY = originalKey;
  });

  it('round-trips an API key', () => {
    const plaintext = 'sk-ant-this-is-a-fake-key-for-testing-12345';
    const enc = encryptKey(plaintext);
    expect(enc.ciphertext).not.toContain(plaintext);
    expect(decryptKey(enc)).toBe(plaintext);
  });

  it('produces a different ciphertext each encryption (random IV)', () => {
    const plaintext = 'sk-ant-fake';
    const a = encryptKey(plaintext);
    const b = encryptKey(plaintext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptKey(a)).toBe(decryptKey(b));
  });

  it('rejects a tampered authTag', () => {
    const enc = encryptKey('sk-ant-fake');
    const tampered = { ...enc, authTag: Buffer.alloc(16).toString('base64') };
    expect(() => decryptKey(tampered)).toThrow();
  });

  it('rejects a master key of wrong length', () => {
    process.env.MEMU_BYOK_ENCRYPTION_KEY = 'too-short';
    expect(() => encryptKey('anything')).toThrow(/32 bytes/);
  });
});

describe('resolveProviderKey', () => {
  const originalKey = process.env.MEMU_BYOK_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.MEMU_BYOK_ENCRYPTION_KEY;
    else process.env.MEMU_BYOK_ENCRYPTION_KEY = originalKey;
  });

  it('returns null when master key is unset', async () => {
    delete process.env.MEMU_BYOK_ENCRYPTION_KEY;
    const result = await resolveProviderKey('nonexistent-profile-id', 'anthropic');
    expect(result).toBeNull();
  });
});
