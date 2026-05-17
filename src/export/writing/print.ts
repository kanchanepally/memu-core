/**
 * BS3 Phase W6 — Print target renderer.
 *
 * HTML output sized for screen-reading or browser-print. Uses
 * superscript `<sup>1</sup>` for citation anchors inline and emits
 * a numbered footnotes section at end-of-doc, anchored by id so
 * "back to text" works inside the HTML.
 *
 * MIME type is text/html; the user prints from the browser. CSS is
 * minimal and inline so the file opens cleanly without external
 * stylesheets.
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToHtml(md: string): string {
  const blocks = md.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${inline(heading[2])}</h${level}>`;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        const items = trimmed
          .split(/\n/)
          .map(l => l.replace(/^[-*]\s+/, ''))
          .map(l => `<li>${inline(l)}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${inline(trimmed.replace(/\n/g, ' '))}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Recover the sup-anchor token we injected pre-escape.
  out = out.replace(/SUPC(\d+)/g, (_m, n) =>
    `<sup id="fnref-${n}"><a href="#fn-${n}">${n}</a></sup>`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) =>
    `<a href="${url}">${txt}</a>`);
  return out;
}

function supAnchor(_c: CitationWithArtefact, index: number): string {
  // Embed an ASCII sentinel that survives escapeHtml and gets
  // converted into the real <sup> in inline(). Avoids
  // double-escaping the angle brackets.
  return `SUPC${index + 1}`;
}

function footnoteHtml(c: CitationWithArtefact, index: number): string {
  const n = index + 1;
  if (!c.artefact) {
    return `<li id="fn-${n}">${DELETED_ARTEFACT_LABEL} <a href="#fnref-${n}">↩</a></li>`;
  }
  const a = c.artefact;
  const author = a.authorHint ? `${escapeHtml(a.authorHint)}, ` : '';
  const year = a.yearHint ? ` (${escapeHtml(a.yearHint)})` : '';
  const passage = c.passageId ? `, ${escapeHtml(c.passageId)}` : '';
  const url = a.urlHint || a.uri;
  return `<li id="fn-${n}">${author}<em>${escapeHtml(a.title || 'Untitled')}</em>${year}${passage}. <a href="${escapeHtml(url)}">${escapeHtml(url)}</a> <a href="#fnref-${n}">↩</a></li>`;
}

const PRINT_CSS = `
body { font-family: Georgia, 'Times New Roman', serif; max-width: 42rem; margin: 2rem auto; line-height: 1.6; color: #222; padding: 0 1rem; }
h1, h2, h3, h4 { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
sup a { text-decoration: none; color: #06c; }
.footnotes { border-top: 1px solid #ccc; margin-top: 3rem; padding-top: 1rem; font-size: 0.9em; }
.footnotes ol { padding-left: 1.5rem; }
@media print {
  body { max-width: none; margin: 0; }
}
`.trim();

export function renderPrint(context: RenderContext): ExportResult {
  const drifted = detectDriftedCitations(context.bodyMarkdown, context.citations);

  const { bodyWithReplacements, substitutedCitationIds } = substitutePlaceholders(
    context.bodyMarkdown,
    context.citations,
    supAnchor,
  );

  const idToCitation = new Map(context.citations.map(c => [c.id, c]));
  const footnotes: string[] = [];
  substitutedCitationIds.forEach((id, idx) => {
    const c = idToCitation.get(id);
    if (c) footnotes.push(footnoteHtml(c, idx));
  });

  const bodyHtml = markdownToHtml(bodyWithReplacements.trim());
  const footnotesSection = footnotes.length
    ? `<section class="footnotes"><h2>Notes</h2><ol>${footnotes.join('')}</ol></section>`
    : '';

  const html =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8"/>\n` +
    `<title>${escapeHtml(context.title || 'Untitled')}</title>\n` +
    `<style>${PRINT_CSS}</style>\n</head>\n<body>\n` +
    `<h1>${escapeHtml(context.title || 'Untitled')}</h1>\n` +
    `${bodyHtml}\n${footnotesSection}\n` +
    `</body>\n</html>\n`;

  return {
    content: html,
    mimeType: 'text/html; charset=utf-8',
    filename: `${safeFilename(context.title, 'writing-space')}-print.html`,
    driftedCitationIds: drifted,
  };
}
