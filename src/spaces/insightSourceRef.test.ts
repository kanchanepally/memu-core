import { describe, expect, it } from 'vitest';
import {
  formatInsightSourceRef,
  parseInsightSourceRef,
  refTargetsSpace,
} from './insightSourceRef';

describe('formatInsightSourceRef', () => {
  it('formats a body-text passage anchor', () => {
    expect(
      formatInsightSourceRef({
        spaceUri: 'memu://research/document/paper-abc',
        anchor: { kind: 'body', pid: 'p7a3' },
      }),
    ).toBe('source:memu://research/document/paper-abc#pid:p7a3');
  });

  it('formats a PDF page+rect anchor with rounded coords', () => {
    expect(
      formatInsightSourceRef({
        spaceUri: 'memu://research/document/paper-abc',
        anchor: {
          kind: 'pdf',
          pageNumber: 4,
          rect: { x: 120.123456, y: 80.5, w: 320.789, h: 18.111 },
        },
      }),
    ).toBe('source:memu://research/document/paper-abc#page=4&rect=120.12,80.5,320.79,18.11');
  });

  it('formats a free-form (no anchor) ref', () => {
    expect(
      formatInsightSourceRef({
        spaceUri: 'memu://research/document/paper-abc',
        anchor: { kind: 'none' },
      }),
    ).toBe('source:memu://research/document/paper-abc');
  });
});

describe('parseInsightSourceRef', () => {
  it('returns null for non-source schemes', () => {
    expect(parseInsightSourceRef('document:/foo')).toBeNull();
    expect(parseInsightSourceRef('message:abc123')).toBeNull();
    expect(parseInsightSourceRef('autolearn:2026-05-15')).toBeNull();
  });

  it('returns null for non-strings', () => {
    // @ts-expect-error — deliberate
    expect(parseInsightSourceRef(null)).toBeNull();
    // @ts-expect-error — deliberate
    expect(parseInsightSourceRef(undefined)).toBeNull();
    // @ts-expect-error — deliberate
    expect(parseInsightSourceRef(42)).toBeNull();
  });

  it('parses a body-text pid anchor', () => {
    const got = parseInsightSourceRef('source:memu://research/document/paper#pid:p7a3');
    expect(got).toEqual({
      spaceUri: 'memu://research/document/paper',
      anchor: { kind: 'body', pid: 'p7a3' },
    });
  });

  it('parses a PDF page+rect anchor', () => {
    const got = parseInsightSourceRef(
      'source:memu://research/document/paper#page=4&rect=120.12,80.5,320.79,18.11',
    );
    expect(got).toEqual({
      spaceUri: 'memu://research/document/paper',
      anchor: {
        kind: 'pdf',
        pageNumber: 4,
        rect: { x: 120.12, y: 80.5, w: 320.79, h: 18.11 },
      },
    });
  });

  it('parses a PDF page-only anchor (no rect — fallback for jump-only)', () => {
    const got = parseInsightSourceRef('source:memu://research/document/paper#page=2');
    expect(got).toEqual({
      spaceUri: 'memu://research/document/paper',
      anchor: { kind: 'pdf', pageNumber: 2, rect: { x: 0, y: 0, w: 0, h: 0 } },
    });
  });

  it('parses a free-form ref (no fragment)', () => {
    const got = parseInsightSourceRef('source:memu://research/document/paper');
    expect(got).toEqual({
      spaceUri: 'memu://research/document/paper',
      anchor: { kind: 'none' },
    });
  });

  it('returns null for an empty pid', () => {
    expect(parseInsightSourceRef('source:foo#pid:')).toBeNull();
  });

  it('returns null for an invalid page number', () => {
    expect(parseInsightSourceRef('source:foo#page=not-a-number')).toBeNull();
    expect(parseInsightSourceRef('source:foo#page=0')).toBeNull();
    expect(parseInsightSourceRef('source:foo#page=-3')).toBeNull();
  });

  it('returns null for a malformed rect (wrong arity)', () => {
    expect(
      parseInsightSourceRef('source:foo#page=1&rect=1,2,3'),
    ).toBeNull();
  });

  it('returns null for a malformed rect (non-numeric coord)', () => {
    expect(
      parseInsightSourceRef('source:foo#page=1&rect=1,2,three,4'),
    ).toBeNull();
  });

  it('treats unknown fragments as free-form', () => {
    const got = parseInsightSourceRef('source:memu://x#something=else');
    expect(got).toEqual({
      spaceUri: 'memu://x',
      anchor: { kind: 'none' },
    });
  });

  it('round-trips body and pdf anchors', () => {
    const cases: Array<Parameters<typeof formatInsightSourceRef>[0]> = [
      { spaceUri: 'memu://r/d/paper', anchor: { kind: 'body', pid: 'k2mn' } },
      {
        spaceUri: 'memu://r/d/paper',
        anchor: { kind: 'pdf', pageNumber: 7, rect: { x: 0, y: 0, w: 1, h: 1 } },
      },
      { spaceUri: 'memu://r/d/paper', anchor: { kind: 'none' } },
    ];
    for (const c of cases) {
      const formatted = formatInsightSourceRef(c);
      const parsed = parseInsightSourceRef(formatted);
      expect(parsed).toEqual(c);
    }
  });
});

describe('refTargetsSpace', () => {
  it('matches the target Space URI exactly', () => {
    expect(
      refTargetsSpace('source:memu://r/d/paper#pid:p7a3', 'memu://r/d/paper'),
    ).toBe(true);
    expect(
      refTargetsSpace('source:memu://r/d/paper#page=4&rect=1,2,3,4', 'memu://r/d/paper'),
    ).toBe(true);
    expect(
      refTargetsSpace('source:memu://r/d/paper', 'memu://r/d/paper'),
    ).toBe(true);
  });

  it('rejects a different Space URI', () => {
    expect(
      refTargetsSpace('source:memu://r/d/other#pid:p7a3', 'memu://r/d/paper'),
    ).toBe(false);
  });

  it('rejects non-source schemes', () => {
    expect(refTargetsSpace('document:/foo', 'foo')).toBe(false);
  });
});
