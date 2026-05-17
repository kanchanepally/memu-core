/**
 * BS3 Phase W3 — unit tests for pure helpers in writingSpaceStore.ts.
 *
 * DB-touching functions (createWritingSpace, saveWritingSpaceVersion,
 * transitionStatus, runCitePickerDeterministic, …) are covered by
 * manual QA per the project's existing test convention.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  WRITING_STATUSES,
  isWritingStatus,
  CITATION_FORMATS,
  isCitationFormat,
  computeSurroundingHash,
  validateStatusTransition,
  extractCitationPlaceholders,
  summariseChanges,
} from './writingSpaceStore';

// ---------------------------------------------------------------------------
// Constant set sanity — locking these in means future migrations to the
// CHECK constraints have to update both schema and code together.
// ---------------------------------------------------------------------------

describe('WRITING_STATUSES — schema alignment', () => {
  it('matches the 5 BS3 §8 status values in lifecycle order', () => {
    expect([...WRITING_STATUSES]).toEqual([
      'drafting',
      'revising',
      'ready_to_publish',
      'published',
      'archived',
    ]);
  });
});

describe('isWritingStatus', () => {
  it('matches every valid status', () => {
    for (const s of WRITING_STATUSES) expect(isWritingStatus(s)).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isWritingStatus('Drafting')).toBe(false);
    expect(isWritingStatus('')).toBe(false);
    expect(isWritingStatus('done')).toBe(false);
    expect(isWritingStatus(null)).toBe(false);
    expect(isWritingStatus(undefined)).toBe(false);
    expect(isWritingStatus(7)).toBe(false);
  });
});

describe('CITATION_FORMATS — schema alignment', () => {
  it('matches the 4 BS3 citation_format values', () => {
    expect([...CITATION_FORMATS]).toEqual([
      'footnote',
      'inline',
      'parenthetical',
      'author_date',
    ]);
  });
});

describe('isCitationFormat', () => {
  it('matches every valid format', () => {
    for (const f of CITATION_FORMATS) expect(isCitationFormat(f)).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isCitationFormat('Footnote')).toBe(false);
    expect(isCitationFormat('')).toBe(false);
    expect(isCitationFormat(null)).toBe(false);
    expect(isCitationFormat(undefined)).toBe(false);
    expect(isCitationFormat('bibtex')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeSurroundingHash
// ---------------------------------------------------------------------------

describe('computeSurroundingHash', () => {
  it('hashes the empty string for an empty body', () => {
    const expected = crypto.createHash('sha1').update('', 'utf8').digest('hex');
    expect(computeSurroundingHash('', 0)).toBe(expected);
    expect(computeSurroundingHash('', 999)).toBe(expected);
  });

  it('hashes the window centred on the position with default windowSize=200', () => {
    const body = 'a'.repeat(50) + 'TARGET' + 'b'.repeat(50);
    // position pointing at TARGET — windowSize 200 / half 100, so the
    // entire body fits in the window.
    const h = computeSurroundingHash(body, 50);
    const expected = crypto.createHash('sha1').update(body, 'utf8').digest('hex');
    expect(h).toBe(expected);
  });

  it('respects a custom windowSize', () => {
    const body = 'abcdefghij'; // 10 chars
    // windowSize=4, position=5 — half=2, window = body[3..7] = 'defg'
    const expected = crypto.createHash('sha1').update('defg', 'utf8').digest('hex');
    expect(computeSurroundingHash(body, 5, 4)).toBe(expected);
  });

  it('clamps position to body bounds', () => {
    const body = 'hello world';
    // position past end clamps to body.length=11
    // half = 100 (windowSize 200) so window = entire body
    const expectedEnd = crypto.createHash('sha1').update(body, 'utf8').digest('hex');
    expect(computeSurroundingHash(body, 9999)).toBe(expectedEnd);
    // negative position clamps to 0 — same window (entire body) because half is large
    expect(computeSurroundingHash(body, -50)).toBe(expectedEnd);
  });

  it('handles non-string body gracefully', () => {
    const expected = crypto.createHash('sha1').update('', 'utf8').digest('hex');
    // @ts-expect-error — testing runtime defence
    expect(computeSurroundingHash(null, 0)).toBe(expected);
    // @ts-expect-error — testing runtime defence
    expect(computeSurroundingHash(undefined, 0)).toBe(expected);
  });

  it('is deterministic — same input always yields same output', () => {
    const body = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
    const a = computeSurroundingHash(body, 100);
    const b = computeSurroundingHash(body, 100);
    expect(a).toBe(b);
  });

  it('changes when the surrounding context changes', () => {
    const a = computeSurroundingHash('hello world', 5);
    const b = computeSurroundingHash('hello WORLD', 5);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// validateStatusTransition
// ---------------------------------------------------------------------------

describe('validateStatusTransition — allowed transitions', () => {
  const allowed: Array<[string, string]> = [
    ['drafting', 'revising'],
    ['drafting', 'ready_to_publish'],
    ['drafting', 'archived'],
    ['revising', 'drafting'],
    ['revising', 'ready_to_publish'],
    ['revising', 'archived'],
    ['ready_to_publish', 'published'],
    ['ready_to_publish', 'revising'],
    ['ready_to_publish', 'archived'],
    ['published', 'archived'],
    ['archived', 'drafting'],
  ];
  it.each(allowed)('allows %s → %s', (from, to) => {
    const r = validateStatusTransition(from as any, to as any);
    expect(r.ok).toBe(true);
  });
});

describe('validateStatusTransition — forbidden transitions', () => {
  it('rejects same-state transitions', () => {
    for (const s of WRITING_STATUSES) {
      const r = validateStatusTransition(s, s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(`already_${s}`);
    }
  });

  it('rejects backwards from published except → archived', () => {
    const r1 = validateStatusTransition('published', 'drafting');
    expect(r1.ok).toBe(false);
    const r2 = validateStatusTransition('published', 'revising');
    expect(r2.ok).toBe(false);
    const r3 = validateStatusTransition('published', 'ready_to_publish');
    expect(r3.ok).toBe(false);
  });

  it('rejects → drafting from non-drafting except from archived', () => {
    // revising → drafting is allowed (re-open mid-revise to keep
    // working); ready_to_publish → drafting is NOT — go via revising.
    const r = validateStatusTransition('ready_to_publish', 'drafting');
    expect(r.ok).toBe(false);
  });

  it('rejects archived → ready_to_publish (must go via drafting)', () => {
    const r = validateStatusTransition('archived', 'ready_to_publish');
    expect(r.ok).toBe(false);
  });

  it('rejects unknown status values', () => {
    const r1 = validateStatusTransition('drafting', 'wat' as any);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toMatch(/invalid_to_status/);
    const r2 = validateStatusTransition('wat' as any, 'drafting');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/invalid_from_status/);
  });

  it('always returns a structured reason on failure', () => {
    const r = validateStatusTransition('published', 'drafting');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBeDefined();
      expect(typeof r.reason).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// extractCitationPlaceholders
// ---------------------------------------------------------------------------

describe('extractCitationPlaceholders', () => {
  it('returns [] for empty / non-string input', () => {
    expect(extractCitationPlaceholders('')).toEqual([]);
    // @ts-expect-error — runtime defence
    expect(extractCitationPlaceholders(null)).toEqual([]);
    // @ts-expect-error — runtime defence
    expect(extractCitationPlaceholders(undefined)).toEqual([]);
  });

  it('extracts a single placeholder with its position', () => {
    const body = 'Some prose.<!-- cite:c1 -->';
    const out = extractCitationPlaceholders(body);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('c1');
    expect(out[0].position).toBe(11);
  });

  it('extracts multiple placeholders in document order', () => {
    const body = 'A<!-- cite:abc -->B<!-- cite:def -->C';
    const out = extractCitationPlaceholders(body);
    expect(out.map(c => c.id)).toEqual(['abc', 'def']);
    expect(out[0].position).toBeLessThan(out[1].position);
  });

  it('tolerates whitespace inside the placeholder', () => {
    const body = '<!--  cite:xyz  -->';
    const out = extractCitationPlaceholders(body);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('xyz');
  });

  it('accepts UUID-style ids and short ids', () => {
    const id1 = crypto.randomUUID();
    const body = `<!-- cite:${id1} -->some prose<!-- cite:c2 -->`;
    const out = extractCitationPlaceholders(body);
    expect(out.map(c => c.id)).toEqual([id1, 'c2']);
  });

  it('ignores malformed markers', () => {
    const body = '<!-- cite -->no id<!-- cite: -->empty<!--cite:x-->also fine';
    const out = extractCitationPlaceholders(body);
    // The third marker (no space before cite:) still matches the
    // permissive pattern (we only require optional whitespace).
    expect(out.map(c => c.id)).toEqual(['x']);
  });
});

// ---------------------------------------------------------------------------
// summariseChanges
// ---------------------------------------------------------------------------

describe('summariseChanges', () => {
  it('returns "No changes" for identical bodies', () => {
    expect(summariseChanges('', '')).toBe('No changes');
    expect(summariseChanges('hello world', 'hello world')).toBe('No changes');
  });

  it('reports added words', () => {
    expect(summariseChanges('one two', 'one two three four')).toBe('Added 2 words');
    expect(summariseChanges('hello', 'hello there')).toBe('Added 1 word');
  });

  it('reports removed words', () => {
    expect(summariseChanges('one two three four', 'one two')).toBe('Removed 2 words');
    expect(summariseChanges('hello there', 'hello')).toBe('Removed 1 word');
  });

  it('reports edited when word count is unchanged but text differs', () => {
    expect(summariseChanges('hello world', 'goodbye sailor')).toBe(
      'Edited (word count unchanged)',
    );
  });

  it('handles empty before / empty after', () => {
    expect(summariseChanges('', 'a brand new draft')).toBe('Added 4 words');
    expect(summariseChanges('a brand new draft', '')).toBe('Removed 4 words');
  });

  it('treats whitespace-only differences as no word-count change', () => {
    // Whitespace normalises away, so word count is the same → "Edited"
    expect(summariseChanges('hello world', 'hello\n\nworld')).toBe(
      'Edited (word count unchanged)',
    );
  });

  it('handles non-string input as empty', () => {
    // @ts-expect-error — runtime defence
    expect(summariseChanges(null, null)).toBe('No changes');
    // @ts-expect-error — runtime defence
    expect(summariseChanges(undefined, 'hello world')).toBe('Added 2 words');
  });

  it('counts hyphenated tokens as a single word', () => {
    expect(summariseChanges('', 'state-of-the-art research')).toBe('Added 2 words');
  });
});
