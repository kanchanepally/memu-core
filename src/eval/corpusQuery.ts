/**
 * BS3 Phase W1 — corpus_query eval harness.
 *
 * Lives alongside the retrieval-eval machinery (replay.ts / golden.ts)
 * but is shaped differently: corpus_query takes a candidate set as
 * INPUT (rather than retrieving against a live corpus) and the eval
 * scores the LLM's re-ranking decisions.
 *
 * The scenarios under `evals/research/corpus_query/scenarios/` are JSON
 * files (not the markdown+frontmatter shape of the retrieval golden
 * set) because the candidates are structured artefact records, not
 * prose. See evals/research/corpus_query/README.md for the schema.
 *
 * Two pieces:
 *
 *   - `loadScenarios(dir)` + `validateScenario(raw)` — load and shape-
 *     check fixture scenarios. Pure file IO + validation.
 *
 *   - `scoreScenarioResult(scenario, result)` — pure function that
 *     scores a single (scenario, corpusQueryResponse-like) pair. Used
 *     by both unit tests (with deterministic inputs) and the live
 *     eval runner (with actual LLM dispatch).
 *
 * The live runner is intentionally minimal in this slice — Hareesh
 * runs it against his real Z2 corpus when iterating; CI only tests
 * scenario loading and the scoring logic.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SpaceCategory } from '../spaces/model';

// ---------------------------------------------------------------------------
// Scenario shape
// ---------------------------------------------------------------------------

export interface ScenarioCandidate {
  uri: string;
  category: SpaceCategory;
  title: string;
  description: string;
  bodyExcerpt: string;
}

export interface ScenarioExpected {
  topIndices: number[];
  topIndicesTolerant: number[];
  minConfidence: number;
  maxConfidence: number;
  shouldBeEmpty: boolean;
}

export interface CorpusQueryScenario {
  id: string;
  description: string;
  query: string;
  candidates: ScenarioCandidate[];
  expected: ScenarioExpected;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Loading + validation
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: readonly string[] = [
  'person',
  'routine',
  'household',
  'commitment',
  'document',
  'memo',
  'theme',
  'participant',
  'source',
  'question',
  'quote',
];

export function validateScenario(raw: unknown): CorpusQueryScenario {
  if (!raw || typeof raw !== 'object') {
    throw new Error('scenario must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const id = mustString(obj, 'id');
  const description = mustString(obj, 'description');
  const query = mustString(obj, 'query');
  const candidates = mustArray(obj, 'candidates').map((c, i) =>
    validateCandidate(c, `candidates[${i}]`),
  );
  const expected = validateExpected(obj.expected);
  const notes = typeof obj.notes === 'string' ? obj.notes : undefined;

  // Cross-validate expected.topIndices against candidate count.
  for (const idx of [...expected.topIndices, ...expected.topIndicesTolerant]) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) {
      throw new Error(`scenario ${id}: expected index ${idx} out of range (have ${candidates.length} candidates)`);
    }
  }
  if (expected.shouldBeEmpty && expected.topIndices.length > 0) {
    throw new Error(`scenario ${id}: shouldBeEmpty=true but topIndices is non-empty`);
  }
  return { id, description, query, candidates, expected, notes };
}

function validateCandidate(raw: unknown, ctx: string): ScenarioCandidate {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${ctx}: must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const uri = mustString(obj, 'uri', ctx);
  const category = mustString(obj, 'category', ctx);
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`${ctx}: category '${category}' not in known set`);
  }
  return {
    uri,
    category: category as SpaceCategory,
    title: mustString(obj, 'title', ctx),
    description: typeof obj.description === 'string' ? obj.description : '',
    bodyExcerpt: typeof obj.bodyExcerpt === 'string' ? obj.bodyExcerpt : '',
  };
}

function validateExpected(raw: unknown): ScenarioExpected {
  if (!raw || typeof raw !== 'object') {
    throw new Error('expected must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const topIndices = mustIntArray(obj, 'topIndices');
  const topIndicesTolerant = mustIntArray(obj, 'topIndicesTolerant');
  const minConfidence = mustUnit(obj, 'minConfidence');
  const maxConfidence = mustUnit(obj, 'maxConfidence');
  if (maxConfidence < minConfidence) {
    throw new Error('expected.maxConfidence must be >= minConfidence');
  }
  const shouldBeEmpty = obj.shouldBeEmpty === true;
  return { topIndices, topIndicesTolerant, minConfidence, maxConfidence, shouldBeEmpty };
}

function mustString(obj: Record<string, unknown>, key: string, ctx?: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`${ctx ?? 'scenario'}: ${key} must be non-empty string`);
  }
  return v;
}

function mustArray(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new Error(`scenario: ${key} must be array`);
  }
  return v;
}

function mustIntArray(obj: Record<string, unknown>, key: string): number[] {
  const arr = mustArray(obj, key);
  return arr.map((n, i) => {
    if (!Number.isInteger(n)) {
      throw new Error(`scenario: ${key}[${i}] must be integer`);
    }
    return n as number;
  });
}

function mustUnit(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(`scenario: ${key} must be number in [0,1]`);
  }
  return v;
}

export function loadScenarios(dir: string): CorpusQueryScenario[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => {
    const raw = readFileSync(resolve(dir, f), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`scenario ${f}: invalid JSON — ${err instanceof Error ? err.message : err}`);
    }
    return validateScenario(parsed);
  });
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * The shape we score against. Compatible with WorkbenchQueryResponse
 * from src/intelligence/workbench.ts but reduced to the fields the
 * scorer actually inspects, so the runner can be tested with literal
 * objects without standing up the full agent.
 */
export interface ScoredResultShape {
  results: Array<{ uri: string; score: number; why: string; semanticRank: number }>;
  confidence: number;
}

export interface ScenarioScore {
  scenarioId: string;
  passed: boolean;
  topMatch: boolean;          // top-N strict match (set equality on topIndices)
  recallTolerant: number;     // fraction of topIndicesTolerant present in results
  confidenceInBand: boolean;
  emptyCorrect: boolean;      // if shouldBeEmpty, did model actually return empty?
  notes: string[];
}

const STRICT_TOP_N = 3;

export function scoreScenarioResult(
  scenario: CorpusQueryScenario,
  result: ScoredResultShape,
): ScenarioScore {
  const notes: string[] = [];

  // Empty correctness gate — if scenario says "should be empty", the
  // ONLY pass condition is an empty results array. A high-confidence
  // empty is a fail (the model should NOT be confident about nothing).
  if (scenario.expected.shouldBeEmpty) {
    const emptyCorrect = result.results.length === 0;
    if (!emptyCorrect) {
      notes.push(`expected empty but got ${result.results.length} result(s)`);
    }
    const confidenceInBand =
      result.confidence >= scenario.expected.minConfidence &&
      result.confidence <= scenario.expected.maxConfidence;
    if (!confidenceInBand) {
      notes.push(
        `confidence ${result.confidence} outside band [${scenario.expected.minConfidence}, ${scenario.expected.maxConfidence}]`,
      );
    }
    return {
      scenarioId: scenario.id,
      passed: emptyCorrect && confidenceInBand,
      topMatch: emptyCorrect,
      recallTolerant: emptyCorrect ? 1 : 0,
      confidenceInBand,
      emptyCorrect,
      notes,
    };
  }

  // Map result URIs back to indices in the scenario's candidate list.
  const uriToIndex = new Map<string, number>();
  scenario.candidates.forEach((c, i) => uriToIndex.set(c.uri, i));
  const resultIndices = result.results
    .map(r => uriToIndex.get(r.uri))
    .filter((i): i is number => typeof i === 'number');

  const strictExpectedSet = new Set(scenario.expected.topIndices);
  const tolerantExpectedSet = new Set(scenario.expected.topIndicesTolerant);

  const topNActual = new Set(resultIndices.slice(0, STRICT_TOP_N));
  const topMatch =
    strictExpectedSet.size > 0 &&
    setEqualOrContains(topNActual, strictExpectedSet);
  if (!topMatch && strictExpectedSet.size > 0) {
    notes.push(
      `strict top-${STRICT_TOP_N} mismatch (expected ${[...strictExpectedSet].join(',')}, got ${[...topNActual].join(',')})`,
    );
  }

  // Tolerant recall — fraction of the tolerant set present anywhere in the result.
  const tolerantHit = [...tolerantExpectedSet].filter(i =>
    resultIndices.includes(i),
  ).length;
  const recallTolerant = tolerantExpectedSet.size > 0 ? tolerantHit / tolerantExpectedSet.size : 1;

  const confidenceInBand =
    result.confidence >= scenario.expected.minConfidence &&
    result.confidence <= scenario.expected.maxConfidence;
  if (!confidenceInBand) {
    notes.push(
      `confidence ${result.confidence} outside band [${scenario.expected.minConfidence}, ${scenario.expected.maxConfidence}]`,
    );
  }

  return {
    scenarioId: scenario.id,
    passed: topMatch && confidenceInBand && recallTolerant >= 0.8,
    topMatch,
    recallTolerant,
    confidenceInBand,
    emptyCorrect: true,
    notes,
  };
}

// True iff `superset` contains every element in `expected`. We do NOT
// require equality — extra results are tolerated as long as the
// expected indices all show up.
function setEqualOrContains(superset: Set<number>, expected: Set<number>): boolean {
  for (const e of expected) if (!superset.has(e)) return false;
  return true;
}

export interface ScenarioRunSummary {
  total: number;
  passed: number;
  passRate: number;
  averageRecallTolerant: number;
  emptyCorrectness: number;   // 1.0 if all shouldBeEmpty scenarios scored emptyCorrect
  scores: ScenarioScore[];
}

export function summariseScores(scores: ScenarioScore[]): ScenarioRunSummary {
  if (scores.length === 0) {
    return { total: 0, passed: 0, passRate: 0, averageRecallTolerant: 0, emptyCorrectness: 1, scores: [] };
  }
  const passed = scores.filter(s => s.passed).length;
  const recall = scores.reduce((a, s) => a + s.recallTolerant, 0) / scores.length;
  const emptyScores = scores.filter(s => s.scenarioId.startsWith('03-') || s.notes.some(n => n.includes('empty')));
  const emptyCorrect = emptyScores.length === 0
    ? 1
    : emptyScores.filter(s => s.emptyCorrect).length / emptyScores.length;
  return {
    total: scores.length,
    passed,
    passRate: passed / scores.length,
    averageRecallTolerant: recall,
    emptyCorrectness: emptyCorrect,
    scores,
  };
}
