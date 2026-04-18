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
