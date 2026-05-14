# Phase 0 — Retrieval Evaluation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a golden-query-set fixture, a replay tool that diffs actual vs expected retrieval, and a nightly card surfacing aggregate recall % and drift — so every later change to retrieval is measurable rather than guessed.

**Architecture:** Golden queries live as gray-matter `.md` files in `eval/golden/` (one query per file, frontmatter for expected fields, body is the query text — diffable, editable by a non-developer, no new YAML parser required since `gray-matter` is already a dep). A pure `replayQuery` function calls the existing `retrieveForQuery` from `src/spaces/retrieval.ts` and diffs the resulting `provenance.path` + `spaceUris` against expected. A CLI entry point (`src/eval/cli.ts`) lets the harness run manually. A new `eval_recall` stream card type, surfaced by a 05:00 cron that enumerates collectives via the existing pattern, lands the result on the Today surface. Reuses existing `RetrievalPath` + `RetrievalState` types from `src/spaces/retrieval.ts` — no new vocabulary invented.

**Tech Stack:** TypeScript + vitest, `gray-matter` for golden-query parsing, `node-cron` for the nightly job (existing scheduler in `src/index.ts`), Postgres + RLS via `db.query` from `src/db/tenant.ts`, existing `stream_cards` table for the surfaced card.

**Spec reference:** `C:\Users\Lenovo\Code\memu-platform\files\build-spec-1-workspace-architecture.md` §3 (Phase 0).

**Vocabulary decision (2026-05-14):** Schema stays `collectives` (ARCH-01 shipped 2026-05-10). Spec 1's "workspace" reads as "collective" throughout this plan and downstream specs. Type-enum extension (`personal`, `family`, `work`, `project`, `research`, `community`) is Phase 2 work; Phase 0 does not touch the tenant schema.

---

### Task 1: Eval module scaffold + types

**Files:**
- Create: `memu-core/src/eval/types.ts`
- Create: `memu-core/src/eval/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/eval/types.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run from `memu-core/`: `npx vitest run src/eval/types.test.ts`
Expected: FAIL with "Cannot find module './types'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/eval/types.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/eval/types.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Verify typecheck still clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/eval/types.ts src/eval/types.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): scaffold retrieval evaluation types

Reuses RetrievalPath/RetrievalState from src/spaces/retrieval rather
than inventing new vocabulary. Phase 0 of Build Spec 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Golden-query loader

**Files:**
- Create: `memu-core/src/eval/golden.ts`
- Create: `memu-core/src/eval/golden.test.ts`
- Create: `memu-core/src/eval/__fixtures__/sample-query.md`

- [ ] **Step 1: Create the fixture**

```markdown
<!-- src/eval/__fixtures__/sample-query.md -->
---
expected_space_uris:
  - memu://test-collective/person/robin
expected_retrieval_state: direct
notes: Sample fixture for the loader test
---
When is Robin's next dentist appointment?
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/eval/golden.test.ts
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadGoldenQueries, parseGoldenQuery } from './golden';

const FIXTURES = resolve(__dirname, '__fixtures__');

describe('parseGoldenQuery', () => {
  it('parses a well-formed query file', () => {
    const raw = [
      '---',
      'expected_space_uris:',
      '  - memu://x/person/a',
      '  - memu://x/person/b',
      'expected_retrieval_state: catalogue',
      'notes: hello',
      '---',
      'Body text here.',
      'Across two lines.',
      '',
    ].join('\n');

    const q = parseGoldenQuery('q1', raw);
    expect(q.id).toBe('q1');
    expect(q.query).toBe('Body text here.\nAcross two lines.');
    expect(q.expectedSpaceUris).toEqual([
      'memu://x/person/a',
      'memu://x/person/b',
    ]);
    expect(q.expectedRetrievalState).toBe('catalogue');
    expect(q.notes).toBe('hello');
  });

  it('rejects an unknown expected_retrieval_state', () => {
    const raw = [
      '---',
      'expected_space_uris: []',
      'expected_retrieval_state: garbage',
      '---',
      'q',
      '',
    ].join('\n');
    expect(() => parseGoldenQuery('q1', raw)).toThrow(/expected_retrieval_state/);
  });

  it('rejects a missing query body', () => {
    const raw = [
      '---',
      'expected_space_uris: []',
      'expected_retrieval_state: empty',
      '---',
      '',
    ].join('\n');
    expect(() => parseGoldenQuery('q1', raw)).toThrow(/query body/);
  });
});

describe('loadGoldenQueries', () => {
  it('loads the fixture directory', () => {
    const queries = loadGoldenQueries(FIXTURES);
    expect(queries).toHaveLength(1);
    expect(queries[0].id).toBe('sample-query');
    expect(queries[0].expectedRetrievalState).toBe('direct');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/eval/golden.test.ts`
Expected: FAIL with "Cannot find module './golden'".

- [ ] **Step 4: Write minimal implementation**

```typescript
// src/eval/golden.ts
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import { isExpectedRetrievalState, type GoldenQuery } from './types';

export function parseGoldenQuery(id: string, raw: string): GoldenQuery {
  const parsed = matter(raw);
  const fm = parsed.data ?? {};
  const body = (parsed.content ?? '').trim();
  if (!body) {
    throw new Error(`[eval] golden query ${id}: missing query body`);
  }
  const uris = fm.expected_space_uris;
  if (!Array.isArray(uris) || uris.some(u => typeof u !== 'string')) {
    throw new Error(`[eval] golden query ${id}: expected_space_uris must be string[]`);
  }
  const state = fm.expected_retrieval_state;
  if (!isExpectedRetrievalState(state)) {
    throw new Error(`[eval] golden query ${id}: expected_retrieval_state '${state}' invalid`);
  }
  return {
    id,
    query: body,
    expectedSpaceUris: uris as string[],
    expectedRetrievalState: state,
    notes: typeof fm.notes === 'string' ? fm.notes : undefined,
  };
}

export function loadGoldenQueries(dir: string): GoldenQuery[] {
  const entries = readdirSync(dir).filter(f => f.endsWith('.md'));
  return entries.map(f => {
    const id = f.replace(/\.md$/, '');
    const raw = readFileSync(resolve(dir, f), 'utf8');
    return parseGoldenQuery(id, raw);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/eval/golden.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add src/eval/golden.ts src/eval/golden.test.ts src/eval/__fixtures__/sample-query.md
git commit -m "$(cat <<'EOF'
feat(eval): golden-query loader (gray-matter .md format)

One query per file, frontmatter for expected fields, body is the query.
Diffable, editable by non-developers, no new YAML parser required.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Seed the real golden directory with starter queries

**Files:**
- Create: `memu-core/eval/golden/.gitkeep`
- Create: `memu-core/eval/golden/README.md`
- Create: `memu-core/eval/golden/who-is-robin.md`
- Create: `memu-core/eval/golden/dentist-next.md`
- Create: `memu-core/eval/golden/garden-bed.md`
- Create: `memu-core/eval/golden/totally-unknown.md`
- Create: `memu-core/eval/golden/raised-bed-followup.md`

> **Note:** the URIs in the seed files are placeholders following the `memu://<collective_id>/<category>/<uuid_or_slug>` convention from migration 009. Hareesh will edit them to point at real URIs from his Z2 data once Task 4's replay tool runs against them. The seed exists to lock the format, not to be authoritative — that's the whole "editable by a non-developer" property the spec asks for.

- [ ] **Step 1: Create the README**

```markdown
<!-- eval/golden/README.md -->
# Golden Query Set

Each `.md` file is one golden query: a real question, the Spaces a
correct retrieval should surface, and which retrieval tier *should*
answer it. Edit freely — every change is diffable.

## File format

```
---
expected_space_uris:
  - memu://<collective_id>/<category>/<uri>
  - memu://...
expected_retrieval_state: sourced | fallback | empty | direct | catalogue | embedding | none
notes: optional commentary
---
The query text goes here. Multiple lines fine.
```

`expected_retrieval_state` can be a tier path (`direct` / `catalogue` /
`embedding` / `none`) for fine-grained assertions, or a user-facing
state (`sourced` / `fallback` / `empty`) when you only care which
bucket the answer should land in.

## Adding a query

1. Copy any existing `.md` as a template.
2. Name the file `<short-kebab-slug>.md` — the filename becomes the
   query id in reports.
3. Paste the query text into the body.
4. Run `npm run eval:replay -- --collective <your-collective-id>` to
   see what retrieval actually returns; fill in `expected_space_uris`
   from the actual list (the seed values are placeholders).
5. Commit.

The aggregate recall % is computed across this whole directory.
```

- [ ] **Step 2: Create seed queries (5 covering each retrieval tier)**

```markdown
<!-- eval/golden/who-is-robin.md -->
---
expected_space_uris:
  - memu://REPLACE_ME/person/robin
expected_retrieval_state: direct
notes: Direct slug match for a known person Space.
---
Tell me about Robin.
```

```markdown
<!-- eval/golden/dentist-next.md -->
---
expected_space_uris:
  - memu://REPLACE_ME/commitment/dentist-checkups
expected_retrieval_state: catalogue
notes: Catalogue matcher should pick up the dentist commitment from a paraphrased query.
---
When does Robin need to see the dentist again?
```

```markdown
<!-- eval/golden/garden-bed.md -->
---
expected_space_uris:
  - memu://REPLACE_ME/document/raised-bed-project
expected_retrieval_state: catalogue
notes: Catalogue matcher should pick up the raised-bed Space from a project keyword.
---
What did I decide about the raised bed sizing?
```

```markdown
<!-- eval/golden/totally-unknown.md -->
---
expected_space_uris: []
expected_retrieval_state: empty
notes: Out-of-scope question; correct behaviour is to return nothing rather than confabulate (paired with BUG-15 confabulation-from-emptiness fix).
---
What's the capital of Atlantis?
```

```markdown
<!-- eval/golden/raised-bed-followup.md -->
---
expected_space_uris: []
expected_retrieval_state: embedding
notes: Specific detail not captured in any Space body — should fall through to embedding tier over context_entries.
---
Did anyone mention the exact bolt length for the raised bed?
```

- [ ] **Step 3: Smoke-check the loader against the real directory**

Run: `npx tsx -e "import('./src/eval/golden').then(m => console.log(m.loadGoldenQueries('./eval/golden').map(q => q.id)))"`
Expected: prints `[ 'dentist-next', 'garden-bed', 'raised-bed-followup', 'totally-unknown', 'who-is-robin' ]`.

- [ ] **Step 4: Commit**

```bash
git add eval/golden/
git commit -m "$(cat <<'EOF'
feat(eval): seed golden query set with 5 starter queries

One query per retrieval tier (direct, catalogue x2, empty, embedding).
URIs are placeholders for Hareesh to refine against real Z2 data once
the replay tool runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Replay engine — diff one query

**Files:**
- Create: `memu-core/src/eval/replay.ts`
- Create: `memu-core/src/eval/replay.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/eval/replay.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/eval/replay.test.ts`
Expected: FAIL with "Cannot find module './replay'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/eval/replay.ts
import { deriveRetrievalState, retrieveForQuery, type RetrievalResult, type RetrievalPath, type RetrievalState } from '../spaces/retrieval';
import type { GoldenQuery, ReplayDiff } from './types';

const PATH_VALUES: readonly RetrievalPath[] = ['direct', 'catalogue', 'embedding', 'none'];
const STATE_VALUES: readonly RetrievalState[] = ['sourced', 'fallback', 'empty'];

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
    stateMismatch = (query.expectedRetrievalState as RetrievalState) !== actualState;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/eval/replay.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Verify typecheck still clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/eval/replay.ts src/eval/replay.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): replay engine — diff one query against actual retrieval

Pure diffRetrieval helper for tests; replayQuery wires it to the real
retrieveForQuery from src/spaces/retrieval. Expected state can be a
tier path or a user-facing state — both honoured.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Replay-all aggregator

**Files:**
- Modify: `memu-core/src/eval/replay.ts`
- Modify: `memu-core/src/eval/replay.test.ts`

- [ ] **Step 1: Add the failing test (append to existing file)**

Append to `src/eval/replay.test.ts`:

```typescript
import { summariseReplay } from './replay';
import type { ReplayDiff } from './types';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/eval/replay.test.ts`
Expected: FAIL with "summariseReplay is not exported" or equivalent.

- [ ] **Step 3: Add the implementation**

Append to `src/eval/replay.ts`:

```typescript
import type { ReplayResult } from './types';

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/eval/replay.test.ts`
Expected: PASS, 9/9 (6 from Task 4 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/eval/replay.ts src/eval/replay.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): summariseReplay + replayAll — aggregate recall + by-state

Recall is passed/total to one decimal place; by-state breakdown buckets
diffs by their actual retrieval state so a fallback-heavy run shows the
weak tier clearly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: CLI entry point

**Files:**
- Create: `memu-core/src/eval/cli.ts`
- Modify: `memu-core/package.json` (add npm script)

- [ ] **Step 1: Write the CLI**

```typescript
// src/eval/cli.ts
/**
 * CLI: npm run eval:replay -- --collective <id> --viewer <profile_id>
 *
 * Loads ./eval/golden/*.md, runs every query through the real retrieval
 * pipeline under the given collective context, prints a per-query pass/fail
 * line plus aggregate recall %. Exits non-zero if any query failed (useful
 * for CI; the nightly cron in Task 8 ignores the exit code).
 */
import { resolve } from 'node:path';
import { enterCollectiveContext } from '../db/tenant';
import { loadGoldenQueries } from './golden';
import { replayAll } from './replay';

function parseArgs(argv: string[]): { collective: string; viewer: string; dir: string } {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) { args.set(k, v); i++; }
    }
  }
  const collective = args.get('collective') ?? process.env.MEMU_EVAL_COLLECTIVE_ID;
  const viewer = args.get('viewer') ?? process.env.MEMU_EVAL_VIEWER_PROFILE_ID ?? collective;
  const dir = args.get('dir') ?? resolve(process.cwd(), 'eval/golden');
  if (!collective) {
    throw new Error('Usage: --collective <id> [--viewer <profile_id>] [--dir <path>]');
  }
  return { collective, viewer: viewer!, dir };
}

async function main() {
  const { collective, viewer, dir } = parseArgs(process.argv.slice(2));
  const queries = loadGoldenQueries(dir);
  if (queries.length === 0) {
    console.error(`[eval] no golden queries found in ${dir}`);
    process.exit(2);
  }

  const result = await enterCollectiveContext(collective, async () => {
    return await replayAll(queries, { collectiveId: collective, viewerProfileId: viewer });
  });

  for (const d of result.diffs) {
    const tag = d.passed ? 'PASS' : 'FAIL';
    const reasons: string[] = [];
    if (d.missingUris.length) reasons.push(`missing ${d.missingUris.length}`);
    if (d.extraUris.length) reasons.push(`extra ${d.extraUris.length}`);
    if (d.stateMismatch) reasons.push(`state: expected=${d.expectedRetrievalState} actual=${d.actualRetrievalState}/${d.actualRetrievalPath}`);
    console.log(`[${tag}] ${d.id}  ${reasons.length ? '— ' + reasons.join('; ') : ''}`);
  }
  console.log('');
  console.log(`recall: ${result.recallPercent}%  (${result.passed}/${result.total})`);
  console.log(`by state: sourced ${result.byState.sourced.passed}/${result.byState.sourced.total} · fallback ${result.byState.fallback.passed}/${result.byState.fallback.total} · empty ${result.byState.empty.passed}/${result.byState.empty.total}`);

  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[eval] fatal:', err);
  process.exit(2);
});
```

- [ ] **Step 2: Add the npm script**

Edit `package.json`, in the `"scripts"` block, add the line:

```json
    "eval:replay": "tsx src/eval/cli.ts",
```

(place it after the existing `"test": "vitest"` line; trailing comma on `test` line if needed).

- [ ] **Step 3: Smoke-test the CLI shape**

Run: `npx tsx src/eval/cli.ts 2>&1 | head -5`
Expected: error output starting with `Usage: --collective <id>` (no collective passed, intentional).

> **Note:** end-to-end smoke test against real data happens on the Z2 — see "Operator action" at the bottom of this plan. Locally without a populated DB the replay would just print state mismatches against empty retrieval.

- [ ] **Step 4: Verify typecheck still clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/eval/cli.ts package.json
git commit -m "$(cat <<'EOF'
feat(eval): CLI — npm run eval:replay -- --collective <id>

Enters the collective context, loads golden queries from eval/golden/,
runs the replay, prints per-query lines + aggregate recall. Exits
non-zero on any failure (useful in CI; cron in Task 8 ignores the code).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Migration 037 — `eval_recall` stream card type

**Files:**
- Create: `memu-core/migrations/037_eval_recall_card_type.sql`
- Modify: nothing else (the migration auto-applies at boot via `src/db/migrate.ts`)

> **Note on numbering:** the highest existing migration is 036_app_role.sql (TD-01, shipped 2026-05-14). 037 is the next sequential number. Verify by running `ls memu-core/migrations/ | sort | tail -3` before committing — if a 037 has appeared in between, renumber.

- [ ] **Step 1: Verify the next-available migration number**

Run from `memu-core/`: `ls migrations/ | sort | tail -3`
Expected: `034_..., 036_app_role.sql`. (035 is the historical skip per memu-core CLAUDE.md.)
If a 037 already exists, pick the next free number and update the filename below.

- [ ] **Step 2: Write the migration**

```sql
-- migrations/037_eval_recall_card_type.sql
--
-- Phase 0 of Build Spec 1 — extend stream_cards.card_type to include
-- 'eval_recall' so the nightly retrieval-eval card can land on the
-- Today surface using the existing card pattern (per the spec:
-- "a card on the Today surface is the natural home — reuse the
-- existing card pattern").
--
-- Pattern matches migration 019 (briefing card type) exactly: drop
-- the old CHECK if present, re-add with the full list including the
-- new value. Idempotent.

ALTER TABLE stream_cards DROP CONSTRAINT IF EXISTS stream_cards_card_type_check;
ALTER TABLE stream_cards
  ADD CONSTRAINT stream_cards_card_type_check
  CHECK (card_type IN (
    'collision', 'extraction', 'unfinished_business',
    'reminder', 'document_extracted', 'calendar_added',
    'proactive_nudge', 'weekly_digest',
    'contradiction', 'stale_fact', 'pattern', 'care_standard_lapsed',
    'shopping', 'briefing',
    'eval_recall'
  ));
```

- [ ] **Step 3: Smoke-test the migration locally**

If a local Postgres is available: start the dev server (`npm run dev`) and verify the boot logs include `migration 037 applied`. If no local DB is available, skip — verification happens on the Z2 (see Operator action).

- [ ] **Step 4: Commit**

```bash
git add migrations/037_eval_recall_card_type.sql
git commit -m "$(cat <<'EOF'
feat(db): migration 037 — eval_recall card type

Extends stream_cards.card_type CHECK to include 'eval_recall' so the
nightly retrieval-eval card can use the existing card pattern.
Phase 0 of Build Spec 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Recall card writer + nightly cron

**Files:**
- Create: `memu-core/src/eval/card.ts`
- Create: `memu-core/src/eval/card.test.ts`
- Modify: `memu-core/src/index.ts` (add cron block)

- [ ] **Step 1: Write the failing test**

```typescript
// src/eval/card.test.ts
import { describe, it, expect } from 'vitest';
import { renderRecallCard } from './card';
import { summariseReplay } from './replay';
import type { ReplayDiff } from './types';

function diff(over: Partial<ReplayDiff>): ReplayDiff {
  return {
    id: 'q', query: 'q', passed: true,
    expectedSpaceUris: [], actualSpaceUris: [],
    expectedRetrievalState: 'sourced',
    actualRetrievalPath: 'catalogue', actualRetrievalState: 'sourced',
    missingUris: [], extraUris: [], stateMismatch: false,
    ...over,
  };
}

describe('renderRecallCard', () => {
  it('renders an all-passing run', () => {
    const summary = summariseReplay('c1', new Date('2026-05-15T05:00:00Z'), [
      diff({ id: 'a', passed: true }),
      diff({ id: 'b', passed: true }),
    ]);
    const card = renderRecallCard(summary, null);
    expect(card.title).toMatch(/Retrieval recall · 100%/);
    expect(card.body).toContain('2/2 passing');
    expect(card.body).not.toMatch(/drift/i);
  });

  it('renders a partial run with by-state breakdown', () => {
    const summary = summariseReplay('c1', new Date(), [
      diff({ id: 'a', passed: true, actualRetrievalState: 'sourced' }),
      diff({ id: 'b', passed: false, actualRetrievalState: 'fallback' }),
      diff({ id: 'c', passed: false, actualRetrievalState: 'empty' }),
    ]);
    const card = renderRecallCard(summary, null);
    expect(card.title).toContain('33.3%');
    expect(card.body).toContain('sourced 1/1');
    expect(card.body).toContain('fallback 0/1');
    expect(card.body).toContain('empty 0/1');
  });

  it('flags drift when previous recall was higher', () => {
    const summary = summariseReplay('c1', new Date(), [
      diff({ id: 'a', passed: true }),
      diff({ id: 'b', passed: false }),
    ]);
    const card = renderRecallCard(summary, 80);
    expect(card.body).toMatch(/Drift: down 30/); // 80 → 50
  });

  it('flags improvement when previous was lower', () => {
    const summary = summariseReplay('c1', new Date(), [
      diff({ id: 'a', passed: true }),
      diff({ id: 'b', passed: true }),
    ]);
    const card = renderRecallCard(summary, 50);
    expect(card.body).toMatch(/Drift: up 50/);
  });

  it('omits drift when previous is null', () => {
    const summary = summariseReplay('c1', new Date(), [diff({ id: 'a' })]);
    const card = renderRecallCard(summary, null);
    expect(card.body).not.toMatch(/drift/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/eval/card.test.ts`
Expected: FAIL with "Cannot find module './card'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/eval/card.ts
import { db } from '../db/tenant';
import type { ReplayResult } from './types';

export interface RecallCard {
  title: string;
  body: string;
  cardType: 'eval_recall';
}

export function renderRecallCard(summary: ReplayResult, previousRecall: number | null): RecallCard {
  const { recallPercent, passed, total, byState } = summary;
  const title = `Retrieval recall · ${recallPercent}%`;

  const lines: string[] = [
    `${passed}/${total} passing across the golden set.`,
    '',
    `By state — sourced ${byState.sourced.passed}/${byState.sourced.total} · fallback ${byState.fallback.passed}/${byState.fallback.total} · empty ${byState.empty.passed}/${byState.empty.total}`,
  ];

  if (previousRecall !== null) {
    const delta = Math.round((recallPercent - previousRecall) * 10) / 10;
    if (delta > 0) lines.push('', `Drift: up ${delta} points from yesterday (${previousRecall}%).`);
    else if (delta < 0) lines.push('', `Drift: down ${Math.abs(delta)} points from yesterday (${previousRecall}%).`);
  }

  // List failing query ids so the developer/owner can drill in.
  const failing = summary.diffs.filter(d => !d.passed);
  if (failing.length > 0) {
    lines.push('', 'Failing:', ...failing.slice(0, 10).map(d => `  · ${d.id}`));
    if (failing.length > 10) lines.push(`  · …and ${failing.length - 10} more`);
  }

  return { title, body: lines.join('\n'), cardType: 'eval_recall' };
}

/**
 * Look up yesterday's eval_recall card title for drift comparison.
 * Returns the percent number parsed from the title, or null on first run.
 */
export async function readPreviousRecallPercent(collectiveId: string): Promise<number | null> {
  const res = await db.query<{ title: string }>(
    `SELECT title FROM stream_cards
      WHERE collective_id = $1 AND card_type = 'eval_recall'
      ORDER BY created_at DESC LIMIT 1`,
    [collectiveId],
  );
  if (res.rows.length === 0) return null;
  const m = res.rows[0].title.match(/(\d+(?:\.\d+)?)%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Insert an eval_recall stream card for this collective. One card per
 * day per collective — if today's already exists, update it in place
 * rather than spawning a second row. Reuses the existing stream_cards
 * shape; no schema changes beyond migration 037.
 */
export async function writeRecallCard(
  collectiveId: string,
  adminProfileId: string,
  card: RecallCard,
): Promise<void> {
  // Upsert against (collective_id, card_type, DATE(created_at)) — one
  // recall card per collective per day. If schema doesn't have a unique
  // constraint here (it doesn't, by design — stream_cards is append),
  // use the explicit-delete-then-insert pattern from migration 030.
  await db.query(
    `DELETE FROM stream_cards
       WHERE collective_id = $1
         AND card_type = 'eval_recall'
         AND DATE(created_at) = CURRENT_DATE`,
    [collectiveId],
  );
  await db.query(
    `INSERT INTO stream_cards (
       id, collective_id, source, source_id, card_type,
       title, body, status, created_by
     ) VALUES (
       gen_random_uuid()::text, $1, 'system', 'eval_replay', 'eval_recall',
       $2, $3, 'pending', $4
     )`,
    [collectiveId, card.title, card.body, adminProfileId],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/eval/card.test.ts`
Expected: PASS, 5/5.

> **Note:** `readPreviousRecallPercent` and `writeRecallCard` are DB-touching and follow the project convention (per memu-core CLAUDE.md "Test Principles" + Story 3.4 DoD): pure helpers are unit-tested; DB paths are covered by integration + manual QA on the Z2. The CLI + cron exercise both end-to-end.

- [ ] **Step 5: Wire the nightly cron**

Edit `src/index.ts`. Locate the cron block that contains the daily households sweep (search for `'30 4 * * *'` — that's the 04:30 sweep). After that block, add a new cron at 05:15 (so it runs after the households sweep stabilises but well before the 07:00 morning briefing):

```typescript
    // Phase 0 of Build Spec 1 — nightly retrieval-eval replay per collective.
    // 05:15 Europe/London sits after the 04:30 households sweep and well
    // before the 07:00 morning briefing. Best-effort: any per-collective
    // failure is logged but doesn't poison subsequent collectives.
    cron.schedule('15 5 * * *', async () => {
      try {
        const { loadGoldenQueries } = await import('./eval/golden');
        const { replayAll } = await import('./eval/replay');
        const { renderRecallCard, readPreviousRecallPercent, writeRecallCard } = await import('./eval/card');
        const { enterCollectiveContext } = await import('./db/tenant');
        const { resolve } = await import('node:path');

        const dir = resolve(process.cwd(), 'eval/golden');
        const queries = loadGoldenQueries(dir);
        if (queries.length === 0) {
          server.log.warn('[EVAL] no golden queries — skipping nightly recall card');
          return;
        }

        // Enumerate collectives via the same pattern used by the 04:30 sweep.
        const collectives = await pool.query<{ collective_id: string; admin_profile_id: string }>(
          `SELECT DISTINCT c.id AS collective_id, c.primary_admin_profile_id AS admin_profile_id
             FROM collectives c
            WHERE c.primary_admin_profile_id IS NOT NULL`,
        );

        for (const row of collectives.rows) {
          try {
            const summary = await enterCollectiveContext(row.collective_id, async () => {
              return await replayAll(queries, {
                collectiveId: row.collective_id,
                viewerProfileId: row.admin_profile_id,
              });
            });
            const previous = await enterCollectiveContext(row.collective_id, async () => {
              return await readPreviousRecallPercent(row.collective_id);
            });
            const card = renderRecallCard(summary, previous);
            await enterCollectiveContext(row.collective_id, async () => {
              await writeRecallCard(row.collective_id, row.admin_profile_id, card);
            });
            server.log.info(`[EVAL] recall ${summary.recallPercent}% on collective ${row.collective_id} (${summary.passed}/${summary.total})`);
          } catch (err) {
            server.log.error({ err, collectiveId: row.collective_id }, '[EVAL] per-collective replay failed');
          }
        }
      } catch (err) {
        server.log.error({ err }, '[EVAL] nightly sweep failed');
      }
    }, { timezone: 'Europe/London' });
```

> **Important:** verify the column names against the real schema before committing. Run: `npx tsx -e "import('./src/db/connection').then(async ({pool}) => { const r = await pool.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='collectives' ORDER BY ordinal_position\"); console.log(r.rows.map(c=>c.column_name)); process.exit(0); })"`. If the admin column is named differently (e.g. `owner_profile_id`), update the SELECT.

- [ ] **Step 6: Verify typecheck still clean**

Run: `npx tsc --noEmit`
Expected: no errors. (Dynamic `import()` calls are fine — they're typed via the source files' exports.)

- [ ] **Step 7: Commit**

```bash
git add src/eval/card.ts src/eval/card.test.ts src/index.ts
git commit -m "$(cat <<'EOF'
feat(eval): nightly recall card + 05:15 cron

renderRecallCard formats per-state breakdown + drift vs yesterday.
writeRecallCard upserts one card per collective per day via the
existing stream_cards table (no schema changes beyond migration 037).
Cron enumerates collectives via the same pattern as the 04:30
households sweep; per-collective errors are isolated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Mobile + PWA recall-card rendering

**Files:**
- Modify: `memu-core/mobile/components/StreamCard.tsx` (add `eval_recall` case)
- Modify: `memu-core/src/dashboard/public/dashboard.html` (extend card renderer's type switch)

> **Why this is its own task:** Tasks 1–8 stand up the data pipeline. Without this task, the recall card lands in the `stream_cards` table but renders as the default fallback shape on both surfaces. With this task, it gets a deliberate Today-surface treatment.

- [ ] **Step 1: Read the existing StreamCard renderer**

Run: `grep -n "card_type\|cardType" mobile/components/StreamCard.tsx | head -20`
Identify the type switch pattern. Match it.

- [ ] **Step 2: Add the eval_recall branch in mobile**

In `mobile/components/StreamCard.tsx`, find the card-type switch (likely a chain of `if (cardType === '...')` or a switch statement). Add a new branch matching the existing style — for example:

```tsx
{cardType === 'eval_recall' && (
  <View style={styles.evalRecall}>
    <Text style={styles.evalTitle}>{title}</Text>
    <Text style={styles.evalBody}>{body}</Text>
  </View>
)}
```

Use the existing style tokens (Indigo Sanctuary — `colors.indigo*`, `radius.md`, `spacing.md`). No new tokens. The card is informational only — no Confirm/Dismiss actions (it's a status surface, not a proposal).

- [ ] **Step 3: Add the eval_recall branch in the PWA**

In `src/dashboard/public/dashboard.html`, find the corresponding card renderer (search for the card-type switch in the inline JS — likely a function rendering each `stream_cards` row). Add the same shape: title in bold, body as preformatted text below.

- [ ] **Step 4: Verify both typecheck clean**

Run (in `memu-core/`): `npx tsc --noEmit`
Expected: no errors.

Run (in `memu-core/mobile/`): `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`
Expected: no errors (the pre-existing 2 errors noted in memu-core CLAUDE.md are unrelated and stay).

- [ ] **Step 5: Commit**

```bash
git add mobile/components/StreamCard.tsx src/dashboard/public/dashboard.html
git commit -m "$(cat <<'EOF'
feat(eval): mobile + PWA render eval_recall card

Informational card surface — title + body, no confirm/dismiss actions.
Closes Phase 0 of Build Spec 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Operator action (after the plan is fully executed)

1. **Deploy to Z2**:
   ```
   ssh hareesh@memu-hub
   cd /opt/memu-core
   git pull origin main
   docker compose -f docker-compose.standalone.yml up -d --build memu_core_standalone_api
   ```
   Watch boot logs: `docker logs -f memu_core_standalone_api 2>&1 | grep -i migration`
   Expected: `migration 037 applied`.

2. **Edit the seed URIs to real ones**:
   On the Z2, find Hareesh's real Space URIs:
   ```
   docker exec memu_core_standalone_db psql -U memu -d memu_core \
     -c "SELECT uri, title, category FROM synthesis_pages ORDER BY last_updated_at DESC LIMIT 20;"
   ```
   Edit the seed query `.md` files in `eval/golden/` to point at real URIs from that list. Commit.

3. **Run the CLI manually once to verify**:
   ```
   docker exec memu_core_standalone_api npm run eval:replay -- \
     --collective <hareesh-collective-id> --viewer <hareesh-profile-id>
   ```
   Expected: per-query PASS/FAIL lines + aggregate recall %.

4. **Wait for the next 05:15 cron firing** (or trigger manually for the first time by restarting the API container after 05:15). Hard-refresh the PWA / open the mobile app Today screen and verify the `Retrieval recall · NN%` card is visible.

5. **Daily after that:** the card updates each morning before the 07:00 briefing. Drift line appears from day 2 onward. Card stays informational — no actions on it.

---

## Self-review (run before handing off)

**Spec coverage check** — every Phase 0 story must map to a task:

- Story 0.1 (golden query set) → Tasks 1, 2, 3 ✓
- Story 0.2 (replay tool) → Tasks 4, 5, 6 ✓
- Story 0.3 (scheduled run + surfaced signal) → Tasks 7, 8, 9 ✓

**Placeholder scan** — no TBDs, no "implement later", every step has its actual code or command ✓. The two notes that read "verify on Z2" are deliberate — those are real operator actions in the post-plan checklist, not placeholder steps.

**Type consistency** — `RetrievalPath`, `RetrievalState`, `GoldenQuery`, `ReplayDiff`, `ReplayResult` referenced consistently across Tasks 1, 4, 5, 8 ✓. `RecallCard.cardType: 'eval_recall'` matches migration 037's CHECK addition ✓. Module path `'../db/tenant'` matches the project's pattern (memu-core CLAUDE.md multi-tenancy section) ✓.

**Acceptance criteria from Spec 1 §3:**
- Golden set is a checked-in fixture editable by a non-developer → eval/golden/*.md + README ✓
- Replay tool produces per-query diff + aggregate recall → Tasks 4, 5, 6 ✓
- Nightly run uses existing scheduler and surfaces recall + drift to user → Tasks 7, 8, 9 ✓
- Backend suite green, TypeScript clean → verified at each task ✓

Plan complete.
