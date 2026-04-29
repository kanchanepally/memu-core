import { describe, it, expect } from 'vitest';
import {
  deriveGraph,
  applyVisibilityFilter,
  buildExcerpt,
  countWords,
  nodeSize,
  type GraphSpace,
} from './spaces_graph';
import type { FamilyRoster } from '../spaces/model';

function makeSpace(overrides: Partial<GraphSpace>): GraphSpace {
  return {
    id: overrides.id ?? 'id-default',
    uri: overrides.uri ?? `memu://fam1/person/${overrides.id ?? 'id-default'}`,
    slug: overrides.slug ?? 'default-slug',
    category: overrides.category ?? 'person',
    title: overrides.title ?? 'Untitled',
    description: overrides.description ?? '',
    domains: overrides.domains ?? [],
    people: overrides.people ?? [],
    tags: overrides.tags ?? [],
    visibility: overrides.visibility ?? 'family',
    confidence: overrides.confidence ?? 0.5,
    bodyMarkdown: overrides.bodyMarkdown ?? '',
    lastUpdated: overrides.lastUpdated ?? new Date(), // default fresh so recencyFactor stays at 1.0 unless test overrides
    parentSpaceUri: overrides.parentSpaceUri ?? null,
  };
}

describe('deriveGraph — wikilinks', () => {
  it('resolves wikilinks by slug, lowercase-folded', () => {
    const a = makeSpace({ id: 'a', slug: 'robin', title: 'Robin', bodyMarkdown: 'See [[piano-lessons]] for details.' });
    const b = makeSpace({ id: 'b', slug: 'piano-lessons', title: 'Piano lessons' });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ type: 'wikilink', weight: 1.0 });
    expect([edges[0].source, edges[0].target].sort()).toEqual(['a', 'b']);
  });

  it('resolves wikilinks by title even when slug differs', () => {
    const a = makeSpace({ id: 'a', slug: 'robin', title: 'Robin', bodyMarkdown: 'Reminds me of [[Piano Lessons]] last week.' });
    const b = makeSpace({ id: 'b', slug: 'piano-lessons', title: 'Piano Lessons' });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('wikilink');
  });

  it('ignores dangling wikilinks that do not match any Space', () => {
    const a = makeSpace({ id: 'a', slug: 'robin', bodyMarkdown: 'Tied to [[ghost-page]] somehow.' });
    const b = makeSpace({ id: 'b', slug: 'piano-lessons' });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toHaveLength(0);
  });

  it('does not create self-loops when a Space wikilinks to itself', () => {
    const a = makeSpace({ id: 'a', slug: 'robin', title: 'Robin', bodyMarkdown: 'See [[robin]] (this page).' });
    const { edges } = deriveGraph([a]);
    expect(edges).toHaveLength(0);
  });

  it('handles piped wikilinks like [[slug|Friendly Label]]', () => {
    const a = makeSpace({ id: 'a', slug: 'robin', bodyMarkdown: 'Goes to [[piano-lessons|Robin\'s music]].' });
    const b = makeSpace({ id: 'b', slug: 'piano-lessons' });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('wikilink');
  });
});

describe('deriveGraph — edge dedup + types', () => {
  it('deduplicates bidirectional wikilinks into a single undirected edge', () => {
    const a = makeSpace({ id: 'a', slug: 'a', bodyMarkdown: '[[b]]' });
    const b = makeSpace({ id: 'b', slug: 'b', bodyMarkdown: '[[a]]' });
    const { edges } = deriveGraph([a, b]);
    const wikilinks = edges.filter(e => e.type === 'wikilink');
    expect(wikilinks).toHaveLength(1);
  });

  it('emits a shared_person edge when two Spaces share a person id', () => {
    const a = makeSpace({ id: 'a', people: ['p1', 'p2'] });
    const b = makeSpace({ id: 'b', people: ['p2', 'p3'] });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toEqual([
      expect.objectContaining({ type: 'shared_person', weight: 0.5 }),
    ]);
  });

  it('emits a shared_tag edge when two Spaces share a tag', () => {
    const a = makeSpace({ id: 'a', tags: ['music', 'evening'] });
    const b = makeSpace({ id: 'b', tags: ['music', 'morning'] });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toEqual([
      expect.objectContaining({ type: 'shared_tag', weight: 0.4 }),
    ]);
  });

  it('does NOT emit shared_domain by default', () => {
    const a = makeSpace({ id: 'a', domains: ['health'] });
    const b = makeSpace({ id: 'b', domains: ['health'] });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toHaveLength(0);
  });

  it('emits shared_domain when includeDomain is set or facet === "domain"', () => {
    const a = makeSpace({ id: 'a', domains: ['health'] });
    const b = makeSpace({ id: 'b', domains: ['health'] });
    const optIn = deriveGraph([a, b], { includeDomain: true });
    expect(optIn.edges).toEqual([
      expect.objectContaining({ type: 'shared_domain', weight: 0.3 }),
    ]);
    const facetDomain = deriveGraph([a, b], { facet: 'domain' });
    expect(facetDomain.edges).toEqual([
      expect.objectContaining({ type: 'shared_domain', weight: 0.3 }),
    ]);
  });

  it('keeps wikilink + shared_person between the same pair as separate edge types', () => {
    const a = makeSpace({ id: 'a', slug: 'a', people: ['p1'], bodyMarkdown: '[[b]]' });
    const b = makeSpace({ id: 'b', slug: 'b', people: ['p1'] });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map(e => e.type))).toEqual(new Set(['wikilink', 'shared_person']));
  });

  it('does not emit any edge when arrays are disjoint', () => {
    const a = makeSpace({ id: 'a', people: ['p1'], tags: ['music'], domains: ['health'] });
    const b = makeSpace({ id: 'b', people: ['p2'], tags: ['evening'], domains: ['shelter'] });
    const { edges } = deriveGraph([a, b], { includeDomain: true });
    expect(edges).toHaveLength(0);
  });
});

describe('deriveGraph — node integrity', () => {
  it('returns one node per input Space carrying the spec fields', () => {
    const space = makeSpace({
      id: 'a',
      slug: 'robin',
      title: 'Robin',
      description: 'eldest child',
      domains: ['health'],
      people: ['p1'],
      tags: ['music'],
      bodyMarkdown: 'Robin loves the piano. He plays on **Tuesdays** at 4pm.',
    });
    const { nodes } = deriveGraph([space]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'a',
      uri: space.uri,
      slug: 'robin',
      title: 'Robin',
      description: 'eldest child',
      category: 'person',
      domains: ['health'],
      people: ['p1'],
      tags: ['music'],
      visibility: 'family',
      confidence: 0.5,
    });
    expect(nodes[0].wordcount).toBe(10);
    expect(nodes[0].excerpt).toContain('Robin loves the piano');
    expect(nodes[0].excerpt).not.toContain('**');
    expect(nodes[0].lastUpdated).toBe(space.lastUpdated.toISOString());
  });

  it('clones array fields so mutating the node does not change the input', () => {
    const space = makeSpace({ id: 'a', people: ['p1'], tags: ['music'], domains: ['health'] });
    const { nodes } = deriveGraph([space]);
    nodes[0].people.push('mutant');
    nodes[0].tags.push('mutant');
    nodes[0].domains.push('mutant' as never);
    expect(space.people).toEqual(['p1']);
    expect(space.tags).toEqual(['music']);
    expect(space.domains).toEqual(['health']);
  });
});

describe('deriveGraph — edge cases', () => {
  it('returns empty graph when given no Spaces', () => {
    const { nodes, edges } = deriveGraph([]);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it('handles duplicate wikilink targets within a single body without emitting duplicate edges', () => {
    const a = makeSpace({ id: 'a', slug: 'a', bodyMarkdown: '[[b]] and again [[b]] and one more [[b]]' });
    const b = makeSpace({ id: 'b', slug: 'b' });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('wikilink');
  });

  it('treats wikilink resolution as case-insensitive', () => {
    const a = makeSpace({ id: 'a', slug: 'a', bodyMarkdown: 'See [[ROBIN]] and [[robin]] and [[Robin]].' });
    const b = makeSpace({ id: 'b', slug: 'robin', title: 'Robin' });
    const { edges } = deriveGraph([a, b]);
    expect(edges).toHaveLength(1);
  });
});

describe('applyVisibilityFilter', () => {
  const roster: FamilyRoster = {
    all: ['adult-1', 'adult-2', 'child-1'],
    adults: ['adult-1', 'adult-2'],
    partners: ['adult-1', 'adult-2'],
  };

  it('"all" passes everything through', () => {
    const spaces = [
      makeSpace({ id: 'a', visibility: 'family' }),
      makeSpace({ id: 'b', visibility: 'private', people: ['adult-1'] }),
    ];
    expect(applyVisibilityFilter(spaces, 'adult-1', 'all', roster)).toHaveLength(2);
  });

  it('"mine" keeps Spaces visible only to the viewer', () => {
    const spaces = [
      makeSpace({ id: 'a', visibility: 'private', people: ['adult-1'] }),
      makeSpace({ id: 'b', visibility: 'family' }),
    ];
    const result = applyVisibilityFilter(spaces, 'adult-1', 'mine', roster);
    expect(result.map(s => s.id)).toEqual(['a']);
  });

  it('"shared" keeps Spaces visible to ≥ 2 people', () => {
    const spaces = [
      makeSpace({ id: 'a', visibility: 'private', people: ['adult-1'] }),
      makeSpace({ id: 'b', visibility: 'family' }),
      makeSpace({ id: 'c', visibility: 'partners_only' }),
    ];
    const result = applyVisibilityFilter(spaces, 'adult-1', 'shared', roster);
    expect(result.map(s => s.id).sort()).toEqual(['b', 'c']);
  });
});

describe('deriveGraph — parent_child edges + container metadata (v2)', () => {
  it('emits a parent_child edge with weight 2.0 between a child and its parent', () => {
    const parent = makeSpace({ id: 'parent', slug: 'garden', uri: 'memu://fam/commitment/parent' });
    const child = makeSpace({ id: 'child', slug: 'shopping', uri: 'memu://fam/commitment/child', parentSpaceUri: 'memu://fam/commitment/parent' });
    const { edges } = deriveGraph([parent, child]);
    expect(edges).toEqual([
      expect.objectContaining({ type: 'parent_child', weight: 2.0 }),
    ]);
  });

  it('childCount is set on every node, parentSpaceUri propagates', () => {
    const parent = makeSpace({ id: 'p', uri: 'memu://fam/commitment/p' });
    const c1 = makeSpace({ id: 'c1', parentSpaceUri: 'memu://fam/commitment/p' });
    const c2 = makeSpace({ id: 'c2', parentSpaceUri: 'memu://fam/commitment/p' });
    const sibling = makeSpace({ id: 's' });
    const { nodes } = deriveGraph([parent, c1, c2, sibling]);
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
    expect(byId.p.childCount).toBe(2);
    expect(byId.c1.childCount).toBe(0);
    expect(byId.c1.parentSpaceUri).toBe('memu://fam/commitment/p');
    expect(byId.s.childCount).toBe(0);
    expect(byId.s.parentSpaceUri).toBeNull();
  });

  it('parent_child edge weight beats coexisting shared_person edge weight', () => {
    const parent = makeSpace({ id: 'p', uri: 'memu://fam/p', people: ['adult-1'] });
    const child = makeSpace({ id: 'c', parentSpaceUri: 'memu://fam/p', people: ['adult-1'] });
    const { edges } = deriveGraph([parent, child]);
    expect(edges).toHaveLength(2);
    const types = new Set(edges.map(e => e.type));
    expect(types).toEqual(new Set(['parent_child', 'shared_person']));
    const pc = edges.find(e => e.type === 'parent_child')!;
    const sp = edges.find(e => e.type === 'shared_person')!;
    expect(pc.weight).toBeGreaterThan(sp.weight);
  });

  it('parent_child edge is not emitted when parent is not in the visible set', () => {
    const orphanedChild = makeSpace({ id: 'c', parentSpaceUri: 'memu://fam/missing-parent' });
    const { edges } = deriveGraph([orphanedChild]);
    expect(edges.filter(e => e.type === 'parent_child')).toHaveLength(0);
  });

  it('parent_child edges dedupe across multiple children of the same parent', () => {
    const parent = makeSpace({ id: 'p', uri: 'memu://fam/p' });
    const c1 = makeSpace({ id: 'c1', parentSpaceUri: 'memu://fam/p' });
    const c2 = makeSpace({ id: 'c2', parentSpaceUri: 'memu://fam/p' });
    const { edges } = deriveGraph([parent, c1, c2]);
    const pcEdges = edges.filter(e => e.type === 'parent_child');
    expect(pcEdges).toHaveLength(2);
    const pairs = new Set(pcEdges.map(e => [e.source, e.target].sort().join('::')));
    expect(pairs.size).toBe(2);
  });
});

describe('nodeSize (server-side spec formula)', () => {
  it('grows with body length', () => {
    const small = nodeSize('hi', new Date());
    const big = nodeSize('a'.repeat(5000), new Date());
    expect(big.width).toBeGreaterThan(small.width);
    expect(big.height).toBeGreaterThan(small.height);
  });

  it('shrinks for stale Spaces (>90 days)', () => {
    const fresh = nodeSize('a'.repeat(1000), new Date());
    const stale = nodeSize('a'.repeat(1000), new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
    expect(stale.width).toBeLessThan(fresh.width);
  });

  it('clamps at the spec minimum/maximum', () => {
    const sz = nodeSize('', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
    expect(sz.width).toBeGreaterThanOrEqual(100);
    expect(sz.width).toBeLessThanOrEqual(200);
    expect(sz.height).toBeGreaterThanOrEqual(50);
    expect(sz.height).toBeLessThanOrEqual(90);
  });
});

describe('node integrity — v2 fields land', () => {
  it('every node carries nodeWidth, nodeHeight, parentSpaceUri, childCount', () => {
    const s = makeSpace({ bodyMarkdown: 'a body of moderate length.' });
    const { nodes } = deriveGraph([s]);
    const n = nodes[0];
    expect(n.nodeWidth).toBeGreaterThan(0);
    expect(n.nodeHeight).toBeGreaterThan(0);
    expect(n.parentSpaceUri).toBeNull();
    expect(n.childCount).toBe(0);
  });
});

describe('helpers', () => {
  it('countWords counts whitespace-separated tokens', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('one two three')).toBe(3);
    expect(countWords('  one\ntwo\tthree  ')).toBe(3);
  });

  it('buildExcerpt strips markdown scaffolding and truncates with ellipsis', () => {
    const md = '# Heading\n\n- **Bold** _italic_ `code`\n- [link](https://x.com)';
    const out = buildExcerpt(md, 200);
    // Inline code is stripped — excerpts are about prose, not snippets.
    expect(out).toBe('Heading Bold italic link');
    const long = 'a'.repeat(500);
    const truncated = buildExcerpt(long, 50);
    expect(truncated.endsWith('…')).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(50);
  });
});
