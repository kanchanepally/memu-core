/**
 * BS3 Phase W6 — DOCX target renderer.
 *
 * ## DOCX delivery: Microsoft Word HTML (.doc), not OOXML (.docx)
 *
 * A genuine .docx is an OOXML zip with strict schema. Generating one
 * deterministically requires either the `docx` npm package (~50KB
 * dep tree, fine) OR a hand-rolled XML/ZIP builder (lots of code,
 * fragile). For W6 we ship the SIMPLER option that Word still opens
 * cleanly: an HTML document served as `application/vnd.ms-word` with
 * a `.doc` extension. Word recognises the MIME type, parses the
 * HTML, and renders headings / bold / italic / links / footnotes
 * correctly. The file round-trips through "Save As .docx" inside
 * Word with no work on the user's part.
 *
 * Trade-offs (documented honestly):
 *   - Pro: zero new deps, deterministic, easy to test (string compare).
 *   - Pro: still readable in any browser as a fallback.
 *   - Con: not a real .docx — power users opening it in something
 *     other than Word may see HTML.
 *   - Con: footnotes render as a numbered list at end-of-doc, not
 *     as Word's native footnote feature.
 *
 * A real OOXML writer can land in W6.1 if Founding-50 evidence
 * shows researchers care; for now, getting the bytes into Word with
 * the citations intact is the load-bearing requirement.
 *
 * Citation style: author-date inline + bibliography section at end.
 */

import {
  type RenderContext,
  type ExportResult,
  type CitedArtefact,
  type CitationWithArtefact,
  DELETED_ARTEFACT_LABEL,
  detectDriftedCitations,
  safeFilename,
  substitutePlaceholders,
} from './types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function authorDateInline(c: CitationWithArtefact): string {
  const a = c.artefact;
  if (!a) return `(${DELETED_ARTEFACT_LABEL})`;
  const author = a.authorHint || 'Memu';
  const year = a.yearHint || 'n.d.';
  const passage = c.passageId ? `, ${c.passageId}` : '';
  return ` (${author} ${year}${passage})`;
}

function bibliographyEntry(a: CitedArtefact): string {
  const author = a.authorHint || 'Memu';
  const year = a.yearHint || 'n.d.';
  const title = a.title || 'Untitled';
  const url = a.urlHint || a.uri;
  return `${escapeHtml(author)} (${escapeHtml(year)}). <em>${escapeHtml(title)}</em>. <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
}

/**
 * Minimal markdown → HTML conversion. Just enough to make headings,
 * paragraphs, bold, italic, and links work in Word. Pulling in
 * markdown-it would also work but adds plugin-output noise (e.g.
 * `<p>` wrapping) — for a deterministic test target, this is
 * easier to reason about.
 */
function markdownToHtml(md: string): string {
  // Normalise newlines, split into blocks on blank lines.
  const blocks = md.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      // Headings
      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${inline(heading[2])}</h${level}>`;
      }
      // Unordered list
      if (/^[-*]\s+/.test(trimmed)) {
        const items = trimmed
          .split(/\n/)
          .map(l => l.replace(/^[-*]\s+/, ''))
          .map(l => `<li>${inline(l)}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      // Paragraph
      return `<p>${inline(trimmed.replace(/\n/g, ' '))}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

function inline(s: string): string {
  // Bold **x**, italic *x*, link [text](url)
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Re-decode link syntax (we escaped brackets above; restore for replacement).
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) => `<a href="${url}">${txt}</a>`);
  return out;
}

export function renderDocx(context: RenderContext): ExportResult {
  const drifted = detectDriftedCitations(context.bodyMarkdown, context.citations);

  const { bodyWithReplacements, substitutedCitationIds } = substitutePlaceholders(
    context.bodyMarkdown,
    context.citations,
    authorDateInline,
  );

  const idToCitation = new Map(context.citations.map(c => [c.id, c]));
  // De-duplicate bibliography by artefact uri — many citations to one piece.
  const seen = new Set<string>();
  const biblioArtefacts: CitedArtefact[] = [];
  for (const id of substitutedCitationIds) {
    const c = idToCitation.get(id);
    if (!c || !c.artefact) continue;
    if (seen.has(c.artefact.uri)) continue;
    seen.add(c.artefact.uri);
    biblioArtefacts.push(c.artefact);
  }

  const bodyHtml = markdownToHtml(bodyWithReplacements.trim());
  const biblioHtml = biblioArtefacts.length
    ? `<h2>Bibliography</h2>\n<ol>${biblioArtefacts
        .map(a => `<li>${bibliographyEntry(a)}</li>`)
        .join('')}</ol>`
    : '';

  const titleHtml = `<h1>${escapeHtml(context.title || 'Untitled')}</h1>`;
  const authorMeta = context.authorHint
    ? `<meta name="author" content="${escapeHtml(context.authorHint)}"/>`
    : '';
  const dateMeta = context.updatedAt
    ? `<meta name="created" content="${escapeHtml(context.updatedAt)}"/>`
    : '';

  // The xmlns:o / xmlns:w attributes are the Microsoft Office hint
  // that makes Word treat this HTML as a Word document on open.
  const html =
    `<!DOCTYPE html>\n<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">\n` +
    `<head>\n<meta charset="utf-8"/>\n<title>${escapeHtml(context.title || 'Untitled')}</title>\n${authorMeta}${dateMeta}\n</head>\n<body>\n` +
    `${titleHtml}\n${bodyHtml}\n${biblioHtml}\n</body>\n</html>\n`;

  return {
    content: html,
    mimeType: 'application/vnd.ms-word',
    filename: `${safeFilename(context.title, 'writing-space')}.doc`,
    driftedCitationIds: drifted,
  };
}
