import { describe, it, expect } from 'vitest';
import {
  fetchExternalSpace,
  parseSpaceFromJsonLd,
  parseSpaceFromMarkdown,
  parseSpaceFromTurtle,
  SolidClientError,
} from './solid_client';
import { serializeSpaceJsonLd, serializeSpaceTurtle } from './solid';
import type { Space } from './model';
import matter from 'gray-matter';

const SOURCE_URL = 'https://family.test.example/spaces/person/robin';

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    uri: 'memu://fam-1/person/uuid-abc',
    id: 'uuid-abc',
    familyId: 'fam-1',
    category: 'person',
    slug: 'robin',
    name: 'Robin',
    description: 'Seven-year-old, swims on Thursdays.',
    domains: ['caregiving', 'health'],
    people: ['profile-robin'],
    visibility: 'family',
    confidence: 0.82,
    sourceReferences: [],
    tags: ['child'],
    bodyMarkdown: '# Robin\n\nLikes lego.',
    lastUpdated: new Date('2026-04-18T09:00:00.000Z'),
    ...overrides,
  };
}

function jsonResponse(body: unknown, contentType = 'application/ld+json'): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': `${contentType}; charset=utf-8` },
  });
}

function markdownResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
}

function turtleResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle; charset=utf-8' },
  });
}

describe('parseSpaceFromJsonLd', () => {
  it('round-trips through serializeSpaceJsonLd', () => {
    const space = makeSpace();
    const jsonld = serializeSpaceJsonLd(space, 'https://family.test.example');
    const parsed = parseSpaceFromJsonLd(JSON.stringify(jsonld), SOURCE_URL);

    expect(parsed.name).toBe('Robin');
    expect(parsed.category).toBe('person');
    expect(parsed.slug).toBe('robin');
    expect(parsed.uri).toBe('memu://fam-1/person/uuid-abc');
    expect(parsed.bodyMarkdown).toBe('# Robin\n\nLikes lego.');
    expect(parsed.confidence).toBeCloseTo(0.82);
    expect(parsed.lastUpdated.toISOString()).toBe('2026-04-18T09:00:00.000Z');
    expect(parsed.domains).toContain('caregiving');
    expect(parsed.tags).toContain('child');
  });

  it('falls back to safe defaults on missing fields', () => {
    const minimal = JSON.stringify({ '@context': {}, '@graph': [{ '@id': SOURCE_URL }] });
    const parsed = parseSpaceFromJsonLd(minimal, SOURCE_URL);
    expect(parsed.name).toBe('Untitled');
    expect(parsed.category).toBe('document');
    expect(parsed.confidence).toBe(0.5);
    expect(parsed.bodyMarkdown).toBe('');
  });

  it('coerces unknown category values to document', () => {
    const ld = JSON.stringify({
      '@graph': [{
        '@id': SOURCE_URL,
        'https://memu.digital/vocab#category': 'creature',
      }],
    });
    const parsed = parseSpaceFromJsonLd(ld, SOURCE_URL);
    expect(parsed.category).toBe('document');
  });

  it('throws SolidClientError on invalid JSON', () => {
    expect(() => parseSpaceFromJsonLd('{not json', SOURCE_URL)).toThrow(SolidClientError);
  });

  it('throws on empty graph', () => {
    expect(() => parseSpaceFromJsonLd(JSON.stringify({ '@graph': [] }), SOURCE_URL)).toThrow(/no @graph/);
  });
});

describe('parseSpaceFromMarkdown', () => {
  it('round-trips through gray-matter frontmatter', () => {
    const space = makeSpace();
    const md = matter.stringify('# Robin\n\nLikes lego.\n', {
      id: space.uri,
      name: space.name,
      category: space.category,
      slug: space.slug,
      domains: space.domains,
      people: space.people,
      visibility: space.visibility,
      description: space.description,
      confidence: space.confidence,
      last_updated: space.lastUpdated.toISOString(),
      source_references: [],
      tags: space.tags,
    });
    const parsed = parseSpaceFromMarkdown(md, SOURCE_URL);

    expect(parsed.name).toBe('Robin');
    expect(parsed.category).toBe('person');
    expect(parsed.slug).toBe('robin');
    expect(parsed.uri).toBe('memu://fam-1/person/uuid-abc');
    expect(parsed.confidence).toBeCloseTo(0.82);
    expect(parsed.bodyMarkdown).toContain('Robin');
    expect(parsed.domains).toContain('health');
  });

  it('falls back to slug from URL when frontmatter has no slug', () => {
    const md = '---\nname: Whatever\n---\nbody';
    const parsed = parseSpaceFromMarkdown(md, 'https://example.test/spaces/person/derived-slug');
    expect(parsed.slug).toBe('derived-slug');
  });

  it('handles markdown with no frontmatter at all', () => {
    const parsed = parseSpaceFromMarkdown('Just some body text\n', SOURCE_URL);
    expect(parsed.bodyMarkdown).toBe('Just some body text');
    expect(parsed.category).toBe('document');
    expect(parsed.slug).toBe('robin');
  });
});

describe('parseSpaceFromTurtle', () => {
  it('round-trips through serializeSpaceTurtle', () => {
    const space = makeSpace();
    const ttl = serializeSpaceTurtle(space, 'https://family.test.example');
    const parsed = parseSpaceFromTurtle(ttl, SOURCE_URL);

    expect(parsed.name).toBe('Robin');
    expect(parsed.category).toBe('person');
    expect(parsed.slug).toBe('robin');
    expect(parsed.uri).toBe('memu://fam-1/person/uuid-abc');
    expect(parsed.bodyMarkdown).toContain('Likes lego.');
    expect(parsed.confidence).toBeCloseTo(0.82);
    expect(parsed.lastUpdated.toISOString()).toBe('2026-04-18T09:00:00.000Z');
    expect(parsed.domains).toContain('caregiving');
    expect(parsed.tags).toContain('child');
  });

  it('throws SolidClientError on invalid Turtle', () => {
    expect(() => parseSpaceFromTurtle('@prefix ; broken', SOURCE_URL)).toThrow(SolidClientError);
  });

  it('falls back to safe defaults on minimal Turtle', () => {
    const ttl = `@prefix memu: <https://memu.digital/vocab#> .\n<${SOURCE_URL}> memu:slug "robin" .`;
    const parsed = parseSpaceFromTurtle(ttl, SOURCE_URL);
    expect(parsed.slug).toBe('robin');
    expect(parsed.name).toBe('Untitled');
    expect(parsed.category).toBe('document');
    expect(parsed.confidence).toBe(0.5);
  });
});

describe('fetchExternalSpace', () => {
  it('fetches and parses JSON-LD by content-type', async () => {
    const space = makeSpace();
    const jsonld = serializeSpaceJsonLd(space, 'https://family.test.example');
    const fetchImpl = async () => jsonResponse(jsonld);
    const result = await fetchExternalSpace(SOURCE_URL, { fetchImpl });
    expect(result.name).toBe('Robin');
    expect(result.sourceUrl).toBe(SOURCE_URL);
  });

  it('fetches and parses markdown by content-type', async () => {
    const md = '---\nname: Robin\ncategory: person\nslug: robin\n---\n# Robin';
    const fetchImpl = async () => markdownResponse(md);
    const result = await fetchExternalSpace(SOURCE_URL, { fetchImpl });
    expect(result.category).toBe('person');
    expect(result.bodyMarkdown).toContain('Robin');
  });

  it('fetches and parses Turtle by content-type', async () => {
    const space = makeSpace();
    const ttl = serializeSpaceTurtle(space, 'https://family.test.example');
    const fetchImpl = async () => turtleResponse(ttl);
    const result = await fetchExternalSpace(SOURCE_URL, { fetchImpl });
    expect(result.category).toBe('person');
    expect(result.name).toBe('Robin');
  });

  it('sends Authorization: Bearer when accessToken provided', async () => {
    let captured: Record<string, string> | null = null;
    const fetchImpl: typeof fetch = async (_url, init) => {
      captured = (init?.headers as Record<string, string>) ?? null;
      return jsonResponse({ '@graph': [{ '@id': SOURCE_URL }] });
    };
    await fetchExternalSpace(SOURCE_URL, { fetchImpl, accessToken: 'tok123' });
    expect(captured).not.toBeNull();
    expect((captured as any)['Authorization']).toBe('Bearer tok123');
  });

  it('omits Authorization when no accessToken', async () => {
    let captured: Record<string, string> | null = null;
    const fetchImpl: typeof fetch = async (_url, init) => {
      captured = (init?.headers as Record<string, string>) ?? null;
      return jsonResponse({ '@graph': [{ '@id': SOURCE_URL }] });
    };
    await fetchExternalSpace(SOURCE_URL, { fetchImpl });
    expect((captured as any)['Authorization']).toBeUndefined();
  });

  async function expectReason(promise: Promise<unknown>, reason: string): Promise<void> {
    let caught: unknown = null;
    try { await promise; } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(SolidClientError);
    expect((caught as SolidClientError).reason).toBe(reason);
  }

  it('throws unauthorized for 401', async () => {
    const fetchImpl = async () => new Response('nope', { status: 401 });
    await expectReason(fetchExternalSpace(SOURCE_URL, { fetchImpl }), 'unauthorized');
  });

  it('throws unauthorized for 403', async () => {
    const fetchImpl = async () => new Response('nope', { status: 403 });
    await expectReason(fetchExternalSpace(SOURCE_URL, { fetchImpl }), 'unauthorized');
  });

  it('throws http_error for other non-2xx responses', async () => {
    const fetchImpl = async () => new Response('boom', { status: 500 });
    await expectReason(fetchExternalSpace(SOURCE_URL, { fetchImpl }), 'http_error');
  });

});
