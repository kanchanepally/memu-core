/**
 * BS3 Phase W1 — unit tests for the pure validators in api/workbench.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  validateWorkbenchQuery,
  validateRelationshipType,
  VALID_RELATIONSHIP_TYPES,
  isRelationshipType,
} from './workbench';

describe('validateWorkbenchQuery', () => {
  it('accepts a minimal valid body', () => {
    const out = validateWorkbenchQuery({ query: 'where did I write about consent?' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.input.query).toBe('where did I write about consent?');
      expect(out.input.candidateLimit).toBe(30);
      expect(out.input.resultLimit).toBe(10);
    }
  });

  it('rejects non-object body', () => {
    expect(validateWorkbenchQuery(null)).toEqual({ ok: false, reason: 'body_required' });
    expect(validateWorkbenchQuery('hi')).toEqual({ ok: false, reason: 'body_required' });
  });

  it('rejects missing or empty query', () => {
    expect(validateWorkbenchQuery({})).toEqual({ ok: false, reason: 'query_required' });
    expect(validateWorkbenchQuery({ query: '' })).toEqual({ ok: false, reason: 'query_required' });
    expect(validateWorkbenchQuery({ query: '   ' })).toEqual({ ok: false, reason: 'query_required' });
  });

  it('trims whitespace around the query', () => {
    const out = validateWorkbenchQuery({ query: '  consent  ' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.query).toBe('consent');
  });

  it('rejects queries longer than the max', () => {
    const out = validateWorkbenchQuery({ query: 'a'.repeat(1001) });
    expect(out).toEqual({ ok: false, reason: 'query_too_long' });
  });

  it('accepts custom candidateLimit and resultLimit', () => {
    const out = validateWorkbenchQuery({ query: 'x', candidateLimit: 50, resultLimit: 5 });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.input.candidateLimit).toBe(50);
      expect(out.input.resultLimit).toBe(5);
    }
  });

  it('rejects out-of-range limits', () => {
    expect(validateWorkbenchQuery({ query: 'x', candidateLimit: 0 })).toEqual({
      ok: false,
      reason: 'limit_invalid',
    });
    expect(validateWorkbenchQuery({ query: 'x', candidateLimit: 1000 })).toEqual({
      ok: false,
      reason: 'limit_invalid',
    });
    expect(validateWorkbenchQuery({ query: 'x', resultLimit: 100 })).toEqual({
      ok: false,
      reason: 'limit_invalid',
    });
    expect(validateWorkbenchQuery({ query: 'x', resultLimit: 'three' })).toEqual({
      ok: false,
      reason: 'limit_invalid',
    });
  });

  it('floors fractional limits', () => {
    const out = validateWorkbenchQuery({ query: 'x', candidateLimit: 25.7 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.candidateLimit).toBe(25);
  });
});

describe('validateRelationshipType', () => {
  it('accepts undefined / null / empty string as untyped', () => {
    expect(validateRelationshipType(undefined)).toEqual({ ok: true, value: null });
    expect(validateRelationshipType(null)).toEqual({ ok: true, value: null });
    expect(validateRelationshipType('')).toEqual({ ok: true, value: null });
  });

  it('accepts each valid relationship type', () => {
    for (const t of VALID_RELATIONSHIP_TYPES) {
      const out = validateRelationshipType(t);
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.value).toBe(t);
    }
  });

  it('rejects unknown relationship types', () => {
    expect(validateRelationshipType('related-to')).toEqual({
      ok: false,
      reason: 'relationship_type_invalid',
    });
    expect(validateRelationshipType('Supports')).toEqual({
      ok: false,
      reason: 'relationship_type_invalid',
    });
    expect(validateRelationshipType(42)).toEqual({
      ok: false,
      reason: 'relationship_type_invalid',
    });
  });
});

describe('isRelationshipType', () => {
  it('matches every valid type', () => {
    for (const t of VALID_RELATIONSHIP_TYPES) {
      expect(isRelationshipType(t)).toBe(true);
    }
  });
  it('rejects everything else', () => {
    expect(isRelationshipType('foo')).toBe(false);
    expect(isRelationshipType('')).toBe(false);
    expect(isRelationshipType(undefined)).toBe(false);
    expect(isRelationshipType(null)).toBe(false);
    expect(isRelationshipType(7)).toBe(false);
  });
});

describe('VALID_RELATIONSHIP_TYPES — schema alignment', () => {
  it('matches the 7 BS3 §2.5 relationship types in alphabetical-ish narrative order', () => {
    // Locked in: changing this list requires a migration to update the
    // CHECK constraint in space_connections — keep the two in sync.
    expect([...VALID_RELATIONSHIP_TYPES]).toEqual([
      'supports',
      'contradicts',
      'extends',
      'exemplifies',
      'motivates',
      'answers',
      'references',
    ]);
  });
});
