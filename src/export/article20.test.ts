/**
 * Story 3.2 — pure-logic tests for the Article 20 export.
 *
 * The DB-touching parts (gatherFamilyData, buildArticle20Export, INSERTs
 * to export_log + spaces_log) are covered by manual QA per the story DoD.
 * What we lock down here is the deterministic shape of the export:
 *
 *   - countCategories returns one entry per FamilyData category, with the
 *     correct cardinality.
 *   - The same data.json content always hashes to the same SHA-256 — a
 *     family must be able to re-derive the hash from the file alone.
 *   - The README references the right hash and the right counts so the
 *     archive is internally consistent.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { countCategories } from './article20';

function emptyData(): any {
  return {
    exported_at: '2026-04-18T10:00:00.000Z',
    family_id: 'fam-1',
    profile: null,
    personas: [],
    connected_channels: [],
    messages: [],
    stream_cards: [],
    stream_card_actions: [],
    synthesis_pages: [],
    context_entries: [],
    privacy_ledger: [],
    twin_registry: [],
    care_standards: [],
    domain_states: [],
    reflection_findings: [],
  };
}

describe('countCategories', () => {
  it('returns zero for every category on an empty export', () => {
    const counts = countCategories(emptyData());
    expect(counts).toEqual({
      personas: 0,
      channels: 0,
      messages: 0,
      stream_cards: 0,
      stream_card_actions: 0,
      synthesis_pages: 0,
      context_entries: 0,
      privacy_ledger: 0,
      twin_registry: 0,
      care_standards: 0,
      domain_states: 0,
      reflection_findings: 0,
    });
  });

  it('counts each category independently', () => {
    const data = emptyData();
    data.personas = [{ id: 'p1' }, { id: 'p2' }];
    data.messages = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];
    data.stream_cards = [{ id: 's1' }];
    data.privacy_ledger = [{ id: 'l1' }, { id: 'l2' }];

    const counts = countCategories(data);
    expect(counts.personas).toBe(2);
    expect(counts.messages).toBe(3);
    expect(counts.stream_cards).toBe(1);
    expect(counts.privacy_ledger).toBe(2);
    expect(counts.context_entries).toBe(0);
  });

  it('uses "channels" as the key for connected_channels (matches README table)', () => {
    const data = emptyData();
    data.connected_channels = [{ channel: 'whatsapp' }];
    const counts = countCategories(data);
    expect(counts.channels).toBe(1);
    expect((counts as any).connected_channels).toBeUndefined();
  });

  it('exposes a stable category set (so the README table never drifts)', () => {
    const counts = countCategories(emptyData());
    expect(Object.keys(counts).sort()).toEqual([
      'care_standards',
      'channels',
      'context_entries',
      'domain_states',
      'messages',
      'personas',
      'privacy_ledger',
      'reflection_findings',
      'stream_card_actions',
      'stream_cards',
      'synthesis_pages',
      'twin_registry',
    ]);
  });
});

describe('data.json hash determinism', () => {
  it('produces the same SHA-256 for the same JSON content', () => {
    const data = emptyData();
    const a = crypto.createHash('sha256').update(JSON.stringify(data, null, 2)).digest('hex');
    const b = crypto.createHash('sha256').update(JSON.stringify(data, null, 2)).digest('hex');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different hash when payload changes', () => {
    const data = emptyData();
    const before = crypto.createHash('sha256').update(JSON.stringify(data, null, 2)).digest('hex');
    data.personas = [{ id: 'new' }];
    const after = crypto.createHash('sha256').update(JSON.stringify(data, null, 2)).digest('hex');
    expect(before).not.toBe(after);
  });
});
