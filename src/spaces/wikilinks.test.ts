import { describe, it, expect } from 'vitest';
import { extractWikilinkTargets } from './wikilinks';

describe('extractWikilinkTargets', () => {
  it('extracts a single wikilink by slug', () => {
    expect(extractWikilinkTargets('see [[robin-swimming]] for details'))
      .toEqual(['robin-swimming']);
  });

  it('extracts multiple wikilinks and dedupes', () => {
    expect(extractWikilinkTargets('[[a]] and [[b]] and [[a]] again'))
      .toEqual(['a', 'b']);
  });

  it('lowercases targets so resolution is case-insensitive', () => {
    expect(extractWikilinkTargets('[[Robin]] [[ROBIN]] [[robin]]'))
      .toEqual(['robin']);
  });

  it('honours [[target|display]] pipe alias — keeps target, drops display', () => {
    expect(extractWikilinkTargets('See [[robin-swimming|Robin\'s swimming notes]]'))
      .toEqual(['robin-swimming']);
  });

  it('returns empty for empty body', () => {
    expect(extractWikilinkTargets('')).toEqual([]);
  });

  it('returns empty when no wikilinks present', () => {
    expect(extractWikilinkTargets('plain text with no brackets [single] (parens)')).toEqual([]);
  });

  it('skips empty/whitespace-only targets', () => {
    expect(extractWikilinkTargets('[[ ]] [[]] [[real-target]]')).toEqual(['real-target']);
  });

  it('refuses targets spanning newlines (probably a typo, not a link)', () => {
    expect(extractWikilinkTargets('[[robin\nswimming]] [[fine]]')).toEqual(['fine']);
  });

  it('trims whitespace inside the brackets', () => {
    expect(extractWikilinkTargets('[[  robin-swimming  ]]')).toEqual(['robin-swimming']);
  });
});
