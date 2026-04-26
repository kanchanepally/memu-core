import { describe, it, expect } from 'vitest';
import { normaliseJid, shouldIngest } from './whatsapp';

describe('normaliseJid', () => {
  it('strips a device suffix', () => {
    expect(normaliseJid('447000000000:1@s.whatsapp.net')).toBe('447000000000@s.whatsapp.net');
  });

  it('strips a multi-digit device suffix', () => {
    expect(normaliseJid('447000000000:42@s.whatsapp.net')).toBe('447000000000@s.whatsapp.net');
  });

  it('passes through a JID without a device suffix', () => {
    expect(normaliseJid('447000000000@s.whatsapp.net')).toBe('447000000000@s.whatsapp.net');
  });

  it('returns null for null/undefined/empty', () => {
    expect(normaliseJid(null)).toBeNull();
    expect(normaliseJid(undefined)).toBeNull();
    expect(normaliseJid('')).toBeNull();
  });

  it('does not strip digits that are not a device suffix', () => {
    // Group JIDs have a `-` separator before the timestamp, not `:`
    expect(normaliseJid('447000000000-1234567890@g.us')).toBe('447000000000-1234567890@g.us');
  });
});

describe('shouldIngest', () => {
  const own = '447000000000:1@s.whatsapp.net';

  it('mode "all" — passes everything', () => {
    expect(shouldIngest('447111111111@s.whatsapp.net', own, 'all')).toBe(true);
    expect(shouldIngest('447000000000-9876543210@g.us', own, 'all')).toBe(true);
    expect(shouldIngest('447000000000@s.whatsapp.net', own, 'all')).toBe(true);
  });

  it('mode "self_only" — only the user\'s own self-chat passes', () => {
    expect(shouldIngest('447000000000@s.whatsapp.net', own, 'self_only')).toBe(true);
    // Same number with different device suffix on remote (rare but possible) → still self
    expect(shouldIngest('447000000000:2@s.whatsapp.net', own, 'self_only')).toBe(true);
  });

  it('mode "self_only" — group chats blocked', () => {
    expect(shouldIngest('447000000000-1234567890@g.us', own, 'self_only')).toBe(false);
  });

  it('mode "self_only" — DMs from other people blocked', () => {
    expect(shouldIngest('447111111111@s.whatsapp.net', own, 'self_only')).toBe(false);
    expect(shouldIngest('447222222222@s.whatsapp.net', own, 'self_only')).toBe(false);
  });

  it('mode "self_only" — broadcast / status blocked', () => {
    expect(shouldIngest('status@broadcast', own, 'self_only')).toBe(false);
  });

  it('mode "self_only" — newsletter / channel JIDs blocked', () => {
    expect(shouldIngest('123456789@newsletter', own, 'self_only')).toBe(false);
  });

  it('returns false when remote JID missing in self_only', () => {
    expect(shouldIngest(null, own, 'self_only')).toBe(false);
    expect(shouldIngest(undefined, own, 'self_only')).toBe(false);
  });

  it('returns false when own JID missing in self_only', () => {
    expect(shouldIngest('447000000000@s.whatsapp.net', null, 'self_only')).toBe(false);
    expect(shouldIngest('447000000000@s.whatsapp.net', undefined, 'self_only')).toBe(false);
  });

  it('mode "all" passes even when own JID missing', () => {
    expect(shouldIngest('anything@anywhere', null, 'all')).toBe(true);
  });
});
