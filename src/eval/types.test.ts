import { describe, it, expect } from 'vitest';
import type { GoldenQuery, ReplayDiff, ReplayResult } from './types';
import { isExpectedRetrievalState } from './types';

describe('eval types', () => {
  it('isExpectedRetrievalState accepts valid states', () => {
    expect(isExpectedRetrievalState('sourced')).toBe(true);
    expect(isExpectedRetrievalState('fallback')).toBe(true);
    expect(isExpectedRetrievalState('empty')).toBe(true);
    expect(isExpectedRetrievalState('direct')).toBe(true);
    expect(isExpectedRetrievalState('catalogue')).toBe(true);
    expect(isExpectedRetrievalState('embedding')).toBe(true);
    expect(isExpectedRetrievalState('none')).toBe(true);
  });

  it('isExpectedRetrievalState rejects garbage', () => {
    expect(isExpectedRetrievalState('garbage')).toBe(false);
    expect(isExpectedRetrievalState('')).toBe(false);
    expect(isExpectedRetrievalState(undefined as unknown as string)).toBe(false);
  });
});

// Type-level smoke checks so the imports above aren't dead. If these
// types disappear or change shape, this file stops compiling.
const _gq: GoldenQuery = {
  id: 'q1',
  query: 'q',
  expectedSpaceUris: [],
  expectedRetrievalState: 'sourced',
};
const _rd: ReplayDiff = {
  id: 'q1',
  query: 'q',
  passed: true,
  expectedSpaceUris: [],
  actualSpaceUris: [],
  expectedRetrievalState: 'sourced',
  actualRetrievalPath: 'catalogue',
  actualRetrievalState: 'sourced',
  missingUris: [],
  extraUris: [],
  stateMismatch: false,
};
const _rr: ReplayResult = {
  collectiveId: 'c1',
  ranAt: new Date(),
  total: 0,
  passed: 0,
  failed: 0,
  recallPercent: 100,
  byState: {
    sourced: { total: 0, passed: 0 },
    fallback: { total: 0, passed: 0 },
    empty: { total: 0, passed: 0 },
  },
  diffs: [],
};
void _gq; void _rd; void _rr;
