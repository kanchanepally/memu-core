/**
 * BS3 Phase W6 — markdown target renderer.
 *
 * Output is plain CommonMark + footnote extension. Format:
 *
 *   # Title
 *
 *   body with anchored footnote[^c1]
 *
 *   [^c1]: Author, "Artefact Title" (memu://...)
 *
 * Footnote anchors are numbered by appearance order in the body.
 * Renderer-emitted, not editor-emitted — any `[^cN]` tokens in the
 * source body are stripped first (substitutePlaceholders does it).
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

function renderFootnoteAnchor(_c: CitationWithArtefact, index: number): string {
  return `[^c${index + 1}]`;
}

function renderFootnoteDefinition(c: CitationWithArtefact, index: number): string {
  const a = c.artefact;
  if (!a) return `[^c${index + 1}]: ${DELETED_ARTEFACT_LABEL}`;
  const titlePart = a.title ? `"${a.title}"` : '"Untitled"';
  const authorPart = a.authorHint ? `${a.authorHint}, ` : '';
  const yearPart = a.yearHint ? ` (${a.yearHint})` : '';
  const passagePart = c.passageId ? ` [${c.passageId}]` : '';
  const url = a.urlHint || a.uri;
  return `[^c${index + 1}]: ${authorPart}${titlePart}${yearPart}${passagePart} (${url})`;
}

export function renderMarkdown(context: RenderContext): ExportResult {
  const drifted = detectDriftedCitations(context.bodyMarkdown, context.citations);

  const { bodyWithReplacements, substitutedCitationIds } = substitutePlaceholders(
    context.bodyMarkdown,
    context.citations,
    renderFootnoteAnchor,
  );

  // Build footnote definitions for substituted citations in order.
  const idToCitation = new Map(context.citations.map(c => [c.id, c]));
  const definitions: string[] = [];
  substitutedCitationIds.forEach((id, idx) => {
    const c = idToCitation.get(id);
    if (c) definitions.push(renderFootnoteDefinition(c, idx));
  });

  const sections: string[] = [`# ${context.title || 'Untitled'}`];
  if (bodyWithReplacements.trim()) sections.push(bodyWithReplacements.trim());
  if (definitions.length) sections.push(definitions.join('\n'));

  const content = sections.join('\n\n') + '\n';
  return {
    content,
    mimeType: 'text/markdown; charset=utf-8',
    filename: `${safeFilename(context.title, 'writing-space')}.md`,
    driftedCitationIds: drifted,
  };
}
