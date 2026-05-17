/**
 * BS3 Phase W6 — Pandoc target renderer.
 *
 * Output is markdown + Pandoc citation keys (`[@author-2023-abc123]`)
 * with a YAML frontmatter declaring `bibliography: refs.bib`. The
 * researcher pipes the `.md` through pandoc + the bibtex output of
 * the `bibtex` target to produce PDF / docx / html with proper
 * citation formatting via pandoc-citeproc.
 *
 * No inline bibliography section — pandoc generates that from the
 * .bib file at conversion time. We just emit the keys.
 */

import {
  type RenderContext,
  type ExportResult,
  type CitationWithArtefact,
  DELETED_ARTEFACT_LABEL,
  buildCitationKey,
  detectDriftedCitations,
  safeFilename,
  substitutePlaceholders,
} from './types';

function pandocCite(c: CitationWithArtefact): string {
  if (!c.artefact) return ` [${DELETED_ARTEFACT_LABEL}]`;
  const key = buildCitationKey(c.artefact);
  if (c.passageId) return ` [@${key}, ${c.passageId}]`;
  return ` [@${key}]`;
}

export function renderPandoc(context: RenderContext): ExportResult {
  const drifted = detectDriftedCitations(context.bodyMarkdown, context.citations);

  const { bodyWithReplacements } = substitutePlaceholders(
    context.bodyMarkdown,
    context.citations,
    pandocCite,
  );

  const frontmatter = [
    '---',
    `title: "${(context.title || 'Untitled').replace(/"/g, '\\"')}"`,
    context.authorHint ? `author: "${context.authorHint.replace(/"/g, '\\"')}"` : null,
    context.updatedAt ? `date: "${context.updatedAt}"` : null,
    'bibliography: refs.bib',
    'link-citations: true',
    '---',
  ].filter(Boolean).join('\n');

  const sections = [frontmatter];
  if (bodyWithReplacements.trim()) sections.push(bodyWithReplacements.trim());

  const content = sections.join('\n\n') + '\n';
  return {
    content,
    mimeType: 'text/markdown; charset=utf-8',
    filename: `${safeFilename(context.title, 'writing-space')}-pandoc.md`,
    driftedCitationIds: drifted,
  };
}
