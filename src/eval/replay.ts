import { deriveRetrievalState, retrieveForQuery, type RetrievalResult, type RetrievalPath } from '../spaces/retrieval';
import type { GoldenQuery, ReplayDiff } from './types';

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
