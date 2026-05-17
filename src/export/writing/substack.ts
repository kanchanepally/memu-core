/**
 * BS3 Phase W6 — Substack target renderer.
 *
 * Substack's editor pastes markdown reasonably well but their
 * footnote handling is inconsistent. We emit inline links instead:
 *
 *   ... as [Berners-Lee noted](https://example.org/...)
 *
 * Fallback when an artefact has no urlHint: plain parenthetical
 * `(Berners-Lee 2023)` — readable, no broken link.
 *
 * No bibliography section — Substack readers won't read it; the
 * inline links carry the provenance.
 */

import {
  type RenderContext,
  type ExportResult,
  type CitationWithArtefact,
  DELETED_ARTEFACT_LABEL,
  detectDriftedCitations,
  safeFilename,
  substitutePlaceholders,
} from './types';

function renderInlineLink(c: CitationWithArtefact): string {
  const a = c.artefact;
  if (!a) return `(${DELETED_ARTEFACT_LABEL})`;
  const authorPart = a.authorHint || 'source';
  const yearPart = a.yearHint ? ` ${a.yearHint}` : '';
  const label = `${authorPart}${yearPart}`;
  if (a.urlHint) return `([${label}](${a.urlHint}))`;
  return `(${label})`;
}

export function renderSubstack(context: RenderContext): ExportResult {
  const drifted = detectDriftedCitations(context.bodyMarkdown, context.citations);

  const { bodyWithReplacements } = substitutePlaceholders(
    context.bodyMarkdown,
    context.citations,
    renderInlineLink,
  );

  const sections: string[] = [`# ${context.title || 'Untitled'}`];
  if (bodyWithReplacements.trim()) sections.push(bodyWithReplacements.trim());

  const content = sections.join('\n\n') + '\n';
  return {
    content,
    mimeType: 'text/markdown; charset=utf-8',
    filename: `${safeFilename(context.title, 'writing-space')}-substack.md`,
    driftedCitationIds: drifted,
  };
}
