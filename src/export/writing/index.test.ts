/**
 * BS3 Phase W6 — unit tests for the writing-space export pipeline.
 *
 * Renderers are pure — all tests mock the RenderContext directly and
 * inspect the returned ExportResult. No DB touched.
 */

import { describe, it, expect } from 'vitest';
import {
  renderExport,
  EXPORT_TARGETS,
  computeSurroundingHash,
  type RenderContext,
  type CitationWithArtefact,
  type CitedArtefact,
} from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeArtefact(overrides: Partial<CitedArtefact> = {}): CitedArtefact {
  return {
    uri: 'memu://fam1/quote/abc-123',
    title: 'Solid: A Platform for Decentralized Social Apps',
    category: 'quote',
    description: 'Berners-Lee on data sovereignty, 2023',
    bodyMarkdown: 'snippet body',
    authorHint: 'Berners-Lee',
    yearHint: '2023',
    urlHint: 'https://example.org/solid',
    ...overrides,
  };
}

function makeCitation(
  body: string,
  position: number,
  overrides: Partial<CitationWithArtefact> = {},
): CitationWithArtefact {
  return {
    id: overrides.id ?? 'cit-1',
    artefactSpaceUri: 'memu://fam1/quote/abc-123',
    passageId: null,
    positionInDraft: position,
    surroundingHash: computeSurroundingHash(body, position),
    citationFormat: null,
    artefact: makeArtefact(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    writingSpaceId: 'ws-1',
    title: 'On Owning Your Own Data',
    template: 'essay',
    bodyMarkdown: '',
    citations: [],
    authorHint: 'Hareesh K.',
    workspaceName: 'Memu Research',
    updatedAt: '2026-05-17T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty draft: every target renders title only, no body
// ---------------------------------------------------------------------------

describe('empty-draft rendering', () => {
  for (const target of EXPORT_TARGETS) {
    it(`${target} renders title with empty body`, () => {
      const result = renderExport(target, makeContext({ bodyMarkdown: '' }));
      expect(result.driftedCitationIds).toEqual([]);
      expect(result.filename).toContain('on-owning');
      if (target === 'bibtex') {
        // bibtex with no citations -> comment line, no body
        expect(result.content).toMatch(/No citations/);
      } else {
        const s = result.content.toString();
        expect(s.length).toBeGreaterThan(0);
        // Title appears somewhere (escaped or not).
        expect(s.toLowerCase()).toContain('on owning your own data');
      }
    });
  }
});

// ---------------------------------------------------------------------------
// One-citation rendering — per-target shape
// ---------------------------------------------------------------------------

describe('single-citation rendering', () => {
  const body = 'As Berners-Lee noted <!-- cite:cit-1 -->[^c1], data sovereignty matters.';
  const citation = makeCitation(body, body.indexOf('<!-- cite:cit-1 -->'), { id: 'cit-1' });

  it('markdown emits a footnote reference and definition', () => {
    const r = renderExport('markdown', makeContext({ bodyMarkdown: body, citations: [citation] }));
    expect(r.mimeType).toContain('text/markdown');
    expect(r.content.toString()).toMatch(/\[\^c1\]/);
    expect(r.content.toString()).toMatch(/\[\^c1\]: Berners-Lee, "Solid:/);
  });

  it('substack emits an inline link, no bibliography', () => {
    const r = renderExport('substack', makeContext({ bodyMarkdown: body, citations: [citation] }));
    const s = r.content.toString();
    expect(s).toMatch(/\(\[Berners-Lee 2023\]\(https:\/\/example\.org\/solid\)\)/);
    expect(s.toLowerCase()).not.toContain('bibliography');
  });

  it('docx emits author-date inline and a Bibliography section', () => {
    const r = renderExport('docx', makeContext({ bodyMarkdown: body, citations: [citation] }));
    const s = r.content.toString();
    expect(r.mimeType).toBe('application/vnd.ms-word');
    expect(r.filename.endsWith('.doc')).toBe(true);
    expect(s).toMatch(/\(Berners-Lee 2023\)/);
    expect(s).toMatch(/<h2>Bibliography<\/h2>/);
  });

  it('latex emits \\cite{} and a thebibliography block', () => {
    const r = renderExport('latex', makeContext({ bodyMarkdown: body, citations: [citation] }));
    const s = r.content.toString();
    expect(s).toMatch(/\\cite\{berners-lee-2023-[a-f0-9]{6}\}/);
    expect(s).toMatch(/\\begin\{thebibliography\}/);
    expect(s).toMatch(/\\bibitem\{berners-lee-2023-/);
  });

  it('pandoc emits [@key] and a YAML frontmatter with bibliography', () => {
    const r = renderExport('pandoc', makeContext({ bodyMarkdown: body, citations: [citation] }));
    const s = r.content.toString();
    expect(s).toMatch(/\[@berners-lee-2023-[a-f0-9]{6}\]/);
    expect(s).toMatch(/^---\n/);
    expect(s).toMatch(/bibliography: refs\.bib/);
    // No inline biblio section (pandoc generates it later).
    expect(s).not.toMatch(/thebibliography/);
  });

  it('bibtex emits ONE @misc entry, no draft body', () => {
    const r = renderExport('bibtex', makeContext({ bodyMarkdown: body, citations: [citation] }));
    const s = r.content.toString();
    expect(s).toMatch(/^@misc\{berners-lee-2023-/);
    expect(s).toMatch(/title = \{Solid: A Platform/);
    // No prose from the body.
    expect(s).not.toMatch(/data sovereignty matters/);
  });

  it('print emits superscript anchors and a Notes section', () => {
    const r = renderExport('print', makeContext({ bodyMarkdown: body, citations: [citation] }));
    const s = r.content.toString();
    expect(r.mimeType).toContain('text/html');
    expect(s).toMatch(/<sup id="fnref-1"><a href="#fn-1">1<\/a><\/sup>/);
    expect(s).toMatch(/<li id="fn-1">/);
  });
});

// ---------------------------------------------------------------------------
// Deleted-artefact tombstone
// ---------------------------------------------------------------------------

describe('deleted-artefact handling', () => {
  const body = 'Some claim <!-- cite:cit-1 -->[^c1].';
  const deletedCitation = makeCitation(body, body.indexOf('<!-- cite:cit-1 -->'), {
    id: 'cit-1',
    artefact: null,
  });

  it('markdown footnote definition uses the tombstone label', () => {
    const r = renderExport('markdown', makeContext({ bodyMarkdown: body, citations: [deletedCitation] }));
    expect(r.content.toString()).toContain('[deleted artefact]');
  });

  it('substack inline link falls back to tombstone parenthetical', () => {
    const r = renderExport('substack', makeContext({ bodyMarkdown: body, citations: [deletedCitation] }));
    expect(r.content.toString()).toContain('[deleted artefact]');
  });

  it('docx omits bibliography for deleted-only citations', () => {
    const r = renderExport('docx', makeContext({ bodyMarkdown: body, citations: [deletedCitation] }));
    const s = r.content.toString();
    expect(s).not.toMatch(/<h2>Bibliography<\/h2>/);
    expect(s).toContain('[deleted artefact]');
  });

  it('latex emits a deleted-artefact \\cite key, no bibliography', () => {
    const r = renderExport('latex', makeContext({ bodyMarkdown: body, citations: [deletedCitation] }));
    const s = r.content.toString();
    expect(s).toMatch(/\\cite\{deleted-artefact\}/);
    expect(s).not.toMatch(/\\bibitem/);
  });

  it('bibtex skips the deleted artefact silently', () => {
    const r = renderExport('bibtex', makeContext({ bodyMarkdown: body, citations: [deletedCitation] }));
    expect(r.content.toString()).toMatch(/No citations/);
  });

  it('print renders tombstone footnote', () => {
    const r = renderExport('print', makeContext({ bodyMarkdown: body, citations: [deletedCitation] }));
    expect(r.content.toString()).toContain('[deleted artefact]');
  });
});

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

describe('surrounding_hash drift detection', () => {
  it('flags a citation whose surrounding context changed', () => {
    const originalBody = 'Original sentence about X <!-- cite:cit-1 --> trailing context.';
    const position = originalBody.indexOf('<!-- cite:cit-1 -->');
    const citation = makeCitation(originalBody, position, { id: 'cit-1' });
    // Now mutate the body — the editor rewrote the surrounding text.
    const mutatedBody = 'COMPLETELY DIFFERENT SURROUNDING TEXT <!-- cite:cit-1 --> NEW TRAILING.';
    const r = renderExport('markdown', makeContext({ bodyMarkdown: mutatedBody, citations: [citation] }));
    expect(r.driftedCitationIds).toContain('cit-1');
  });

  it('does NOT flag a citation whose context is unchanged', () => {
    const body = 'Stable surrounding text <!-- cite:cit-1 --> stable trailing text.';
    const citation = makeCitation(body, body.indexOf('<!-- cite:cit-1 -->'), { id: 'cit-1' });
    const r = renderExport('markdown', makeContext({ bodyMarkdown: body, citations: [citation] }));
    expect(r.driftedCitationIds).toEqual([]);
  });

  it('reports drifted ids across all targets identically', () => {
    const originalBody = 'X <!-- cite:cit-1 --> Y';
    const citation = makeCitation(originalBody, originalBody.indexOf('<!-- cite:cit-1 -->'), { id: 'cit-1' });
    const mutatedBody = 'ABCDEFGHIJ <!-- cite:cit-1 --> KLMNOPQRST UVWXYZ another big chunk of context';
    for (const target of EXPORT_TARGETS) {
      const r = renderExport(target, makeContext({ bodyMarkdown: mutatedBody, citations: [citation] }));
      expect(r.driftedCitationIds).toContain('cit-1');
    }
  });
});

// ---------------------------------------------------------------------------
// Bibliography presence per target
// ---------------------------------------------------------------------------

describe('bibliography presence per target', () => {
  const body = 'Claim <!-- cite:cit-1 -->[^c1].';
  const citation = makeCitation(body, body.indexOf('<!-- cite:cit-1 -->'), { id: 'cit-1' });
  const ctx = makeContext({ bodyMarkdown: body, citations: [citation] });

  it('latex has thebibliography block', () => {
    expect(renderExport('latex', ctx).content.toString()).toMatch(/\\begin\{thebibliography\}/);
  });

  it('docx has Bibliography heading', () => {
    expect(renderExport('docx', ctx).content.toString()).toMatch(/<h2>Bibliography<\/h2>/);
  });

  it('pandoc declares bibliography via frontmatter (no inline biblio)', () => {
    const s = renderExport('pandoc', ctx).content.toString();
    expect(s).toMatch(/bibliography: refs\.bib/);
    expect(s).not.toMatch(/Bibliography/);
  });

  it('substack does NOT have a bibliography section', () => {
    expect(renderExport('substack', ctx).content.toString().toLowerCase()).not.toContain('bibliography');
  });

  it('markdown does NOT have a bibliography section (footnotes only)', () => {
    expect(renderExport('markdown', ctx).content.toString().toLowerCase()).not.toContain('bibliography');
  });
});

// ---------------------------------------------------------------------------
// BibTeX target — citations only, no body
// ---------------------------------------------------------------------------

describe('bibtex target shape', () => {
  it('produces only .bib entries, never the draft body', () => {
    const body = 'Sentence we should NOT see in bibtex <!-- cite:cit-1 -->.';
    const citation = makeCitation(body, body.indexOf('<!-- cite:cit-1 -->'), { id: 'cit-1' });
    const r = renderExport('bibtex', makeContext({ bodyMarkdown: body, citations: [citation] }));
    expect(r.content.toString()).not.toContain('Sentence we should NOT');
    expect(r.mimeType).toBe('application/x-bibtex');
    expect(r.filename.endsWith('.bib')).toBe(true);
  });

  it('de-dupes by artefact uri across multiple citations', () => {
    const body = 'A <!-- cite:cit-1 --> B <!-- cite:cit-2 --> C';
    const c1 = makeCitation(body, body.indexOf('<!-- cite:cit-1 -->'), { id: 'cit-1' });
    const c2 = makeCitation(body, body.indexOf('<!-- cite:cit-2 -->'), { id: 'cit-2' });
    const r = renderExport('bibtex', makeContext({ bodyMarkdown: body, citations: [c1, c2] }));
    const matches = r.content.toString().match(/@misc\{/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('emits one entry per distinct artefact when uris differ', () => {
    const body = 'A <!-- cite:cit-1 --> B <!-- cite:cit-2 --> C';
    const c1 = makeCitation(body, body.indexOf('<!-- cite:cit-1 -->'), { id: 'cit-1' });
    const c2 = makeCitation(body, body.indexOf('<!-- cite:cit-2 -->'), {
      id: 'cit-2',
      artefactSpaceUri: 'memu://fam1/quote/xyz-999',
      artefact: makeArtefact({ uri: 'memu://fam1/quote/xyz-999', authorHint: 'Lessig', yearHint: '2006' }),
    });
    const r = renderExport('bibtex', makeContext({ bodyMarkdown: body, citations: [c1, c2] }));
    const matches = r.content.toString().match(/@misc\{/g) ?? [];
    expect(matches.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Footnote anchor cleanup — the editor's [^cN] tokens get stripped
// ---------------------------------------------------------------------------

describe('editor-emitted footnote anchor handling', () => {
  it('strips [^cN] anchors and footnote definitions, then re-emits its own', () => {
    const body = 'Claim <!-- cite:cit-1 -->[^c1] and a tail.\n\n[^c1]: editor-emitted def\n';
    const citation = makeCitation(body, body.indexOf('<!-- cite:cit-1 -->'), { id: 'cit-1' });
    const r = renderExport('markdown', makeContext({ bodyMarkdown: body, citations: [citation] }));
    const s = r.content.toString();
    // Should have exactly one footnote definition (renderer's), not two.
    const defMatches = s.match(/^\[\^c1\]:/gm) ?? [];
    expect(defMatches.length).toBe(1);
    // Editor's wording must not survive.
    expect(s).not.toContain('editor-emitted def');
  });
});

// ---------------------------------------------------------------------------
// Unknown placeholders (body references a citation that no longer exists)
// ---------------------------------------------------------------------------

describe('unknown citation placeholders', () => {
  it('drops a placeholder with no matching citation row', () => {
    const body = 'Claim <!-- cite:ghost --> trailing.';
    const r = renderExport('markdown', makeContext({ bodyMarkdown: body, citations: [] }));
    const s = r.content.toString();
    expect(s).not.toContain('<!-- cite:ghost -->');
    expect(s).not.toContain('ghost');
  });
});

// ---------------------------------------------------------------------------
// Determinism — same inputs → same bytes
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces identical output across two invocations', () => {
    const body = 'Stable claim <!-- cite:cit-1 --> with trailing context for hash.';
    const citation = makeCitation(body, body.indexOf('<!-- cite:cit-1 -->'), { id: 'cit-1' });
    const ctx = makeContext({ bodyMarkdown: body, citations: [citation] });
    for (const target of EXPORT_TARGETS) {
      const a = renderExport(target, ctx).content.toString();
      const b = renderExport(target, ctx).content.toString();
      expect(a).toEqual(b);
    }
  });
});

// ---------------------------------------------------------------------------
// computeSurroundingHash — direct check
// ---------------------------------------------------------------------------

describe('computeSurroundingHash', () => {
  it('returns the same hash for identical 200-char windows', () => {
    const body = 'a'.repeat(500);
    expect(computeSurroundingHash(body, 200)).toEqual(computeSurroundingHash(body, 250));
  });

  it('returns a different hash when the surrounding window changes', () => {
    const a = computeSurroundingHash('aaa bbb ccc ddd', 7);
    const b = computeSurroundingHash('aaa xxx ccc ddd', 7);
    expect(a).not.toEqual(b);
  });

  it('clamps position to [0, length]', () => {
    const body = 'hello world';
    expect(() => computeSurroundingHash(body, -10)).not.toThrow();
    expect(() => computeSurroundingHash(body, 10000)).not.toThrow();
  });
});
