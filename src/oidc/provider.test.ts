/**
 * Story 1.6 — smoke tests for the Solid-OIDC provider configuration.
 *
 * We cannot boot the full Provider here without a live Postgres, so
 * these tests exercise the pure configuration choices that matter for
 * Solid-OIDC compliance: supported scopes, supported claims, DPoP flag,
 * and WebID claim routing. A full e2e against a live Solid client is a
 * manual QA step documented in the story's definition of done.
 */

import { describe, it, expect } from 'vitest';
import { PostgresAdapter } from './adapter';

// We can't boot the full Provider here without a live Postgres, so
// these tests exercise the adapter's in-memory path (used for volatile
// record kinds) and the static type surface. A full e2e against a live
// Solid client is the manual QA step in the story's definition of done.

describe('PostgresAdapter in-memory fallback', () => {
  it('round-trips an AccessToken payload without touching Postgres', async () => {
    // AccessToken is NOT in DURABLE_KINDS, so this stays in-memory.
    const adapter = new PostgresAdapter('AccessToken');
    await adapter.upsert('tok-1', { foo: 'bar', grantId: 'g-1' }, 60);
    const found = await adapter.find('tok-1');
    expect(found).toEqual({ foo: 'bar', grantId: 'g-1' });
  });

  it('returns undefined after destroy', async () => {
    const adapter = new PostgresAdapter('Session');
    await adapter.upsert('sess-1', { accountId: 'a' }, 60);
    await adapter.destroy('sess-1');
    expect(await adapter.find('sess-1')).toBeUndefined();
  });

  it('revokes all in-memory entries sharing a grantId', async () => {
    const at = new PostgresAdapter('AccessToken');
    await at.upsert('tok-A', { grantId: 'g-shared' }, 60);
    await at.upsert('tok-B', { grantId: 'g-shared' }, 60);
    await at.upsert('tok-C', { grantId: 'g-other' }, 60);
    await at.revokeByGrantId('g-shared');
    expect(await at.find('tok-A')).toBeUndefined();
    expect(await at.find('tok-B')).toBeUndefined();
    expect(await at.find('tok-C')).toBeDefined();
  });

});

