/**
 * Story 2.1 — pure-logic tests for the Space model. No DB, no FS.
 * Visibility resolution is load-bearing for privacy, so it gets the
 * most coverage.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSpaceUri,
  parseSpaceUri,
  slugify,
  resolveVisibility,
  canSee,
  FAMILY_CATEGORIES,
  RESEARCH_CATEGORIES,
  SPACE_CATEGORIES,
  getCategorySetForType,
  isCategoryAllowedForType,
  type FamilyRoster,
} from './model';

const roster: FamilyRoster = {
  all: ['hareesh', 'rach', 'robin'],
  adults: ['hareesh', 'rach'],
  partners: ['hareesh', 'rach'],
};

describe('URI helpers', () => {
  it('builds a memu:// URI with category and uuid', () => {
    expect(buildSpaceUri('fam-1', 'routine', 'abc123')).toBe('memu://fam-1/routine/abc123');
  });

  it('parses back a valid URI', () => {
    expect(parseSpaceUri('memu://fam-1/person/u-9')).toEqual({
      familyId: 'fam-1',
      category: 'person',
      uuid: 'u-9',
    });
  });

  it('rejects an unknown category', () => {
    expect(parseSpaceUri('memu://fam-1/bogus/u-9')).toBeNull();
  });

  it('rejects malformed URIs', () => {
    expect(parseSpaceUri('https://example/people/x')).toBeNull();
    expect(parseSpaceUri('memu://just-one-segment')).toBeNull();
  });
});

describe('slugify', () => {
  it('lowercases and dashes weird input', () => {
    expect(slugify("Robin's Swimming! 2026")).toBe('robin-s-swimming-2026');
  });
  it('falls back to "untitled" for empty input', () => {
    expect(slugify('!!!')).toBe('untitled');
  });
  it('truncates to 64 chars', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe('resolveVisibility', () => {
  it('expands family to the full roster', () => {
    expect(resolveVisibility('family', [], roster)).toEqual(['hareesh', 'rach', 'robin']);
  });
  it('expands adults_only to adults', () => {
    expect(resolveVisibility('adults_only', [], roster)).toEqual(['hareesh', 'rach']);
  });
  it('expands partners_only to partners', () => {
    expect(resolveVisibility('partners_only', [], roster)).toEqual(['hareesh', 'rach']);
  });
  it('individual returns the people field', () => {
    expect(resolveVisibility('individual', ['hareesh'], roster)).toEqual(['hareesh']);
  });
  it('private returns only the first person', () => {
    expect(resolveVisibility('private', ['hareesh', 'rach'], roster)).toEqual(['hareesh']);
  });
  it('explicit array passes through', () => {
    const explicit = ['hareesh', 'https://alice.solid/profile#me'];
    expect(resolveVisibility(explicit, [], roster)).toEqual(explicit);
  });
});

describe('canSee', () => {
  it('child cannot see adults_only', () => {
    expect(canSee('robin', { visibility: 'adults_only', people: [] }, roster)).toBe(false);
  });
  it('Rach cannot see Hareesh-only private Space', () => {
    expect(canSee('rach', { visibility: 'private', people: ['hareesh'] }, roster)).toBe(false);
  });
  it('Hareesh sees his own private Space', () => {
    expect(canSee('hareesh', { visibility: 'private', people: ['hareesh'] }, roster)).toBe(true);
  });
  it('family Space visible to everyone', () => {
    expect(canSee('robin', { visibility: 'family', people: [] }, roster)).toBe(true);
  });
});

// Build Spec 2 Phase R1 — category sets + type-aware validity.
describe('category sets', () => {
  it('FAMILY_CATEGORIES is the historic family set, unchanged', () => {
    expect(FAMILY_CATEGORIES).toEqual(['person', 'routine', 'household', 'commitment', 'document']);
  });

  it('RESEARCH_CATEGORIES contains the spec set, with `document` shared', () => {
    expect(RESEARCH_CATEGORIES).toContain('memo');
    expect(RESEARCH_CATEGORIES).toContain('theme');
    expect(RESEARCH_CATEGORIES).toContain('participant');
    expect(RESEARCH_CATEGORIES).toContain('source');
    expect(RESEARCH_CATEGORIES).toContain('question');
    expect(RESEARCH_CATEGORIES).toContain('quote');
    expect(RESEARCH_CATEGORIES).toContain('document');
  });

  it('SPACE_CATEGORIES is the union with no duplicates', () => {
    const set = new Set(SPACE_CATEGORIES);
    expect(set.size).toBe(SPACE_CATEGORIES.length);
    // `document` is in both sets; must appear exactly once in the union.
    expect(SPACE_CATEGORIES.filter(c => c === 'document').length).toBe(1);
  });

  it('SPACE_CATEGORIES contains every member of every set', () => {
    for (const c of FAMILY_CATEGORIES) expect(SPACE_CATEGORIES).toContain(c);
    for (const c of RESEARCH_CATEGORIES) expect(SPACE_CATEGORIES).toContain(c);
  });

  it('getCategorySetForType returns research set for research', () => {
    expect(getCategorySetForType('research')).toBe(RESEARCH_CATEGORIES);
  });

  it('getCategorySetForType falls back to family for every other type', () => {
    for (const t of ['family', 'personal', 'household', 'work', 'project', 'community', 'unknown-future-type']) {
      expect(getCategorySetForType(t)).toBe(FAMILY_CATEGORIES);
    }
  });

  it('isCategoryAllowedForType — family workspace rejects research-only categories', () => {
    expect(isCategoryAllowedForType('theme', 'family')).toBe(false);
    expect(isCategoryAllowedForType('memo', 'family')).toBe(false);
    expect(isCategoryAllowedForType('participant', 'family')).toBe(false);
  });

  it('isCategoryAllowedForType — research workspace rejects family-only categories', () => {
    expect(isCategoryAllowedForType('routine', 'research')).toBe(false);
    expect(isCategoryAllowedForType('person', 'research')).toBe(false);
    expect(isCategoryAllowedForType('commitment', 'research')).toBe(false);
    expect(isCategoryAllowedForType('household', 'research')).toBe(false);
  });

  it('isCategoryAllowedForType — `document` is valid in both worlds', () => {
    expect(isCategoryAllowedForType('document', 'family')).toBe(true);
    expect(isCategoryAllowedForType('document', 'research')).toBe(true);
  });

  it('isCategoryAllowedForType — unknown category rejected for every type', () => {
    expect(isCategoryAllowedForType('paragraph', 'family')).toBe(false);
    expect(isCategoryAllowedForType('paragraph', 'research')).toBe(false);
    expect(isCategoryAllowedForType('', 'research')).toBe(false);
  });
});

// Phase R1 — URI parsing must accept the new research categories so a
// memu:// URI to a `theme` Space round-trips cleanly.
describe('parseSpaceUri — research categories', () => {
  it('accepts a theme URI', () => {
    expect(parseSpaceUri('memu://ws-1/theme/u-1')).toEqual({
      familyId: 'ws-1', category: 'theme', uuid: 'u-1',
    });
  });
  it('accepts a memo URI', () => {
    expect(parseSpaceUri('memu://ws-1/memo/u-2')).not.toBeNull();
  });
  it('still rejects an invented category', () => {
    expect(parseSpaceUri('memu://ws-1/paragraph/u-3')).toBeNull();
  });
});
