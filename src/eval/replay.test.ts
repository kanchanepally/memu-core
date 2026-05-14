import { describe, it, expect } from 'vitest';
import { diffRetrieval } from './replay';
import type { GoldenQuery } from './types';
import type { RetrievalResult } from '../spaces/retrieval';

function golden(over: Partial<GoldenQuery>): GoldenQuery {
  return {
    id: 'q1',
    query: 'why',
    expectedSpaceUris: [],
    expectedRetrievalState: 'sourced',
    ...over,
  };
}

function result(over: Partial<RetrievalResult>): RetrievalResult {
  return {
    spaces: [],
    embeddingContexts: [],
    provenance: { path: 'none', spaceUris: [], embeddingHits: 0 },
    ...over,
  };
}

describe('diffRetrieval', () => {
  it('passes when expected URIs match actual and state matches', () => {
    const d = diffRetrieval(
      golden({
        expectedSpaceUris: ['memu://a/p/x', 'memu://a/p/y'],
        expectedRetrievalState: 'direct',
      }),
      result({
        provenance: { path: 'direct', spaceUris: ['memu://a/p/y', 'memu://a/p/x'], embeddingHits: 0 },
      }),
    );
    expect(d.passed).toBe(true);
    expect(d.missingUris).toEqual([]);
    expect(d.extraUris).toEqual([]);
    expect(d.stateMismatch).toBe(false);
  });

  it('flags missing URIs', () => {
    const d = diffRetrieval(
      golden({ expectedSpaceUris: ['memu://a/p/x', 'memu://a/p/y'], expectedRetrievalState: 'direct' }),
      result({ provenance: { path: 'direct', spaceUris: ['memu://a/p/x'], embeddingHits: 0 } }),
    );
    expect(d.passed).toBe(false);
    expect(d.missingUris).toEqual(['memu://a/p/y']);
  });

  it('flags extra URIs', () => {
    const d = diffRetrieval(
      golden({ expectedSpaceUris: ['memu://a/p/x'], expectedRetrievalState: 'direct' }),
      result({ provenance: { path: 'direct', spaceUris: ['memu://a/p/x', 'memu://a/p/y'], embeddingHits: 0 } }),
    );
    expect(d.passed).toBe(false);
    expect(d.extraUris).toEqual(['memu://a/p/y']);
  });

  it('flags state mismatch when expected is a path', () => {
    const d = diffRetrieval(
      golden({ expectedSpaceUris: [], expectedRetrievalState: 'direct' }),
      result({ provenance: { path: 'catalogue', spaceUris: [], embeddingHits: 0 } }),
    );
    expect(d.stateMismatch).toBe(true);
    expect(d.passed).toBe(false);
  });

  it('passes when expected is a user-facing state and actual state matches (even if path differs)', () => {
    // expected 'sourced' is satisfied by either direct OR catalogue when spaces are loaded
    const d = diffRetrieval(
      golden({ expectedSpaceUris: ['memu://a/p/x'], expectedRetrievalState: 'sourced' }),
      result({
        spaces: [{ uri: 'memu://a/p/x' } as unknown as RetrievalResult['spaces'][number]],
        provenance: { path: 'catalogue', spaceUris: ['memu://a/p/x'], embeddingHits: 0 },
      }),
    );
    expect(d.stateMismatch).toBe(false);
    expect(d.passed).toBe(true);
  });

  it('flags state mismatch when expected is empty but actual fell through to embedding', () => {
    const d = diffRetrieval(
      golden({ expectedSpaceUris: [], expectedRetrievalState: 'empty' }),
      result({
        embeddingContexts: ['some hit'],
        provenance: { path: 'embedding', spaceUris: [], embeddingHits: 1 },
      }),
    );
    // expected 'empty' but actual 'fallback' — mismatch
    expect(d.stateMismatch).toBe(true);
    expect(d.passed).toBe(false);
  });
});
