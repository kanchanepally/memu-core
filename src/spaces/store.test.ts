import { describe, it, expect } from 'vitest';
import { validateParentRelationship } from './store';

/**
 * validateParentRelationship has two failure modes that don't touch the DB:
 *   - null parentUri (always ok)
 *   - invalid type / empty string
 *   - parent === self (caught BEFORE the DB query)
 *
 * The three DB-touching reasons (parent_not_found, parent_cross_family,
 * parent_has_parent) are covered by manual QA per the existing project
 * convention — same pattern as createSpace / updateSpace executors in
 * src/intelligence/tools.ts: schema + pure-input validation here, real
 * DB happy paths by hand.
 */
describe('validateParentRelationship — pure paths', () => {
  it('returns ok when parentUri is null (un-parenting is always legal)', async () => {
    const result = await validateParentRelationship('fam-1', null);
    expect(result).toEqual({ ok: true });
  });

  it('rejects empty-string parentUri with invalid_uri', async () => {
    const result = await validateParentRelationship('fam-1', '');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_uri');
  });

  it('rejects whitespace-only parentUri with invalid_uri', async () => {
    const result = await validateParentRelationship('fam-1', '   ');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_uri');
  });

  it('rejects non-string parentUri with invalid_uri', async () => {
    // @ts-expect-error — testing runtime defence
    const result = await validateParentRelationship('fam-1', 123);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_uri');
  });

  it('rejects parent === self before any DB lookup with parent_is_self', async () => {
    const uri = 'memu://fam-1/commitment/abc';
    const result = await validateParentRelationship('fam-1', uri, uri);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('parent_is_self');
    expect(result.message).toMatch(/own parent/i);
  });

  it('returns a structured discriminator on every failure', async () => {
    const cases = [
      await validateParentRelationship('fam-1', ''),
      await validateParentRelationship('fam-1', '   '),
      // @ts-expect-error — runtime defence
      await validateParentRelationship('fam-1', undefined),
    ];
    for (const r of cases) {
      expect(r.ok).toBe(false);
      expect(r.reason).toBeDefined();
      expect(r.message).toBeDefined();
    }
  });
});
