/**
 * BS3 Phase W1 — unit tests for the pure helpers in workbench.ts.
 *
 * DB-touching paths (corpusQuery end-to-end) are covered by manual QA
 * + the eval harness against a seeded fixture workspace on Z2 — same
 * convention as Spaces store tests (src/spaces/store.test.ts).
 *
 * This file covers:
 *   - truncateBodyExcerpt: whitespace collapse, ellipsis behaviour
 *   - renderCandidates: zero-indexed shape, empty case, formatting
 *   - parseCorpusQueryResponse: the architectural anti-hallucination
 *     gate — invented indices are dropped, malformed JSON degrades to
 *     empty rather than throwing
 */

import { describe, it, expect } from 'vitest';
import {
  truncateBodyExcerpt,
  renderCandidates,
  parseCorpusQueryResponse,
} from './workbench';

describe('truncateBodyExcerpt', () => {
  it('returns short text unchanged', () => {
    expect(truncateBodyExcerpt('Hello world.')).toBe('Hello world.');
  });

  it('collapses runs of whitespace into single spaces', () => {
    expect(truncateBodyExcerpt('Line one.\n\n  Line   two.')).toBe('Line one. Line two.');
  });

  it('trims leading and trailing whitespace', () => {
    expect(truncateBodyExcerpt('   middle   ')).toBe('middle');
  });

  it('appends an ellipsis when truncating', () => {
    const long = 'a'.repeat(500);
    const out = truncateBodyExcerpt(long, 50);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it('does not append ellipsis when at exactly the limit', () => {
    const text = 'a'.repeat(50);
    const out = truncateBodyExcerpt(text, 50);
    expect(out).toBe(text);
    expect(out.endsWith('…')).toBe(false);
  });

  it('handles empty input', () => {
    expect(truncateBodyExcerpt('')).toBe('');
  });
});

describe('renderCandidates', () => {
  it('returns a helpful empty-state string when no candidates', () => {
    const out = renderCandidates([]);
    expect(out).toContain('no candidates');
  });

  it('renders one candidate with index, category, title', () => {
    const out = renderCandidates([
      {
        uri: 'memu://x/memo/abc',
        category: 'memo',
        title: 'Consent as ritual',
        description: 'Cookie banners as a coercive shape',
        bodyExcerpt: 'We click I agree a hundred times a week.',
      },
    ]);
    expect(out).toContain('[0]');
    expect(out).toContain('(memo)');
    expect(out).toContain('Consent as ritual');
    expect(out).toContain('Cookie banners as a coercive shape');
    expect(out).toContain('We click I agree');
  });

  it('uses zero-indexed positions across multiple candidates', () => {
    const out = renderCandidates([
      { uri: 'a', category: 'memo', title: 'A', description: '', bodyExcerpt: '' },
      { uri: 'b', category: 'quote', title: 'B', description: '', bodyExcerpt: '' },
      { uri: 'c', category: 'theme', title: 'C', description: '', bodyExcerpt: '' },
    ]);
    expect(out).toContain('[0]');
    expect(out).toContain('[1]');
    expect(out).toContain('[2]');
    expect(out).not.toContain('[3]');
  });

  it('omits empty description and empty body lines', () => {
    const out = renderCandidates([
      { uri: 'a', category: 'memo', title: 'Bare', description: '', bodyExcerpt: '' },
    ]);
    expect(out).toContain('[0] (memo) Bare');
    expect(out).not.toContain('Body:');
    expect(out).not.toMatch(/\n\s+\n/);
  });
});

describe('parseCorpusQueryResponse — truth gate', () => {
  it('parses a clean response with all fields', () => {
    const raw = JSON.stringify({
      ranked: [
        { index: 0, score: 0.9, why: 'Direct match on graded inequality.' },
        { index: 2, score: 0.7, why: 'Supporting framing from Doctorow.' },
      ],
      confidence: 0.85,
      notes: 'Top result nails it.',
    });
    const out = parseCorpusQueryResponse(raw, 5);
    expect(out.ranked).toHaveLength(2);
    expect(out.ranked[0]).toEqual({ index: 0, score: 0.9, why: 'Direct match on graded inequality.' });
    expect(out.confidence).toBe(0.85);
    expect(out.notes).toBe('Top result nails it.');
  });

  it('drops fabricated indices that are out of range', () => {
    const raw = JSON.stringify({
      ranked: [
        { index: 0, score: 0.9, why: 'Real.' },
        { index: 99, score: 0.8, why: 'Fabricated index.' },
        { index: -1, score: 0.5, why: 'Negative index.' },
      ],
      confidence: 0.5,
    });
    const out = parseCorpusQueryResponse(raw, 5);
    expect(out.ranked).toHaveLength(1);
    expect(out.ranked[0].index).toBe(0);
  });

  it('drops items with empty rationale', () => {
    const raw = JSON.stringify({
      ranked: [
        { index: 0, score: 0.9, why: '   ' },
        { index: 1, score: 0.8, why: 'Has a reason.' },
      ],
      confidence: 0.7,
    });
    const out = parseCorpusQueryResponse(raw, 3);
    expect(out.ranked).toHaveLength(1);
    expect(out.ranked[0].index).toBe(1);
  });

  it('dedupes by index, keeping the first occurrence', () => {
    const raw = JSON.stringify({
      ranked: [
        { index: 1, score: 0.9, why: 'First mention.' },
        { index: 1, score: 0.5, why: 'Duplicate.' },
      ],
      confidence: 0.6,
    });
    const out = parseCorpusQueryResponse(raw, 3);
    expect(out.ranked).toHaveLength(1);
    expect(out.ranked[0].why).toBe('First mention.');
  });

  it('clamps score and confidence to [0, 1]', () => {
    const raw = JSON.stringify({
      ranked: [
        { index: 0, score: 1.5, why: 'Over.' },
        { index: 1, score: -0.2, why: 'Under.' },
      ],
      confidence: 2.0,
    });
    const out = parseCorpusQueryResponse(raw, 3);
    expect(out.ranked[0].score).toBe(1);
    expect(out.ranked[1].score).toBe(0);
    expect(out.confidence).toBe(1);
  });

  it('returns empty ranked on malformed JSON without throwing', () => {
    const out = parseCorpusQueryResponse('not json at all', 5);
    expect(out.ranked).toHaveLength(0);
    expect(out.confidence).toBe(0);
    expect(out.notes).toBe('no parseable response from rank step');
  });

  it('returns empty ranked when JSON has no ranked key', () => {
    const out = parseCorpusQueryResponse('{"confidence": 0.5}', 5);
    expect(out.ranked).toHaveLength(0);
    expect(out.confidence).toBe(0.5);
  });

  it('extracts JSON from prose-wrapped responses', () => {
    const raw = `Here are the results:\n\n${JSON.stringify({
      ranked: [{ index: 0, score: 0.9, why: 'Yes.' }],
      confidence: 0.8,
    })}\n\nLet me know if you need more.`;
    const out = parseCorpusQueryResponse(raw, 3);
    expect(out.ranked).toHaveLength(1);
    expect(out.ranked[0].index).toBe(0);
  });

  it('handles an explicit empty result (model says nothing matches)', () => {
    const raw = JSON.stringify({
      ranked: [],
      confidence: 0,
      notes: 'No strong match — corpus has nothing on this term.',
    });
    const out = parseCorpusQueryResponse(raw, 5);
    expect(out.ranked).toHaveLength(0);
    expect(out.confidence).toBe(0);
    expect(out.notes).toContain('No strong match');
  });

  it('floors non-integer indices', () => {
    const raw = JSON.stringify({
      ranked: [{ index: 1.7, score: 0.5, why: 'Floats normalised.' }],
      confidence: 0.5,
    });
    const out = parseCorpusQueryResponse(raw, 3);
    expect(out.ranked).toHaveLength(1);
    expect(out.ranked[0].index).toBe(1);
  });

  it('rejects non-numeric indices entirely', () => {
    const raw = JSON.stringify({
      ranked: [{ index: 'one', score: 0.5, why: 'String index.' }],
      confidence: 0.5,
    });
    const out = parseCorpusQueryResponse(raw, 3);
    expect(out.ranked).toHaveLength(0);
  });

  it('throws on negative candidateCount (programmer error)', () => {
    expect(() => parseCorpusQueryResponse('{}', -1)).toThrow(/non-negative/);
  });
});
