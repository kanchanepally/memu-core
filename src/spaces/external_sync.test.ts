import { describe, it, expect } from 'vitest';
import { buildConditionalHeaders, extractForeignWebids } from './external_sync';
import { fetchExternalSpaceConditional, SolidClientError } from './solid_client';
import type { ExternalSpace } from './solid_client';
import type { PodGrant } from '../households/membership';

const SOURCE_URL = 'https://family.test.example/spaces/person/sam';

function makeExternalSpace(overrides: Partial<ExternalSpace> = {}): ExternalSpace {
  return {
    sourceUrl: SOURCE_URL,
    uri: 'memu://other-fam/person/uuid-sam',
    category: 'person',
    slug: 'sam',
    name: 'Sam',
    description: '',
    domains: [],
    people: [],
    visibility: 'private',
    confidence: 0.5,
    sourceReferences: [SOURCE_URL],
    tags: [],
    bodyMarkdown: '# Sam',
    lastUpdated: new Date('2026-04-18T00:00:00.000Z'),
    ...overrides,
  };
}

function makeGrant(overrides: Partial<PodGrant> = {}): PodGrant {
  return {
    id: 'grant-1',
    memberId: 'member-1',
    spaceUrl: SOURCE_URL,
    status: 'active',
    grantedAt: new Date('2026-04-10T00:00:00.000Z'),
    revokedAt: null,
    lastSyncedAt: null,
    lastEtag: null,
    lastModifiedHeader: null,
    ...overrides,
  };
}

describe('extractForeignWebids', () => {
  it('returns https URLs from people[]', () => {
    const space = makeExternalSpace({
      people: ['https://other-pod.test/people/sam#me', 'https://other-pod.test/people/jess#me'],
    });
    expect(extractForeignWebids(space)).toEqual([
      'https://other-pod.test/people/sam#me',
      'https://other-pod.test/people/jess#me',
    ]);
  });

  it('drops local profile ids (non-URLs)', () => {
    const space = makeExternalSpace({
      people: ['profile-abc', 'https://other-pod.test/people/sam#me'],
    });
    expect(extractForeignWebids(space)).toEqual(['https://other-pod.test/people/sam#me']);
  });

  it('drops http URLs (https only — same rule as validateWebid)', () => {
    const space = makeExternalSpace({ people: ['http://insecure.test/people/x#me'] });
    expect(extractForeignWebids(space)).toEqual([]);
  });

  it('deduplicates', () => {
    const space = makeExternalSpace({
      people: ['https://x.test/p#me', 'https://x.test/p#me'],
    });
    expect(extractForeignWebids(space)).toEqual(['https://x.test/p#me']);
  });

  it('returns empty for an empty people[]', () => {
    expect(extractForeignWebids(makeExternalSpace())).toEqual([]);
  });
});

describe('buildConditionalHeaders', () => {
  it('returns empty when grant has no cache hints', () => {
    expect(buildConditionalHeaders(makeGrant())).toEqual({});
  });

  it('sets ifNoneMatch when grant has lastEtag', () => {
    const grant = makeGrant({ lastEtag: 'W/"abc"' });
    expect(buildConditionalHeaders(grant)).toEqual({ ifNoneMatch: 'W/"abc"' });
  });

  it('sets ifModifiedSince when grant has lastModifiedHeader', () => {
    const grant = makeGrant({ lastModifiedHeader: 'Wed, 18 Apr 2026 00:00:00 GMT' });
    expect(buildConditionalHeaders(grant)).toEqual({
      ifModifiedSince: 'Wed, 18 Apr 2026 00:00:00 GMT',
    });
  });

  it('sets both when both hints are present', () => {
    const grant = makeGrant({
      lastEtag: 'W/"abc"',
      lastModifiedHeader: 'Wed, 18 Apr 2026 00:00:00 GMT',
    });
    expect(buildConditionalHeaders(grant)).toEqual({
      ifNoneMatch: 'W/"abc"',
      ifModifiedSince: 'Wed, 18 Apr 2026 00:00:00 GMT',
    });
  });

  it('returns empty when forceRefetch is true even with hints', () => {
    const grant = makeGrant({ lastEtag: 'W/"abc"' });
    expect(buildConditionalHeaders(grant, { forceRefetch: true })).toEqual({});
  });
});

describe('fetchExternalSpaceConditional', () => {
  it('returns kind=fresh on 200 with cache hints from response headers', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('---\nname: Sam\ncategory: person\nslug: sam\n---\n# Sam', {
        status: 200,
        headers: {
          'content-type': 'text/markdown',
          etag: 'W/"abc123"',
          'last-modified': 'Wed, 18 Apr 2026 00:00:00 GMT',
        },
      });
    const result = await fetchExternalSpaceConditional(SOURCE_URL, { fetchImpl });
    expect(result.kind).toBe('fresh');
    if (result.kind === 'fresh') {
      expect(result.space.name).toBe('Sam');
      expect(result.cacheHints.etag).toBe('W/"abc123"');
      expect(result.cacheHints.lastModified).toBe('Wed, 18 Apr 2026 00:00:00 GMT');
    }
  });

  it('returns kind=not_modified on 304 with cache hints', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 304,
        headers: {
          etag: 'W/"abc123"',
          'last-modified': 'Wed, 18 Apr 2026 00:00:00 GMT',
        },
      });
    const result = await fetchExternalSpaceConditional(SOURCE_URL, {
      fetchImpl,
      ifNoneMatch: 'W/"abc123"',
    });
    expect(result.kind).toBe('not_modified');
    if (result.kind === 'not_modified') {
      expect(result.cacheHints.etag).toBe('W/"abc123"');
    }
  });

  it('forwards If-None-Match and If-Modified-Since headers', async () => {
    let captured: Record<string, string> | null = null;
    const fetchImpl: typeof fetch = async (_url, init) => {
      captured = (init?.headers as Record<string, string>) ?? null;
      return new Response(null, { status: 304 });
    };
    await fetchExternalSpaceConditional(SOURCE_URL, {
      fetchImpl,
      ifNoneMatch: 'W/"abc"',
      ifModifiedSince: 'Wed, 18 Apr 2026 00:00:00 GMT',
    });
    expect(captured).not.toBeNull();
    expect((captured as any)['If-None-Match']).toBe('W/"abc"');
    expect((captured as any)['If-Modified-Since']).toBe('Wed, 18 Apr 2026 00:00:00 GMT');
  });

  it('omits conditional headers when not provided', async () => {
    let captured: Record<string, string> | null = null;
    const fetchImpl: typeof fetch = async (_url, init) => {
      captured = (init?.headers as Record<string, string>) ?? null;
      return new Response('---\nname: x\n---\n', {
        status: 200,
        headers: { 'content-type': 'text/markdown' },
      });
    };
    await fetchExternalSpaceConditional(SOURCE_URL, { fetchImpl });
    expect((captured as any)['If-None-Match']).toBeUndefined();
    expect((captured as any)['If-Modified-Since']).toBeUndefined();
  });

  it('still throws SolidClientError on 401/403/500', async () => {
    const fetchImpl: typeof fetch = async () => new Response('boom', { status: 500 });
    await expect(fetchExternalSpaceConditional(SOURCE_URL, { fetchImpl })).rejects.toBeInstanceOf(SolidClientError);
  });
});
