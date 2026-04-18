/**
 * Story 2.1 — pure-logic tests for catalogue helpers (no DB).
 */

import { describe, it, expect } from 'vitest';
import { matchBySlug, resolveWikilinks, renderCatalogueForPrompt, filterByCategory, type CatalogueEntry } from './catalogue';

const swim: CatalogueEntry = {
  uri: 'memu://fam/routine/swim',
  slug: 'robin-swimming',
  name: "Robin's Swimming",
  category: 'routine',
  description: 'Thursday 4-5pm pool',
  domains: ['health', 'education'],
  confidence: 0.85,
  lastUpdated: new Date('2026-04-15'),
};
const dentist: CatalogueEntry = {
  uri: 'memu://fam/commitment/dentist',
  slug: 'dentist-followup',
  name: 'Dentist follow-up',
  category: 'commitment',
  description: 'Schedule the cap fitting',
  domains: ['health'],
  confidence: 0.6,
  lastUpdated: new Date('2026-04-10'),
};
const entries = [swim, dentist];

describe('matchBySlug', () => {
  it('matches when query mentions the slug words', () => {
    expect(matchBySlug(entries, "When is robin swimming?").map(e => e.slug)).toContain('robin-swimming');
  });
  it('matches by display name', () => {
    expect(matchBySlug(entries, "what about Dentist follow-up?").map(e => e.slug)).toContain('dentist-followup');
  });
  it('returns nothing for an unrelated query', () => {
    expect(matchBySlug(entries, "what's the weather like?")).toHaveLength(0);
  });
});

describe('resolveWikilinks', () => {
  it('finds a single wikilink by slug', () => {
    expect(resolveWikilinks(entries, 'see [[robin-swimming]] for details').map(e => e.slug)).toEqual(['robin-swimming']);
  });
  it('finds multiple wikilinks', () => {
    const got = resolveWikilinks(entries, '[[robin-swimming]] and [[dentist-followup]] are linked').map(e => e.slug);
    expect(got).toContain('robin-swimming');
    expect(got).toContain('dentist-followup');
  });
  it('returns empty when none match', () => {
    expect(resolveWikilinks(entries, '[[nonexistent]]')).toHaveLength(0);
  });
});

describe('renderCatalogueForPrompt', () => {
  it('renders one line per entry', () => {
    const rendered = renderCatalogueForPrompt(entries);
    expect(rendered.split('\n')).toHaveLength(2);
    expect(rendered).toContain('[routine]');
    expect(rendered).toContain('[commitment]');
  });
  it('handles empty catalogue', () => {
    expect(renderCatalogueForPrompt([])).toBe('(no compiled Spaces yet)');
  });
});

describe('filterByCategory', () => {
  it('filters to a single category', () => {
    expect(filterByCategory(entries, 'routine')).toHaveLength(1);
  });
});
