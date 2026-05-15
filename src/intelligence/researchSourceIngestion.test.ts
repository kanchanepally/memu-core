/**
 * Build Spec 2 Phase R2 — researchSourceIngestion pure-helper tests.
 *
 * processResearchSourceIngestion itself is DB-touching (Twin registry,
 * file storage, upsertSpace, RLS-scoped queries) — covered by manual
 * QA on the Z2 per the same convention as documentIngestion's
 * orchestration. These tests pin the pure helpers + the parser
 * truncation contract.
 */

import { describe, it, expect } from 'vitest';
import { deriveTitleFromFilename } from './researchSourceIngestion';
import {
  parsePlainText,
  RESEARCH_MAX_TEXT_CHARS,
  FAMILY_MAX_TEXT_CHARS,
} from './documentIngestion';

describe('deriveTitleFromFilename', () => {
  it('strips file extension', () => {
    expect(deriveTitleFromFilename('paper.pdf')).toBe('Paper');
  });

  it('strips a YYYY-MM-DD prefix', () => {
    expect(deriveTitleFromFilename('2024-03-15-interview-transcript.pdf')).toBe('Interview transcript');
    expect(deriveTitleFromFilename('2024_03_15_paper.pdf')).toBe('Paper');
  });

  it('strips a hex / UUID-style prefix', () => {
    expect(deriveTitleFromFilename('a1b2c3d4-paper.pdf')).toBe('Paper');
    // Two adjacent hex prefixes — the regex strips one pass; the second
    // hex run flows through as part of the title. Realistic uploads
    // have one UUID prefix at most, so the one-pass strip is fine.
    expect(deriveTitleFromFilename('deadbeef-cafef00d-paper.pdf')).toBe('Cafef00d paper');
  });

  it('strips a bare numeric prefix', () => {
    expect(deriveTitleFromFilename('42-paper.pdf')).toBe('Paper');
    expect(deriveTitleFromFilename('1234567 talk.pdf')).toBe('Talk');
  });

  it('collapses dashes and underscores to spaces', () => {
    expect(deriveTitleFromFilename('why-i-am-not-a-hindu.pdf')).toBe('Why i am not a hindu');
    expect(deriveTitleFromFilename('chapter_one_draft.pdf')).toBe('Chapter one draft');
  });

  it('preserves mid-word casing (acronyms / surnames)', () => {
    expect(deriveTitleFromFilename('SDG-progress.pdf')).toBe('SDG progress');
    expect(deriveTitleFromFilename('OBrien-2019.pdf')).toBe('OBrien 2019');
  });

  it('falls back to noExt when stripping leaves nothing', () => {
    expect(deriveTitleFromFilename('2024-03-15.pdf')).toBe('2024-03-15');
  });

  it('returns the original filename when there is no extension', () => {
    expect(deriveTitleFromFilename('Readme')).toBe('Readme');
  });

  it('handles empty input safely', () => {
    expect(deriveTitleFromFilename('')).toBe('');
  });

  it('handles only-extension input', () => {
    expect(deriveTitleFromFilename('.pdf')).toBe('.pdf');
  });
});

describe('parser truncation — research vs family caps', () => {
  it('research cap is 10x the family cap', () => {
    expect(RESEARCH_MAX_TEXT_CHARS).toBe(FAMILY_MAX_TEXT_CHARS * 10);
  });

  it('parsePlainText with default options uses the family cap', () => {
    const huge = 'x'.repeat(FAMILY_MAX_TEXT_CHARS + 100);
    const buf = Buffer.from(huge, 'utf8');
    const result = parsePlainText(buf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(true);
      expect(result.charCount).toBe(huge.length);
      // The returned text includes the truncation notice, so the
      // visible body is family-cap + notice (longer than family-cap).
      expect(result.text.length).toBeGreaterThan(FAMILY_MAX_TEXT_CHARS);
      expect(result.text).toContain('[document truncated');
    }
  });

  it('parsePlainText with research cap keeps more text before truncating', () => {
    // 100k chars — over the family cap, under the research cap.
    const mid = 'y'.repeat(100_000);
    const buf = Buffer.from(mid, 'utf8');
    const familyResult = parsePlainText(buf);
    const researchResult = parsePlainText(buf, { maxChars: RESEARCH_MAX_TEXT_CHARS });
    expect(familyResult.ok && familyResult.truncated).toBe(true);
    expect(researchResult.ok).toBe(true);
    if (researchResult.ok) {
      expect(researchResult.truncated).toBe(false);
      // Full 100k preserved (plus the 0 char notice since untruncated).
      expect(researchResult.text.length).toBe(mid.length);
    }
  });

  it('parsePlainText with research cap truncates a book-scale file', () => {
    // 1M chars — over the research cap.
    const enormous = 'z'.repeat(1_000_000);
    const buf = Buffer.from(enormous, 'utf8');
    const result = parsePlainText(buf, { maxChars: RESEARCH_MAX_TEXT_CHARS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(true);
      expect(result.charCount).toBe(enormous.length);
      expect(result.text).toContain('[document truncated');
    }
  });

  it('research-cap notice names the actual cap number', () => {
    const enormous = 'a'.repeat(RESEARCH_MAX_TEXT_CHARS + 100);
    const buf = Buffer.from(enormous, 'utf8');
    const result = parsePlainText(buf, { maxChars: RESEARCH_MAX_TEXT_CHARS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The cap-aware notice surfaces the actual number so a researcher
      // looking at a truncated body knows where the cap was.
      expect(result.text).toContain(RESEARCH_MAX_TEXT_CHARS.toLocaleString('en-US'));
    }
  });
});
