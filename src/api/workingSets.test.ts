/**
 * BS3 Phase W2 — unit tests for the pure validators in api/workingSets.ts.
 *
 * DB-touching handlers are covered by manual QA per the project
 * convention (see workbench.test.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  validateCreateInput,
  validateUpdateInput,
  validateAddItemInput,
  validatePatchItemInput,
  validateReorderInput,
} from './workingSets';

describe('validateCreateInput', () => {
  it('accepts a minimal valid body', () => {
    const out = validateCreateInput({ name: 'Consent across studies' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.name).toBe('Consent across studies');
      expect(out.value.description).toBe('');
    }
  });

  it('trims name and description', () => {
    const out = validateCreateInput({ name: '  Consent  ', description: '  for §2.3  ' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.name).toBe('Consent');
      expect(out.value.description).toBe('for §2.3');
    }
  });

  it('rejects non-object bodies', () => {
    expect(validateCreateInput(null)).toEqual({ ok: false, reason: 'body_required' });
    expect(validateCreateInput('hi')).toEqual({ ok: false, reason: 'body_required' });
    expect(validateCreateInput(42)).toEqual({ ok: false, reason: 'body_required' });
  });

  it('rejects missing / empty name', () => {
    expect(validateCreateInput({})).toEqual({ ok: false, reason: 'name_required' });
    expect(validateCreateInput({ name: '' })).toEqual({ ok: false, reason: 'name_required' });
    expect(validateCreateInput({ name: '   ' })).toEqual({ ok: false, reason: 'name_required' });
    expect(validateCreateInput({ name: 42 })).toEqual({ ok: false, reason: 'name_required' });
  });

  it('rejects an over-long name', () => {
    expect(validateCreateInput({ name: 'a'.repeat(201) })).toEqual({ ok: false, reason: 'name_too_long' });
  });

  it('accepts a name at exactly the limit', () => {
    const out = validateCreateInput({ name: 'a'.repeat(200) });
    expect(out.ok).toBe(true);
  });

  it('rejects an over-long description', () => {
    expect(validateCreateInput({ name: 'x', description: 'a'.repeat(2001) })).toEqual({
      ok: false,
      reason: 'description_too_long',
    });
  });

  it('treats a non-string description as empty (forgiving)', () => {
    const out = validateCreateInput({ name: 'x', description: 42 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.description).toBe('');
  });
});

describe('validateUpdateInput', () => {
  it('accepts name-only update', () => {
    const out = validateUpdateInput({ name: 'Renamed' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.name).toBe('Renamed');
      expect(out.value.description).toBeUndefined();
      expect(out.value.clearFeedsInto).toBeUndefined();
    }
  });

  it('accepts description-only update', () => {
    const out = validateUpdateInput({ description: 'new context' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.description).toBe('new context');
      expect(out.value.name).toBeUndefined();
    }
  });

  it('accepts clearFeedsInto on its own', () => {
    const out = validateUpdateInput({ clearFeedsInto: true });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.clearFeedsInto).toBe(true);
  });

  it('accepts a multi-field update', () => {
    const out = validateUpdateInput({ name: 'X', description: 'Y', clearFeedsInto: true });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.name).toBe('X');
      expect(out.value.description).toBe('Y');
      expect(out.value.clearFeedsInto).toBe(true);
    }
  });

  it('rejects empty body as no_op', () => {
    expect(validateUpdateInput({})).toEqual({ ok: false, reason: 'no_op' });
  });

  it('treats clearFeedsInto=false as untouched (still no_op alone)', () => {
    expect(validateUpdateInput({ clearFeedsInto: false })).toEqual({ ok: false, reason: 'no_op' });
  });

  it('rejects non-object body', () => {
    expect(validateUpdateInput(null)).toEqual({ ok: false, reason: 'body_required' });
  });

  it('rejects name explicitly set to empty', () => {
    expect(validateUpdateInput({ name: '' })).toEqual({ ok: false, reason: 'name_required' });
    expect(validateUpdateInput({ name: '   ' })).toEqual({ ok: false, reason: 'name_required' });
  });

  it('rejects an over-long name', () => {
    expect(validateUpdateInput({ name: 'a'.repeat(201) })).toEqual({ ok: false, reason: 'name_too_long' });
  });

  it('rejects an over-long description', () => {
    expect(validateUpdateInput({ description: 'a'.repeat(2001) })).toEqual({
      ok: false,
      reason: 'description_too_long',
    });
  });
});

describe('validateAddItemInput', () => {
  it('accepts a minimal valid body', () => {
    const out = validateAddItemInput({ artefactSpaceUri: 'memu://collective/quote/abc' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.artefactSpaceUri).toBe('memu://collective/quote/abc');
      expect(out.value.note).toBe('');
    }
  });

  it('trims uri and note', () => {
    const out = validateAddItemInput({
      artefactSpaceUri: '  memu://collective/quote/abc  ',
      note: '  opens the section  ',
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.artefactSpaceUri).toBe('memu://collective/quote/abc');
      expect(out.value.note).toBe('opens the section');
    }
  });

  it('rejects non-object body', () => {
    expect(validateAddItemInput(null)).toEqual({ ok: false, reason: 'body_required' });
  });

  it('rejects missing / empty uri', () => {
    expect(validateAddItemInput({})).toEqual({ ok: false, reason: 'uri_required' });
    expect(validateAddItemInput({ artefactSpaceUri: '' })).toEqual({ ok: false, reason: 'uri_required' });
    expect(validateAddItemInput({ artefactSpaceUri: '   ' })).toEqual({ ok: false, reason: 'uri_required' });
  });

  it('rejects uri without memu:// prefix', () => {
    expect(validateAddItemInput({ artefactSpaceUri: 'https://example.com/x' })).toEqual({
      ok: false,
      reason: 'uri_invalid',
    });
  });

  it('rejects uri that is exactly 10 chars (must be strictly > 10)', () => {
    expect(validateAddItemInput({ artefactSpaceUri: 'memu://abc' })).toEqual({
      ok: false,
      reason: 'uri_invalid',
    });
  });

  it('accepts uri that is 11 chars (strictly > 10)', () => {
    const out = validateAddItemInput({ artefactSpaceUri: 'memu://abcd' });
    expect(out.ok).toBe(true);
  });

  it('rejects over-long note', () => {
    expect(
      validateAddItemInput({ artefactSpaceUri: 'memu://collective/quote/abc', note: 'a'.repeat(1001) }),
    ).toEqual({ ok: false, reason: 'note_too_long' });
  });
});

describe('validatePatchItemInput', () => {
  it('accepts note-only', () => {
    const out = validatePatchItemInput({ note: 'fresh note' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.note).toBe('fresh note');
      expect(out.value.orderIndex).toBeUndefined();
    }
  });

  it('accepts orderIndex-only', () => {
    const out = validatePatchItemInput({ orderIndex: 5 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.orderIndex).toBe(5);
  });

  it('floors fractional orderIndex', () => {
    const out = validatePatchItemInput({ orderIndex: 5.9 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.orderIndex).toBe(5);
  });

  it('accepts orderIndex=0', () => {
    const out = validatePatchItemInput({ orderIndex: 0 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.orderIndex).toBe(0);
  });

  it('rejects empty body as no_op', () => {
    expect(validatePatchItemInput({})).toEqual({ ok: false, reason: 'no_op' });
  });

  it('rejects negative orderIndex', () => {
    expect(validatePatchItemInput({ orderIndex: -1 })).toEqual({
      ok: false,
      reason: 'order_index_invalid',
    });
  });

  it('rejects non-finite orderIndex', () => {
    expect(validatePatchItemInput({ orderIndex: 'nope' })).toEqual({
      ok: false,
      reason: 'order_index_invalid',
    });
    expect(validatePatchItemInput({ orderIndex: Infinity })).toEqual({
      ok: false,
      reason: 'order_index_invalid',
    });
    expect(validatePatchItemInput({ orderIndex: NaN })).toEqual({
      ok: false,
      reason: 'order_index_invalid',
    });
  });

  it('rejects an over-long note', () => {
    expect(validatePatchItemInput({ note: 'a'.repeat(1001) })).toEqual({
      ok: false,
      reason: 'note_too_long',
    });
  });
});

describe('validateReorderInput', () => {
  it('accepts a non-empty array', () => {
    const out = validateReorderInput({ itemIds: ['a', 'b', 'c'] });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.itemIds).toEqual(['a', 'b', 'c']);
  });

  it('trims ids', () => {
    const out = validateReorderInput({ itemIds: ['  a  ', 'b'] });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.itemIds).toEqual(['a', 'b']);
  });

  it('rejects non-object body', () => {
    expect(validateReorderInput(null)).toEqual({ ok: false, reason: 'body_required' });
  });

  it('rejects missing itemIds', () => {
    expect(validateReorderInput({})).toEqual({ ok: false, reason: 'item_ids_required' });
  });

  it('rejects empty itemIds array', () => {
    expect(validateReorderInput({ itemIds: [] })).toEqual({ ok: false, reason: 'item_ids_required' });
  });

  it('rejects non-array itemIds', () => {
    expect(validateReorderInput({ itemIds: 'a,b,c' })).toEqual({
      ok: false,
      reason: 'item_ids_required',
    });
  });

  it('rejects non-string entries', () => {
    expect(validateReorderInput({ itemIds: ['a', 7] })).toEqual({
      ok: false,
      reason: 'item_ids_invalid',
    });
  });

  it('rejects empty / whitespace-only entries', () => {
    expect(validateReorderInput({ itemIds: ['a', ''] })).toEqual({
      ok: false,
      reason: 'item_ids_invalid',
    });
    expect(validateReorderInput({ itemIds: ['a', '   '] })).toEqual({
      ok: false,
      reason: 'item_ids_invalid',
    });
  });

  it('rejects duplicates', () => {
    expect(validateReorderInput({ itemIds: ['a', 'b', 'a'] })).toEqual({
      ok: false,
      reason: 'duplicate_item_ids',
    });
  });

  it('rejects duplicates that only match after trim', () => {
    expect(validateReorderInput({ itemIds: ['a', ' a '] })).toEqual({
      ok: false,
      reason: 'duplicate_item_ids',
    });
  });
});
