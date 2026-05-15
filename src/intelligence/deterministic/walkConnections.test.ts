/**
 * Build Spec 2 Phase R4 Story R4.1 — walkConnections tests.
 *
 * The graph walk is the load-bearing primitive for R5's agents — get
 * this wrong and tension-finder / open-loop-tracker walk into the
 * wrong neighbourhood. The walk itself is pure JS over query results,
 * so we test it by stubbing the db.query helper with controllable
 * fixture data rather than spinning up a real Postgres.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tenant DB module before importing walkConnections — vitest's
// hoist semantics mean this mock applies to the import below.
vi.mock('../../db/tenant', () => ({
  db: { query: vi.fn() },
}));

// Re-import after the mock so walkConnections binds to the mocked db.
import { walkConnections } from './walkConnections';
import { db } from '../../db/tenant';

// Helper — set up the query stub to return a fixed sequence of edge
// batches, one batch per hop. Each batch is an array of edge rows.
function mockEdgeBatches(batches: Array<Array<{ a: string; b: string; mech?: string }>>) {
  let call = 0;
  (db.query as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const batch = batches[call++] || [];
    return {
      rows: batch.map(e => ({
        space_uri_a: e.a,
        space_uri_b: e.b,
        source_mechanism: e.mech ?? 'wikilink',
      })),
    };
  });
}

beforeEach(() => {
  (db.query as ReturnType<typeof vi.fn>).mockReset();
});

describe('walkConnections', () => {
  it('returns just the start node when there are no edges', async () => {
    mockEdgeBatches([]);
    const result = await walkConnections('memu://w/A/1');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toEqual({ uri: 'memu://w/A/1', hops: 0 });
    expect(result.edges).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('walks one hop and records the edge with correct direction', async () => {
    mockEdgeBatches([
      // Hop 1: A connects to B (canonical order has A first)
      [{ a: 'memu://w/A/1', b: 'memu://w/B/2' }],
      // Hop 2 (depth=2 by default): nothing more
      [],
    ]);
    const result = await walkConnections('memu://w/A/1');
    expect(result.nodes.map(n => n.uri).sort()).toEqual(['memu://w/A/1', 'memu://w/B/2']);
    expect(result.nodes.find(n => n.uri === 'memu://w/A/1')!.hops).toBe(0);
    expect(result.nodes.find(n => n.uri === 'memu://w/B/2')!.hops).toBe(1);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].fromUri).toBe('memu://w/A/1');
    expect(result.edges[0].toUri).toBe('memu://w/B/2');
    expect(result.edges[0].hops).toBe(1);
  });

  it('handles reverse canonical order — start is the higher-URI endpoint', async () => {
    // Start is B; the edge row has space_uri_a=A < space_uri_b=B per
    // canonical ordering. The walk should flip direction so "from"
    // is B (visited) and "to" is A (new).
    mockEdgeBatches([
      [{ a: 'memu://w/A/1', b: 'memu://w/B/2' }],
      [],
    ]);
    const result = await walkConnections('memu://w/B/2');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].fromUri).toBe('memu://w/B/2');
    expect(result.edges[0].toUri).toBe('memu://w/A/1');
    expect(result.nodes.find(n => n.uri === 'memu://w/A/1')!.hops).toBe(1);
  });

  it('walks 2 hops breadth-first; min-hops to a node is preserved', async () => {
    mockEdgeBatches([
      // Hop 1: start A → B, A → C
      [
        { a: 'memu://w/A/1', b: 'memu://w/B/2' },
        { a: 'memu://w/A/1', b: 'memu://w/C/3' },
      ],
      // Hop 2: B → D, C → D (same target via two paths)
      [
        { a: 'memu://w/B/2', b: 'memu://w/D/4' },
        { a: 'memu://w/C/3', b: 'memu://w/D/4' },
      ],
    ]);
    const result = await walkConnections('memu://w/A/1', { depth: 2 });
    // D was reached by two paths but both at hop 2 — min hops = 2.
    expect(result.nodes.find(n => n.uri === 'memu://w/D/4')!.hops).toBe(2);
    // Both edges INTO D should be recorded (not collapsed).
    const edgesToD = result.edges.filter(e => e.toUri === 'memu://w/D/4' || e.fromUri === 'memu://w/D/4');
    expect(edgesToD.length).toBeGreaterThanOrEqual(2);
  });

  it('respects depth=1 — does not expand the 2nd hop', async () => {
    mockEdgeBatches([
      [{ a: 'memu://w/A/1', b: 'memu://w/B/2' }],
    ]);
    const result = await walkConnections('memu://w/A/1', { depth: 1 });
    // db.query should have been called once (one hop).
    expect((db.query as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(result.nodes).toHaveLength(2);
  });

  it('caps reached nodes at maxNodes and marks truncated', async () => {
    // Hop 1 yields 5 neighbours; cap at 3.
    mockEdgeBatches([
      [
        { a: 'memu://w/A/1', b: 'memu://w/B/2' },
        { a: 'memu://w/A/1', b: 'memu://w/C/3' },
        { a: 'memu://w/A/1', b: 'memu://w/D/4' },
        { a: 'memu://w/A/1', b: 'memu://w/E/5' },
        { a: 'memu://w/A/1', b: 'memu://w/F/6' },
      ],
      [],
    ]);
    const result = await walkConnections('memu://w/A/1', { maxNodes: 3 });
    expect(result.nodes.length).toBeLessThanOrEqual(3);
    expect(result.truncated).toBe(true);
  });

  it('passes mechanism filter through to the SQL clause', async () => {
    mockEdgeBatches([
      [{ a: 'memu://w/A/1', b: 'memu://w/B/2', mech: 'wikilink' }],
      [],
    ]);
    await walkConnections('memu://w/A/1', { mechanisms: ['wikilink', 'manual'] });
    const callArgs = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    // SQL string includes the ANY-array mechanism filter when mechanisms set.
    expect(callArgs[0]).toContain('source_mechanism = ANY');
    // Params second slot carries the mechanism array.
    expect(callArgs[1][1]).toEqual(['wikilink', 'manual']);
  });

  it('does not include the mechanism filter when omitted', async () => {
    mockEdgeBatches([[]]);
    await walkConnections('memu://w/A/1');
    const callArgs = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).not.toContain('source_mechanism = ANY');
    // Params has only the frontier array; no mechanism slot.
    expect(callArgs[1].length).toBe(1);
  });

  it('records peer-level edges (both endpoints already visited) without re-expanding', async () => {
    // Diamond: A → B, A → C (hop 1), then B-C peer edge (hop 2).
    // The peer edge should be recorded with hops = max(B's hops, C's hops) = 1.
    mockEdgeBatches([
      [
        { a: 'memu://w/A/1', b: 'memu://w/B/2' },
        { a: 'memu://w/A/1', b: 'memu://w/C/3' },
      ],
      [
        { a: 'memu://w/B/2', b: 'memu://w/C/3' },
      ],
    ]);
    const result = await walkConnections('memu://w/A/1', { depth: 2 });
    const peerEdge = result.edges.find(e =>
      (e.fromUri === 'memu://w/B/2' && e.toUri === 'memu://w/C/3') ||
      (e.fromUri === 'memu://w/C/3' && e.toUri === 'memu://w/B/2'));
    expect(peerEdge).toBeDefined();
  });

  it('depth is clamped to [0, 5]', async () => {
    mockEdgeBatches([[], [], [], [], [], []]); // 6 batches just in case
    await walkConnections('memu://w/A/1', { depth: 100 });
    // Should call query at most 5 times (clamped).
    expect((db.query as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('depth=0 returns just the start node with zero query calls', async () => {
    (db.query as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ rows: [] }));
    const result = await walkConnections('memu://w/A/1', { depth: 0 });
    expect(result.nodes).toEqual([{ uri: 'memu://w/A/1', hops: 0 }]);
    expect((db.query as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
