import { describe, expect, it } from 'vitest';
import {
  parsePlainText,
  parseDocument,
  resolveMimeType,
} from './documentIngestion';

// ---------------------------------------------------------------------------
// resolveMimeType — pure dispatch from declared mime + filename extension
// ---------------------------------------------------------------------------

describe('resolveMimeType', () => {
  it('passes through a supported declared mime type', () => {
    expect(resolveMimeType('application/pdf', 'foo.pdf')).toBe('application/pdf');
    expect(resolveMimeType('text/plain', 'foo.txt')).toBe('text/plain');
  });

  it('falls back to extension for application/octet-stream', () => {
    expect(resolveMimeType('application/octet-stream', 'school-letter.pdf'))
      .toBe('application/pdf');
    expect(resolveMimeType('application/octet-stream', 'notes.txt')).toBe('text/plain');
    expect(resolveMimeType('application/octet-stream', 'README.md')).toBe('text/plain');
  });

  it('is case-insensitive on extension', () => {
    expect(resolveMimeType('application/octet-stream', 'BILL.PDF')).toBe('application/pdf');
    expect(resolveMimeType('application/octet-stream', 'Notes.TXT')).toBe('text/plain');
  });

  it('returns the unrecognised mime type unchanged when neither mime nor extension matches', () => {
    // parseDocument will then reject with the supported-types message —
    // we don't pretend to know what the file is.
    expect(resolveMimeType('application/zip', 'archive.zip')).toBe('application/zip');
    expect(resolveMimeType('image/jpeg', 'photo.jpg')).toBe('image/jpeg');
  });
});

// ---------------------------------------------------------------------------
// parsePlainText — pure, no native deps, deterministic
// ---------------------------------------------------------------------------

describe('parsePlainText', () => {
  it('decodes a utf-8 buffer', () => {
    const buf = Buffer.from('Hello world.\nSecond line.', 'utf8');
    const r = parsePlainText(buf);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe('Hello world.\nSecond line.');
      expect(r.charCount).toBe('Hello world.\nSecond line.'.length);
      expect(r.truncated).toBe(false);
      expect(r.detectedMimeType).toBe('text/plain');
    }
  });

  it('trims surrounding whitespace', () => {
    const buf = Buffer.from('   hello\n\n  ', 'utf8');
    const r = parsePlainText(buf);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('hello');
  });

  it('rejects empty buffer', () => {
    const r = parsePlainText(Buffer.from('', 'utf8'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  it('rejects whitespace-only content', () => {
    const r = parsePlainText(Buffer.from('   \n\n\t\n', 'utf8'));
    expect(r.ok).toBe(false);
  });

  it('truncates inputs over the cap and flags truncated:true', () => {
    const big = 'A'.repeat(60_000);
    const r = parsePlainText(Buffer.from(big, 'utf8'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charCount).toBe(60_000);
      expect(r.truncated).toBe(true);
      expect(r.text.length).toBeLessThan(60_000);
      expect(r.text).toMatch(/document truncated/i);
    }
  });

  it('does NOT mark truncated for inputs at the cap', () => {
    // 50,000 chars exactly → no truncation.
    const exact = 'B'.repeat(50_000);
    const r = parsePlainText(Buffer.from(exact, 'utf8'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.truncated).toBe(false);
  });

  it('handles unicode correctly (UK pound sign, em dash)', () => {
    const buf = Buffer.from('Bill: £128.45 — due 30 April 2026', 'utf8');
    const r = parsePlainText(buf);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain('£128.45');
      expect(r.text).toContain('—');
    }
  });
});

// ---------------------------------------------------------------------------
// parseDocument — top-level dispatcher
// ---------------------------------------------------------------------------

describe('parseDocument dispatcher', () => {
  it('routes text/plain to parsePlainText', async () => {
    const r = await parseDocument(Buffer.from('hello', 'utf8'), 'text/plain');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.detectedMimeType).toBe('text/plain');
  });

  it('rejects an unsupported mime type with a helpful message', async () => {
    const r = await parseDocument(Buffer.from('x', 'utf8'), 'application/zip');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/unsupported document type/i);
      expect(r.error).toMatch(/application\/zip/);
      expect(r.error).toMatch(/PDF|text\/plain/);
    }
  });

  it('rejects an image mime type and points to /api/vision', async () => {
    // Images go through the existing vision pipeline, not document
    // ingestion. The dispatcher's error message must steer the caller
    // there rather than silently failing.
    const r = await parseDocument(Buffer.from('x', 'utf8'), 'image/jpeg');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\/api\/vision/);
  });

  it('mentions .docx as on the roadmap (so callers know not to try it)', async () => {
    const r = await parseDocument(Buffer.from('x', 'utf8'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.docx|roadmap/i);
  });

  // PDF parsing happy path — pdf-parse needs a real PDF buffer, not
  // worth shipping a fixture for one assertion. Manual QA on the Z2
  // covers it. See documentIngestion.ts:parsePdf comment.
});
