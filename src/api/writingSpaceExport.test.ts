/**
 * BS3 Phase W6 — tests for the pure helpers + validators in
 * writingSpaceExport.ts. DB-touching loaders + route handlers are
 * covered by manual QA per project convention.
 */

import { describe, it, expect } from 'vitest';
import {
  extractYearHint,
  extractUrlHint,
  extractAuthorHint,
  toCitedArtefact,
  encodeContentForResponse,
  validateExportQuery,
} from './writingSpaceExport';

describe('extractYearHint', () => {
  it('extracts a 4-digit 20xx year', () => {
    expect(extractYearHint('Berners-Lee (2023). Solid spec.')).toBe('2023');
  });
  it('extracts a 19xx year', () => {
    expect(extractYearHint('Lessig 1999 essay')).toBe('1999');
  });
  it('returns undefined when no year present', () => {
    expect(extractYearHint('A title with no date')).toBeUndefined();
  });
  it('handles null/undefined input', () => {
    expect(extractYearHint(null)).toBeUndefined();
    expect(extractYearHint(undefined)).toBeUndefined();
    expect(extractYearHint('')).toBeUndefined();
  });
  it('takes the first match when multiple years present', () => {
    expect(extractYearHint('2023 revision of 2019 paper')).toBe('2023');
  });
});

describe('extractUrlHint', () => {
  it('finds the first http URL', () => {
    expect(extractUrlHint('see http://example.com/path for details')).toBe('http://example.com/path');
  });
  it('finds https URLs', () => {
    expect(extractUrlHint('source: https://memu.digital/abc')).toBe('https://memu.digital/abc');
  });
  it('returns undefined when no URL present', () => {
    expect(extractUrlHint('just text')).toBeUndefined();
  });
  it('stops at whitespace / common terminators', () => {
    const result = extractUrlHint('"https://example.com/a" — see also');
    expect(result).toBe('https://example.com/a');
  });
});

describe('extractAuthorHint', () => {
  it('finds "by X" pattern', () => {
    expect(extractAuthorHint('Article by Tim Berners-Lee', [])).toBe('Tim Berners-Lee');
  });
  it('finds "X (year)" pattern at start', () => {
    expect(extractAuthorHint('Berners-Lee (2023)', [])).toBe('Berners-Lee');
  });
  it('returns undefined when no recognisable pattern', () => {
    expect(extractAuthorHint('A plain title', [])).toBeUndefined();
  });
  it('handles null/undefined description', () => {
    expect(extractAuthorHint(null, [])).toBeUndefined();
    expect(extractAuthorHint(undefined, [])).toBeUndefined();
  });
  it('pulls from source_references when description is silent', () => {
    expect(extractAuthorHint('', ['document:/path/berners_lee_solid_spec.pdf']))
      .toContain('berners');
  });
});

describe('toCitedArtefact', () => {
  it('returns null for null input (tombstone case)', () => {
    expect(toCitedArtefact(null)).toBeNull();
  });
  it('extracts all fields from a populated row', () => {
    const result = toCitedArtefact({
      uri: 'memu://x/source/abc',
      title: 'Solid Spec',
      category: 'source',
      description: 'A 2023 paper by Tim Berners-Lee',
      bodyMarkdown: 'body',
      sourceReferences: ['https://memu.digital/ref'],
    });
    expect(result).not.toBeNull();
    expect(result!.uri).toBe('memu://x/source/abc');
    expect(result!.title).toBe('Solid Spec');
    expect(result!.yearHint).toBe('2023');
    expect(result!.authorHint).toBe('Tim Berners-Lee');
    expect(result!.urlHint).toBe('https://memu.digital/ref');
  });
  it('defaults missing fields gracefully', () => {
    const result = toCitedArtefact({ uri: 'memu://x/source/abc' });
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Untitled');
    expect(result!.category).toBe('document');
    expect(result!.description).toBe('');
    expect(result!.yearHint).toBeUndefined();
  });
});

describe('encodeContentForResponse', () => {
  it('encodes text/* mimeTypes as utf8', () => {
    const result = encodeContentForResponse({
      content: 'hello world',
      mimeType: 'text/markdown',
      filename: 'x.md',
      driftedCitationIds: [],
    });
    expect(result.encoding).toBe('utf8');
    expect(result.content).toBe('hello world');
  });
  it('encodes application/json as utf8', () => {
    const result = encodeContentForResponse({
      content: '{"a":1}',
      mimeType: 'application/json',
      filename: 'x.json',
      driftedCitationIds: [],
    });
    expect(result.encoding).toBe('utf8');
    expect(result.content).toBe('{"a":1}');
  });
  it('encodes application/x-tex as utf8', () => {
    const result = encodeContentForResponse({
      content: '\\documentclass{article}',
      mimeType: 'application/x-tex',
      filename: 'x.tex',
      driftedCitationIds: [],
    });
    expect(result.encoding).toBe('utf8');
  });
  it('encodes binary mimeTypes as base64', () => {
    const buf = Buffer.from('binary content');
    const result = encodeContentForResponse({
      content: buf,
      mimeType: 'application/vnd.ms-word',
      filename: 'x.doc',
      driftedCitationIds: [],
    });
    expect(result.encoding).toBe('base64');
    expect(Buffer.from(result.content, 'base64').toString('utf8')).toBe('binary content');
  });
  it('converts string content to buffer for binary mime', () => {
    const result = encodeContentForResponse({
      content: 'binary as string',
      mimeType: 'application/vnd.ms-word',
      filename: 'x.doc',
      driftedCitationIds: [],
    });
    expect(result.encoding).toBe('base64');
  });
});

describe('validateExportQuery', () => {
  it('accepts a valid target', () => {
    expect(validateExportQuery({ target: 'substack' })).toEqual({
      ok: true,
      value: { target: 'substack' },
    });
  });
  it('rejects missing target', () => {
    expect(validateExportQuery({})).toEqual({ ok: false, reason: 'target_required' });
    expect(validateExportQuery({ target: '   ' })).toEqual({ ok: false, reason: 'target_required' });
  });
  it('rejects unknown target', () => {
    expect(validateExportQuery({ target: 'banana' })).toEqual({
      ok: false,
      reason: 'target_invalid',
    });
  });
  it('lowercases target before validating', () => {
    expect(validateExportQuery({ target: 'SUBSTACK' })).toEqual({
      ok: true,
      value: { target: 'substack' },
    });
  });
  it('accepts every shipped target', () => {
    for (const t of ['markdown', 'substack', 'docx', 'latex', 'pandoc', 'bibtex', 'print']) {
      const out = validateExportQuery({ target: t });
      expect(out.ok).toBe(true);
    }
  });
  it('handles undefined query', () => {
    expect(validateExportQuery(undefined)).toEqual({ ok: false, reason: 'target_required' });
  });
});
