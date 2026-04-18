/**
 * Story 2.2 — pure-logic tests for reflection. The full cadence runs
 * require Postgres + LLM, covered by manual QA per the story DoD.
 */

import { describe, it, expect } from 'vitest';
import { findingHash, parseFindings } from './reflection';

describe('findingHash', () => {
  it('is stable across runs for the same input', () => {
    const a = findingHash('contradiction', 'Two pickup times', ['memu://fam/p/robin']);
    const b = findingHash('contradiction', 'Two pickup times', ['memu://fam/p/robin']);
    expect(a).toBe(b);
  });

  it('is order-independent on space_refs', () => {
    const a = findingHash('contradiction', 't', ['memu://a', 'memu://b']);
    const b = findingHash('contradiction', 't', ['memu://b', 'memu://a']);
    expect(a).toBe(b);
  });

  it('changes when kind changes', () => {
    const a = findingHash('contradiction', 't', ['x']);
    const b = findingHash('stale_fact', 't', ['x']);
    expect(a).not.toBe(b);
  });

  it('changes when title changes', () => {
    const a = findingHash('contradiction', 'A', ['x']);
    const b = findingHash('contradiction', 'B', ['x']);
    expect(a).not.toBe(b);
  });
});

describe('parseFindings', () => {
  it('parses a clean array', () => {
    const text = JSON.stringify([
      { kind: 'contradiction', title: 'X', body: 'Y', space_refs: ['memu://a'], confidence: 0.8 },
    ]);
    const found = parseFindings(text);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('contradiction');
    expect(found[0].confidence).toBe(0.8);
  });

  it('parses despite ```json fences', () => {
    const text = '```json\n[]\n```';
    expect(parseFindings(text)).toEqual([]);
  });

  it('drops malformed entries (missing required fields)', () => {
    const text = JSON.stringify([
      { kind: 'contradiction', title: 'X', body: 'Y' },
      { kind: 'stale_fact' }, // missing title + body
      { title: 'Z', body: 'W' }, // missing kind
    ]);
    expect(parseFindings(text)).toHaveLength(1);
  });

  it('returns empty for non-array input', () => {
    expect(parseFindings('{"not": "an array"}')).toEqual([]);
  });

  it('returns empty for unparseable input', () => {
    expect(parseFindings('not json')).toEqual([]);
  });

  it('defaults missing confidence to 0.5', () => {
    const text = JSON.stringify([{ kind: 'pattern', title: 'X', body: 'Y' }]);
    expect(parseFindings(text)[0].confidence).toBe(0.5);
  });

  it('defaults missing space_refs to empty array', () => {
    const text = JSON.stringify([{ kind: 'pattern', title: 'X', body: 'Y' }]);
    expect(parseFindings(text)[0].space_refs).toEqual([]);
  });
});
