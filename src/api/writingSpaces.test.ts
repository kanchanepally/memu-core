/**
 * BS3 Phase W3 — unit tests for pure validators in api/writingSpaces.ts.
 *
 * Route handlers (DB-touching) are covered by manual QA, same pattern
 * as src/api/workbench.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  validateCreateInput,
  validateSaveInput,
  validateStatusInput,
  validateCiteInput,
  validateCitePickerInput,
  WRITING_TEMPLATES,
  isWritingTemplate,
} from './writingSpaces';

// ---------------------------------------------------------------------------
// validateCreateInput
// ---------------------------------------------------------------------------

describe('validateCreateInput', () => {
  it('accepts a minimal valid body and defaults template to essay', () => {
    const out = validateCreateInput({ title: 'My piece' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.input.title).toBe('My piece');
      expect(out.input.template).toBe('essay');
      expect(out.input.workingSetId).toBeNull();
    }
  });

  it('accepts a workingSetId when provided', () => {
    const out = validateCreateInput({ title: 'Hi', workingSetId: 'ws-1' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.workingSetId).toBe('ws-1');
  });

  it('treats explicit null workingSetId as no link', () => {
    const out = validateCreateInput({ title: 'Hi', workingSetId: null });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.workingSetId).toBeNull();
  });

  it('rejects empty / whitespace workingSetId string', () => {
    expect(validateCreateInput({ title: 'Hi', workingSetId: '' })).toEqual({
      ok: false,
      reason: 'working_set_id_invalid',
    });
    expect(validateCreateInput({ title: 'Hi', workingSetId: '   ' })).toEqual({
      ok: false,
      reason: 'working_set_id_invalid',
    });
  });

  it('rejects non-string workingSetId', () => {
    expect(validateCreateInput({ title: 'Hi', workingSetId: 42 })).toEqual({
      ok: false,
      reason: 'working_set_id_invalid',
    });
  });

  it('accepts every valid template', () => {
    for (const t of WRITING_TEMPLATES) {
      const out = validateCreateInput({ title: 'Hi', template: t });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.input.template).toBe(t);
    }
  });

  it('rejects unknown templates', () => {
    expect(validateCreateInput({ title: 'Hi', template: 'novel' })).toEqual({
      ok: false,
      reason: 'template_invalid',
    });
  });

  it('rejects non-object body', () => {
    expect(validateCreateInput(null)).toEqual({ ok: false, reason: 'body_required' });
    expect(validateCreateInput('hi')).toEqual({ ok: false, reason: 'body_required' });
    expect(validateCreateInput(42)).toEqual({ ok: false, reason: 'body_required' });
  });

  it('rejects missing or empty title', () => {
    expect(validateCreateInput({})).toEqual({ ok: false, reason: 'title_required' });
    expect(validateCreateInput({ title: '' })).toEqual({ ok: false, reason: 'title_required' });
    expect(validateCreateInput({ title: '   ' })).toEqual({ ok: false, reason: 'title_required' });
  });

  it('rejects over-long titles', () => {
    const out = validateCreateInput({ title: 'x'.repeat(201) });
    expect(out).toEqual({ ok: false, reason: 'title_too_long' });
  });

  it('trims whitespace around title', () => {
    const out = validateCreateInput({ title: '  trimmed  ' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.title).toBe('trimmed');
  });
});

// ---------------------------------------------------------------------------
// validateSaveInput
// ---------------------------------------------------------------------------

describe('validateSaveInput', () => {
  it('accepts a minimal valid body', () => {
    const out = validateSaveInput({ bodyMarkdown: '# Hello' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.input.bodyMarkdown).toBe('# Hello');
      expect(out.input.changesSummary).toBeNull();
    }
  });

  it('accepts an empty body (drafts can be cleared)', () => {
    const out = validateSaveInput({ bodyMarkdown: '' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.bodyMarkdown).toBe('');
  });

  it('accepts an optional changesSummary', () => {
    const out = validateSaveInput({ bodyMarkdown: 'x', changesSummary: 'End of pass 2' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.changesSummary).toBe('End of pass 2');
  });

  it('treats explicit null changesSummary as no summary', () => {
    const out = validateSaveInput({ bodyMarkdown: 'x', changesSummary: null });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.changesSummary).toBeNull();
  });

  it('rejects non-object body', () => {
    expect(validateSaveInput(null)).toEqual({ ok: false, reason: 'body_required' });
    expect(validateSaveInput('x')).toEqual({ ok: false, reason: 'body_required' });
  });

  it('rejects missing or non-string bodyMarkdown', () => {
    expect(validateSaveInput({})).toEqual({ ok: false, reason: 'body_markdown_required' });
    expect(validateSaveInput({ bodyMarkdown: 42 })).toEqual({ ok: false, reason: 'body_markdown_required' });
  });

  it('rejects bodyMarkdown larger than max', () => {
    const out = validateSaveInput({ bodyMarkdown: 'x'.repeat(2_000_001) });
    expect(out).toEqual({ ok: false, reason: 'body_too_long' });
  });

  it('rejects oversized changesSummary', () => {
    const out = validateSaveInput({ bodyMarkdown: 'x', changesSummary: 'x'.repeat(501) });
    expect(out).toEqual({ ok: false, reason: 'summary_too_long' });
  });

  it('rejects non-string changesSummary', () => {
    const out = validateSaveInput({ bodyMarkdown: 'x', changesSummary: 5 });
    expect(out).toEqual({ ok: false, reason: 'summary_too_long' });
  });
});

// ---------------------------------------------------------------------------
// validateStatusInput
// ---------------------------------------------------------------------------

describe('validateStatusInput', () => {
  it('accepts every valid status', () => {
    for (const s of ['drafting', 'revising', 'ready_to_publish', 'published', 'archived']) {
      const out = validateStatusInput({ status: s });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.input.status).toBe(s);
    }
  });

  it('rejects non-object body', () => {
    expect(validateStatusInput(null)).toEqual({ ok: false, reason: 'body_required' });
    expect(validateStatusInput('drafting')).toEqual({ ok: false, reason: 'body_required' });
  });

  it('rejects missing status', () => {
    expect(validateStatusInput({})).toEqual({ ok: false, reason: 'status_required' });
    expect(validateStatusInput({ status: '' })).toEqual({ ok: false, reason: 'status_required' });
  });

  it('rejects unknown status', () => {
    expect(validateStatusInput({ status: 'Drafting' })).toEqual({ ok: false, reason: 'status_invalid' });
    expect(validateStatusInput({ status: 'done' })).toEqual({ ok: false, reason: 'status_invalid' });
  });
});

// ---------------------------------------------------------------------------
// validateCiteInput
// ---------------------------------------------------------------------------

describe('validateCiteInput', () => {
  const base = {
    artefactSpaceUri: 'memu://fam-1/quote/q1',
    positionInDraft: 42,
    surroundingHash: 'abc123',
  };

  it('accepts a minimal valid body', () => {
    const out = validateCiteInput(base);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.input.artefactSpaceUri).toBe('memu://fam-1/quote/q1');
      expect(out.input.passageId).toBeNull();
      expect(out.input.positionInDraft).toBe(42);
      expect(out.input.surroundingHash).toBe('abc123');
      expect(out.input.citationFormat).toBeNull();
    }
  });

  it('accepts passageId when provided', () => {
    const out = validateCiteInput({ ...base, passageId: 'p7a3' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.passageId).toBe('p7a3');
  });

  it('treats empty/whitespace passageId as null', () => {
    const out = validateCiteInput({ ...base, passageId: '   ' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.passageId).toBeNull();
  });

  it('rejects non-string passageId', () => {
    expect(validateCiteInput({ ...base, passageId: 42 })).toEqual({
      ok: false,
      reason: 'passage_id_invalid',
    });
  });

  it('accepts each valid citationFormat', () => {
    for (const f of ['footnote', 'inline', 'parenthetical', 'author_date']) {
      const out = validateCiteInput({ ...base, citationFormat: f });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.input.citationFormat).toBe(f);
    }
  });

  it('treats empty / null citationFormat as no override', () => {
    const a = validateCiteInput({ ...base, citationFormat: '' });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.input.citationFormat).toBeNull();
    const b = validateCiteInput({ ...base, citationFormat: null });
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.input.citationFormat).toBeNull();
  });

  it('rejects unknown citationFormat', () => {
    expect(validateCiteInput({ ...base, citationFormat: 'mla' })).toEqual({
      ok: false,
      reason: 'citation_format_invalid',
    });
  });

  it('rejects missing artefactSpaceUri', () => {
    const { artefactSpaceUri: _omit, ...rest } = base;
    void _omit;
    expect(validateCiteInput(rest)).toEqual({ ok: false, reason: 'artefact_uri_required' });
    expect(validateCiteInput({ ...rest, artefactSpaceUri: '' })).toEqual({
      ok: false,
      reason: 'artefact_uri_required',
    });
    expect(validateCiteInput({ ...rest, artefactSpaceUri: '   ' })).toEqual({
      ok: false,
      reason: 'artefact_uri_required',
    });
  });

  it('rejects invalid positionInDraft', () => {
    expect(validateCiteInput({ ...base, positionInDraft: -1 })).toEqual({
      ok: false,
      reason: 'position_invalid',
    });
    expect(validateCiteInput({ ...base, positionInDraft: 'forty-two' })).toEqual({
      ok: false,
      reason: 'position_invalid',
    });
    expect(validateCiteInput({ ...base, positionInDraft: NaN })).toEqual({
      ok: false,
      reason: 'position_invalid',
    });
    expect(validateCiteInput({ ...base, positionInDraft: Infinity })).toEqual({
      ok: false,
      reason: 'position_invalid',
    });
  });

  it('floors fractional positions', () => {
    const out = validateCiteInput({ ...base, positionInDraft: 42.9 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.positionInDraft).toBe(42);
  });

  it('rejects missing surroundingHash', () => {
    const { surroundingHash: _omit, ...rest } = base;
    void _omit;
    expect(validateCiteInput(rest)).toEqual({ ok: false, reason: 'surrounding_hash_required' });
    expect(validateCiteInput({ ...rest, surroundingHash: '' })).toEqual({
      ok: false,
      reason: 'surrounding_hash_required',
    });
    expect(validateCiteInput({ ...rest, surroundingHash: '   ' })).toEqual({
      ok: false,
      reason: 'surrounding_hash_required',
    });
  });

  it('rejects non-object body', () => {
    expect(validateCiteInput(null)).toEqual({ ok: false, reason: 'body_required' });
    expect(validateCiteInput('hi')).toEqual({ ok: false, reason: 'body_required' });
  });
});

// ---------------------------------------------------------------------------
// validateCitePickerInput
// ---------------------------------------------------------------------------

describe('validateCitePickerInput', () => {
  it('accepts a minimal valid body', () => {
    const out = validateCitePickerInput({ cursorContext: 'graded inequality in citizenship' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.input.cursorContext).toBe('graded inequality in citizenship');
      expect(out.input.limit).toBe(10);
    }
  });

  it('accepts an empty cursorContext (picker falls back to recent)', () => {
    const out = validateCitePickerInput({ cursorContext: '' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.cursorContext).toBe('');
  });

  it('treats undefined cursorContext as empty', () => {
    const out = validateCitePickerInput({});
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.cursorContext).toBe('');
  });

  it('rejects non-string cursorContext', () => {
    expect(validateCitePickerInput({ cursorContext: 42 })).toEqual({
      ok: false,
      reason: 'cursor_context_required',
    });
  });

  it('rejects oversized cursorContext', () => {
    const out = validateCitePickerInput({ cursorContext: 'x'.repeat(4001) });
    expect(out).toEqual({ ok: false, reason: 'cursor_context_too_long' });
  });

  it('accepts a custom limit', () => {
    const out = validateCitePickerInput({ cursorContext: 'x', limit: 20 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.limit).toBe(20);
  });

  it('rejects out-of-range limits', () => {
    expect(validateCitePickerInput({ cursorContext: 'x', limit: 0 })).toEqual({
      ok: false,
      reason: 'limit_invalid',
    });
    expect(validateCitePickerInput({ cursorContext: 'x', limit: 51 })).toEqual({
      ok: false,
      reason: 'limit_invalid',
    });
    expect(validateCitePickerInput({ cursorContext: 'x', limit: 'lots' })).toEqual({
      ok: false,
      reason: 'limit_invalid',
    });
  });

  it('floors fractional limits', () => {
    const out = validateCitePickerInput({ cursorContext: 'x', limit: 12.7 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.input.limit).toBe(12);
  });

  it('rejects non-object body', () => {
    expect(validateCitePickerInput(null)).toEqual({ ok: false, reason: 'body_required' });
    expect(validateCitePickerInput('x')).toEqual({ ok: false, reason: 'body_required' });
  });
});

// ---------------------------------------------------------------------------
// WRITING_TEMPLATES sanity
// ---------------------------------------------------------------------------

describe('WRITING_TEMPLATES — additive template surface', () => {
  it('exposes a non-empty list including essay (the default)', () => {
    expect(WRITING_TEMPLATES.length).toBeGreaterThan(0);
    expect((WRITING_TEMPLATES as readonly string[]).includes('essay')).toBe(true);
  });
});

describe('isWritingTemplate', () => {
  it('matches every valid template', () => {
    for (const t of WRITING_TEMPLATES) expect(isWritingTemplate(t)).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isWritingTemplate('Essay')).toBe(false);
    expect(isWritingTemplate('')).toBe(false);
    expect(isWritingTemplate(null)).toBe(false);
    expect(isWritingTemplate(undefined)).toBe(false);
    expect(isWritingTemplate(7)).toBe(false);
  });
});
