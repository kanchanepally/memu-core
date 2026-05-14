import { describe, it, expect } from 'vitest';
import { diffRetrieval, summariseReplay } from './replay';
import type { GoldenQuery, ReplayDiff } from './types';
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

describe('summariseReplay', () => {
  function diff(over: Partial<ReplayDiff>): ReplayDiff {
    return {
      id: 'q', query: 'q',
      passed: true,
      expectedSpaceUris: [], actualSpaceUris: [],
      expectedRetrievalState: 'sourced',
      actualRetrievalPath: 'catalogue', actualRetrievalState: 'sourced',
      missingUris: [], extraUris: [], stateMismatch: false,
      ...over,
    };
  }

  it('computes recall and by-state breakdown', () => {
    const diffs: ReplayDiff[] = [
      diff({ id: 'a', passed: true, actualRetrievalState: 'sourced' }),
      diff({ id: 'b', passed: true, actualRetrievalState: 'sourced' }),
      diff({ id: 'c', passed: false, actualRetrievalState: 'fallback' }),
      diff({ id: 'd', passed: false, actualRetrievalState: 'empty' }),
    ];
    const r = summariseReplay('coll-1', new Date('2026-05-14T05:00:00Z'), diffs);
    expect(r.total).toBe(4);
    expect(r.passed).toBe(2);
    expect(r.failed).toBe(2);
    expect(r.recallPercent).toBe(50);
    expect(r.byState.sourced).toEqual({ total: 2, passed: 2 });
    expect(r.byState.fallback).toEqual({ total: 1, passed: 0 });
    expect(r.byState.empty).toEqual({ total: 1, passed: 0 });
    expect(r.collectiveId).toBe('coll-1');
  });

  it('handles empty input (0 / 0 → 100%)', () => {
    const r = summariseReplay('coll-1', new Date(), []);
    expect(r.total).toBe(0);
    expect(r.recallPercent).toBe(100);
  });

  it('rounds recall to one decimal place', () => {
    const diffs = [
      diff({ id: 'a', passed: true }),
      diff({ id: 'b', passed: true }),
      diff({ id: 'c', passed: false }),
    ];
    const r = summariseReplay('coll-1', new Date(), diffs);
    expect(r.recallPercent).toBe(66.7);
  });
});
