import { deriveRetrievalState, retrieveForQuery, type RetrievalResult, type RetrievalPath, type RetrievalState } from '../spaces/retrieval';
import type { GoldenQuery, ReplayDiff, ReplayResult } from './types';

const PATH_VALUES: readonly RetrievalPath[] = ['direct', 'catalogue', 'embedding', 'none'];

function isPath(s: string): s is RetrievalPath {
  return (PATH_VALUES as readonly string[]).includes(s);
}

export function diffRetrieval(query: GoldenQuery, result: RetrievalResult): ReplayDiff {
  const actualUris = [...result.provenance.spaceUris].sort();
  const expectedUris = [...query.expectedSpaceUris].sort();
  const actualSet = new Set(actualUris);
  const expectedSet = new Set(expectedUris);
  const missingUris = expectedUris.filter(u => !actualSet.has(u));
  const extraUris = actualUris.filter(u => !expectedSet.has(u));

  const actualPath = result.provenance.path;
  const actualState = deriveRetrievalState(result);

  let stateMismatch = false;
  if (isPath(query.expectedRetrievalState)) {
    stateMismatch = query.expectedRetrievalState !== actualPath;
  } else {
    stateMismatch = query.expectedRetrievalState !== actualState;
  }

  return {
    id: query.id,
    query: query.query,
    passed: missingUris.length === 0 && extraUris.length === 0 && !stateMismatch,
    expectedSpaceUris: expectedUris,
    actualSpaceUris: actualUris,
    expectedRetrievalState: query.expectedRetrievalState,
    actualRetrievalPath: actualPath,
    actualRetrievalState: actualState,
    missingUris,
    extraUris,
    stateMismatch,
  };
}

export interface ReplayContext {
  collectiveId: string;
  viewerProfileId: string;
}

export async function replayQuery(query: GoldenQuery, ctx: ReplayContext): Promise<ReplayDiff> {
  const result = await retrieveForQuery({
    familyId: ctx.collectiveId,       // single-collective convention from Story 2.1; reads as collective scope
    viewerProfileId: ctx.viewerProfileId,
    query: query.query,
  });
  return diffRetrieval(query, result);
}

const ALL_STATES: RetrievalState[] = ['sourced', 'fallback', 'empty'];

export function summariseReplay(collectiveId: string, ranAt: Date, diffs: ReplayDiff[]): ReplayResult {
  const total = diffs.length;
  const passed = diffs.filter(d => d.passed).length;
  const recallPercent = total === 0 ? 100 : Math.round((passed / total) * 1000) / 10;
  const byState: ReplayResult['byState'] = {
    sourced: { total: 0, passed: 0 },
    fallback: { total: 0, passed: 0 },
    empty: { total: 0, passed: 0 },
  };
  for (const d of diffs) {
    const bucket = byState[d.actualRetrievalState];
    bucket.total += 1;
    if (d.passed) bucket.passed += 1;
  }
  // Ensure every state present (idempotent over the ALL_STATES list).
  for (const s of ALL_STATES) {
    byState[s] ??= { total: 0, passed: 0 };
  }
  return {
    collectiveId,
    ranAt,
    total,
    passed,
    failed: total - passed,
    recallPercent,
    byState,
    diffs,
  };
}

export async function replayAll(
  queries: GoldenQuery[],
  ctx: ReplayContext,
): Promise<ReplayResult> {
  const diffs: ReplayDiff[] = [];
  for (const q of queries) {
    diffs.push(await replayQuery(q, ctx));
  }
  return summariseReplay(ctx.collectiveId, new Date(), diffs);
}
