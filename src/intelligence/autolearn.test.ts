import { describe, expect, it } from 'vitest';
import { parseAutolearnOutput, appendAutolearnLine } from './autolearn';

// ---------------------------------------------------------------------------
// appendAutolearnLine — pure
// ---------------------------------------------------------------------------

describe('appendAutolearnLine', () => {
  it('returns the new line verbatim when existing body is empty', () => {
    expect(appendAutolearnLine('', '- 2026-04-26: New observation'))
      .toBe('- 2026-04-26: New observation');
  });

  it('returns the new line when existing is whitespace only', () => {
    expect(appendAutolearnLine('   \n\n  \t\n', '- 2026-04-26: x'))
      .toBe('- 2026-04-26: x');
  });

  it('appends with single newline separator (no horizontal-rule, no timestamp block)', () => {
    // Distinguishes from mergeSpaceBody which inserts `\n\n---\n_Updated…_\n\n`
    // — autolearn writes are short single-line additions firing many
    // times per day; the heavier separator would balloon Spaces fast.
    const out = appendAutolearnLine('First line.', '- New observation');
    expect(out).toBe('First line.\n- New observation');
    expect(out).not.toContain('---');
    expect(out).not.toMatch(/_Updated.*UTC_/);
  });

  it('trims trailing whitespace from existing before joining', () => {
    const out = appendAutolearnLine('Line.\n\n\n', '- New');
    // Should not have multiple consecutive blank lines between the two.
    expect(out).toBe('Line.\n- New');
  });

  it('preserves multi-line existing body content', () => {
    const existing = '## About\n\nA paragraph.\n\n## History\n\nLine one.\nLine two.';
    const out = appendAutolearnLine(existing, '- 2026-04-26: extra');
    expect(out).toContain('## About');
    expect(out).toContain('A paragraph.');
    expect(out).toContain('Line one.');
    expect(out).toContain('Line two.');
    expect(out).toContain('- 2026-04-26: extra');
    // New line lands at the very end.
    expect(out.endsWith('- 2026-04-26: extra')).toBe(true);
  });

  it('successive calls accumulate without duplicating separator markers', () => {
    let body = '';
    body = appendAutolearnLine(body, '- 2026-04-26: first');
    body = appendAutolearnLine(body, '- 2026-04-26: second');
    body = appendAutolearnLine(body, '- 2026-04-26: third');
    expect(body).toBe('- 2026-04-26: first\n- 2026-04-26: second\n- 2026-04-26: third');
    // Three appends, zero `---` separators (different shape from mergeSpaceBody).
    expect(body.match(/---/g)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseAutolearnOutput — handles v2, legacy v1, malformed
// ---------------------------------------------------------------------------

describe('parseAutolearnOutput — v2 structured shape', () => {
  it('parses a valid observations array with all fields', () => {
    const reply = JSON.stringify({
      observations: [
        {
          text: "Doesn't like mushrooms",
          subject: 'Child-1',
          category: 'person',
          confidence: 0.9,
        },
        {
          text: 'Wants to start composting',
          subject: null,
          category: 'commitment',
          confidence: 0.7,
        },
      ],
    });
    const obs = parseAutolearnOutput(reply);
    expect(obs).toHaveLength(2);
    expect(obs[0]).toEqual({
      text: "Doesn't like mushrooms",
      subject: 'Child-1',
      category: 'person',
      confidence: 0.9,
    });
    expect(obs[1].subject).toBeNull();
  });

  it('returns empty array for {observations: []}', () => {
    expect(parseAutolearnOutput('{"observations": []}')).toEqual([]);
  });

  it('tolerates JSON wrapped in prose (extracts the {...} block)', () => {
    const reply = 'Here is what I extracted:\n\n{"observations": [{"text": "Likes coffee in the morning", "subject": "Adult-1", "category": "person", "confidence": 0.85}]}\n\nLet me know if you need more.';
    const obs = parseAutolearnOutput(reply);
    expect(obs).toHaveLength(1);
    expect(obs[0].text).toBe('Likes coffee in the morning');
  });

  it('skips entries with missing or invalid text', () => {
    const reply = JSON.stringify({
      observations: [
        { text: 'Valid one', subject: null, category: 'other', confidence: 0.7 },
        { text: '', subject: null, category: 'other', confidence: 0.7 }, // empty text
        { text: 'x', subject: null, category: 'other', confidence: 0.7 }, // < 5 chars
        { subject: null, category: 'other', confidence: 0.7 }, // missing text
        { text: 42, subject: null, category: 'other', confidence: 0.7 }, // not a string
      ],
    });
    const obs = parseAutolearnOutput(reply);
    expect(obs).toHaveLength(1);
    expect(obs[0].text).toBe('Valid one');
  });

  it('skips entries with missing or non-numeric confidence', () => {
    const reply = JSON.stringify({
      observations: [
        { text: 'Valid', subject: null, category: 'other', confidence: 0.7 },
        { text: 'No confidence', subject: null, category: 'other' },
        { text: 'String confidence', subject: null, category: 'other', confidence: 'high' },
      ],
    });
    expect(parseAutolearnOutput(reply)).toHaveLength(1);
  });

  it('clamps confidence to [0, 1]', () => {
    const reply = JSON.stringify({
      observations: [
        { text: 'Below zero', subject: null, category: 'other', confidence: -0.5 },
        { text: 'Above one', subject: null, category: 'other', confidence: 1.5 },
      ],
    });
    const obs = parseAutolearnOutput(reply);
    expect(obs[0].confidence).toBe(0);
    expect(obs[1].confidence).toBe(1);
  });

  it('treats empty string subject as null', () => {
    const reply = JSON.stringify({
      observations: [{ text: 'Some fact', subject: '', category: 'other', confidence: 0.7 }],
    });
    expect(parseAutolearnOutput(reply)[0].subject).toBeNull();
  });

  it('trims subject whitespace', () => {
    const reply = JSON.stringify({
      observations: [{ text: 'Some fact', subject: '  Child-1  ', category: 'person', confidence: 0.7 }],
    });
    expect(parseAutolearnOutput(reply)[0].subject).toBe('Child-1');
  });

  it('defaults missing category to "other"', () => {
    const reply = JSON.stringify({
      observations: [{ text: 'Some fact', subject: null, confidence: 0.7 }],
    });
    expect(parseAutolearnOutput(reply)[0].category).toBe('other');
  });
});

describe('parseAutolearnOutput — v1 legacy shape (backward-compat)', () => {
  // The pre-2026-04-26 skill returned a flat array of strings. During
  // the deploy transition, in-flight requests might still use the old
  // shape. Tolerate it without crashing.
  it('parses a flat array of strings into observations', () => {
    const reply = '["Likes coffee in the morning", "Has a meeting Thursday"]';
    const obs = parseAutolearnOutput(reply);
    expect(obs).toHaveLength(2);
    expect(obs[0].text).toBe('Likes coffee in the morning');
    expect(obs[0].subject).toBeNull();
    expect(obs[0].category).toBe('other');
    expect(obs[0].confidence).toBe(0.7); // legacy default — recallable, not Space-write
  });

  it('skips strings under the minimum length', () => {
    const reply = '["valid string here", "x", "ok"]';
    const obs = parseAutolearnOutput(reply);
    expect(obs).toHaveLength(1);
    expect(obs[0].text).toBe('valid string here');
  });

  it('returns empty for an empty array', () => {
    expect(parseAutolearnOutput('[]')).toEqual([]);
  });
});

describe('parseAutolearnOutput — malformed / no JSON', () => {
  it('returns empty for prose with no JSON', () => {
    expect(parseAutolearnOutput('I did not find any durable facts.')).toEqual([]);
  });

  it('returns empty for malformed JSON', () => {
    expect(parseAutolearnOutput('{observations: [text: oops')).toEqual([]);
  });

  it('returns empty for JSON object missing the observations key', () => {
    expect(parseAutolearnOutput('{"facts": [{"text": "x", "confidence": 0.8}]}'))
      .toEqual([]);
  });

  it('returns empty for an empty string', () => {
    expect(parseAutolearnOutput('')).toEqual([]);
  });
});
