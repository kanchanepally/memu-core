/**
 * BS3 Phase W1 — eval harness tests.
 *
 * Tests three things:
 *
 *   1. All shipped scenarios load + validate without error.
 *   2. validateScenario rejects malformed input with clear errors.
 *   3. scoreScenarioResult handles every branch: empty / topMatch /
 *      tolerant recall / confidence band.
 *
 * A live LLM run against actual corpusQuery() is gated on
 * MEMU_RUN_LLM_EVALS=true and is intentionally not exercised in CI —
 * the harness's correctness is what's locked here.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  loadScenarios,
  validateScenario,
  scoreScenarioResult,
  summariseScores,
  type CorpusQueryScenario,
  type ScoredResultShape,
} from './corpusQuery';

const SCENARIOS_DIR = resolve(__dirname, '..', '..', 'evals', 'research', 'corpus_query', 'scenarios');

describe('corpus_query eval — scenario loading', () => {
  it('loads at least one shipped scenario', () => {
    const scenarios = loadScenarios(SCENARIOS_DIR);
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
  });

  it('every shipped scenario validates', () => {
    const scenarios = loadScenarios(SCENARIOS_DIR);
    for (const s of scenarios) {
      expect(s.id).toBeTruthy();
      expect(s.candidates.length).toBeGreaterThan(0);
      expect(s.description).toBeTruthy();
    }
  });

  it('returns empty array for non-existent directory', () => {
    expect(loadScenarios('/nonexistent/path/at/all')).toEqual([]);
  });
});

describe('validateScenario', () => {
  it('rejects non-object', () => {
    expect(() => validateScenario(null)).toThrow(/must be an object/);
    expect(() => validateScenario('hello')).toThrow(/must be an object/);
  });

  it('rejects missing required fields', () => {
    expect(() => validateScenario({})).toThrow(/id/);
  });

  it('rejects scenario with topIndex out of range', () => {
    expect(() =>
      validateScenario({
        id: 'bad',
        description: 'oob',
        query: 'q',
        candidates: [
          { uri: 'a', category: 'memo', title: 'A', description: '', bodyExcerpt: '' },
        ],
        expected: {
          topIndices: [5],
          topIndicesTolerant: [],
          minConfidence: 0.5,
          maxConfidence: 0.9,
          shouldBeEmpty: false,
        },
      }),
    ).toThrow(/out of range/);
  });

  it('rejects contradictory shouldBeEmpty + populated topIndices', () => {
    expect(() =>
      validateScenario({
        id: 'bad',
        description: 'fixture for negative test',
        query: 'q',
        candidates: [
          { uri: 'a', category: 'memo', title: 'A', description: '', bodyExcerpt: '' },
        ],
        expected: {
          topIndices: [0],
          topIndicesTolerant: [],
          minConfidence: 0,
          maxConfidence: 0.3,
          shouldBeEmpty: true,
        },
      }),
    ).toThrow(/shouldBeEmpty/);
  });

  it('rejects unknown category', () => {
    expect(() =>
      validateScenario({
        id: 'bad',
        description: 'fixture for negative test',
        query: 'q',
        candidates: [
          { uri: 'a', category: 'made-up', title: 'A', description: '', bodyExcerpt: '' },
        ],
        expected: {
          topIndices: [],
          topIndicesTolerant: [],
          minConfidence: 0,
          maxConfidence: 1,
          shouldBeEmpty: true,
        },
      }),
    ).toThrow(/category/);
  });

  it('rejects maxConfidence < minConfidence', () => {
    expect(() =>
      validateScenario({
        id: 'bad',
        description: 'fixture for negative test',
        query: 'q',
        candidates: [
          { uri: 'a', category: 'memo', title: 'A', description: '', bodyExcerpt: '' },
        ],
        expected: {
          topIndices: [],
          topIndicesTolerant: [],
          minConfidence: 0.8,
          maxConfidence: 0.5,
          shouldBeEmpty: true,
        },
      }),
    ).toThrow(/maxConfidence/);
  });
});

// ---------------------------------------------------------------------------
// scoreScenarioResult
// ---------------------------------------------------------------------------

function fixtureScenario(): CorpusQueryScenario {
  return {
    id: 'fixture',
    description: 'fixture for scoring tests',
    query: 'q',
    candidates: [
      { uri: 'a', category: 'memo', title: 'A', description: '', bodyExcerpt: '' },
      { uri: 'b', category: 'quote', title: 'B', description: '', bodyExcerpt: '' },
      { uri: 'c', category: 'theme', title: 'C', description: '', bodyExcerpt: '' },
      { uri: 'd', category: 'memo', title: 'D', description: '', bodyExcerpt: '' },
    ],
    expected: {
      topIndices: [0],
      topIndicesTolerant: [0, 1],
      minConfidence: 0.7,
      maxConfidence: 1.0,
      shouldBeEmpty: false,
    },
  };
}

function asResult(uris: string[], confidence: number): ScoredResultShape {
  return {
    results: uris.map((uri, i) => ({ uri, score: 0.5, why: 'mock', semanticRank: i })),
    confidence,
  };
}

describe('scoreScenarioResult — non-empty scenarios', () => {
  it('passes when top result matches and confidence is in band', () => {
    const s = fixtureScenario();
    const out = scoreScenarioResult(s, asResult(['a', 'b'], 0.85));
    expect(out.passed).toBe(true);
    expect(out.topMatch).toBe(true);
    expect(out.recallTolerant).toBe(1);
    expect(out.confidenceInBand).toBe(true);
  });

  it('fails when top expected index is missing', () => {
    const s = fixtureScenario();
    const out = scoreScenarioResult(s, asResult(['c', 'd'], 0.85));
    expect(out.passed).toBe(false);
    expect(out.topMatch).toBe(false);
    expect(out.notes.some(n => n.includes('strict top'))).toBe(true);
  });

  it('fails when confidence is below the band', () => {
    const s = fixtureScenario();
    const out = scoreScenarioResult(s, asResult(['a'], 0.4));
    expect(out.passed).toBe(false);
    expect(out.confidenceInBand).toBe(false);
  });

  it('fails when confidence is above the band', () => {
    const s = fixtureScenario();
    s.expected.maxConfidence = 0.9;
    const out = scoreScenarioResult(s, asResult(['a'], 0.95));
    expect(out.passed).toBe(false);
    expect(out.confidenceInBand).toBe(false);
  });

  it('counts partial tolerant recall', () => {
    const s = fixtureScenario(); // tolerant = [0, 1]
    const out = scoreScenarioResult(s, asResult(['a', 'c'], 0.8));
    expect(out.recallTolerant).toBe(0.5);
  });

  it('tolerates extra results in the top-N as long as expected indices are present', () => {
    const s = fixtureScenario();
    const out = scoreScenarioResult(s, asResult(['a', 'd', 'b'], 0.8));
    expect(out.topMatch).toBe(true);
  });
});

describe('scoreScenarioResult — empty scenarios', () => {
  function emptyScenario(): CorpusQueryScenario {
    return {
      id: '03-empty',
      description: 'should be empty',
      query: 'q',
      candidates: [
        { uri: 'a', category: 'memo', title: 'A', description: '', bodyExcerpt: '' },
      ],
      expected: {
        topIndices: [],
        topIndicesTolerant: [],
        minConfidence: 0,
        maxConfidence: 0.3,
        shouldBeEmpty: true,
      },
    };
  }

  it('passes when results are empty and confidence is low', () => {
    const out = scoreScenarioResult(emptyScenario(), asResult([], 0.1));
    expect(out.passed).toBe(true);
    expect(out.emptyCorrect).toBe(true);
  });

  it('fails when results are non-empty even with low confidence', () => {
    const out = scoreScenarioResult(emptyScenario(), asResult(['a'], 0.1));
    expect(out.passed).toBe(false);
    expect(out.emptyCorrect).toBe(false);
  });

  it('fails when results are empty but model claimed high confidence', () => {
    const out = scoreScenarioResult(emptyScenario(), asResult([], 0.9));
    expect(out.passed).toBe(false);
    expect(out.emptyCorrect).toBe(true);
    expect(out.confidenceInBand).toBe(false);
  });
});

describe('summariseScores', () => {
  it('handles empty input', () => {
    const out = summariseScores([]);
    expect(out.total).toBe(0);
    expect(out.passed).toBe(0);
    expect(out.passRate).toBe(0);
  });

  it('aggregates pass-rate and recall', () => {
    const out = summariseScores([
      { scenarioId: 'a', passed: true, topMatch: true, recallTolerant: 1, confidenceInBand: true, emptyCorrect: true, notes: [] },
      { scenarioId: 'b', passed: false, topMatch: false, recallTolerant: 0.5, confidenceInBand: true, emptyCorrect: true, notes: ['mismatch'] },
    ]);
    expect(out.total).toBe(2);
    expect(out.passed).toBe(1);
    expect(out.passRate).toBe(0.5);
    expect(out.averageRecallTolerant).toBe(0.75);
  });
});
