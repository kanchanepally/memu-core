import { describe, it, expect } from 'vitest';
import {
  deriveGraph,
  applyVisibilityFilter,
  buildExcerpt,
  countWords,
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
    lastUpdated: overrides.lastUpdated ?? new Date('2026-04-01T00:00:00Z'),
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
