import type { RetrievalPath, RetrievalState } from '../spaces/retrieval';

// Golden-set expected_retrieval_state accepts EITHER the user-facing
// state (sourced/fallback/empty) OR the tier path (direct/catalogue/
// embedding/none). The state is what we usually care about; the path
// is for finer-grained assertions on which tier *should* have answered.
export type ExpectedRetrievalState = RetrievalState | RetrievalPath;

const VALID: readonly ExpectedRetrievalState[] = [
  'sourced', 'fallback', 'empty',
  'direct', 'catalogue', 'embedding', 'none',
] as const;

export function isExpectedRetrievalState(v: string): v is ExpectedRetrievalState {
  return typeof v === 'string' && (VALID as readonly string[]).includes(v);
}

export interface GoldenQuery {
  id: string;                              // filename without .md
  query: string;                           // the query text (file body)
  expectedSpaceUris: string[];             // URIs a correct retrieval surfaces
  expectedRetrievalState: ExpectedRetrievalState;
  notes?: string;                          // optional commentary
}

export interface ReplayDiff {
  id: string;
  query: string;
  passed: boolean;
  expectedSpaceUris: string[];
  actualSpaceUris: string[];
  expectedRetrievalState: ExpectedRetrievalState;
  actualRetrievalPath: RetrievalPath;
  actualRetrievalState: RetrievalState;
  missingUris: string[];                   // expected but not retrieved
  extraUris: string[];                     // retrieved but not expected
  stateMismatch: boolean;
}

export interface ReplayResult {
  collectiveId: string;
  ranAt: Date;
  total: number;
  passed: number;
  failed: number;
  recallPercent: number;                   // passed / total * 100, rounded to 1dp
  byState: Record<RetrievalState, { total: number; passed: number }>;
  diffs: ReplayDiff[];
}
