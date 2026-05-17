/**
 * BS3 Phase W6 — LaTeX target renderer.
 *
 * Output: a standalone .tex document with \cite{} commands at the
 * citation points and a \begin{thebibliography} block at the end.
 *
 * No external .bib file — keeping the export self-contained means
 * the researcher can drop the .tex into any LaTeX environment and
 * pdflatex runs in one pass. Power users who want a real .bib
 * should use the `bibtex` target alongside; this target is the
 * "click → compile" path.
 */

import {
  type RenderContext,
  type ExportResult,
  type CitedArtefact,
  type CitationWithArtefact,
  DELETED_ARTEFACT_LABEL,
  buildCitationKey,
  detectDriftedCitations,
  safeFilename,
  substitutePlaceholders,
} from './types';

/** Escape characters that have a special meaning in LaTeX. */
function escapeTex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\~{}')
    .replace(/</g, '\\textless{}')
    .replace(/>/g, '\\textgreater{}');
}

/**
 * Sentinel placeholder used during markdown→LaTeX conversion. The
 * substitutePlaceholders step runs BEFORE markdownToLatex; if it
 * emitted `\cite{key}` directly, escapeTex would mangle the
 * backslash and braces to `\textbackslash{}cite\{key\}`. We emit
 * an alphanumeric sentinel that survives escapeTex untouched, then
 * post-process the rendered TeX to swap the sentinel for the real
 * `\cite{key}` command. The id portion is the citation row's `id`
 * so the post-processor can look up the artefact.
 */
const CITE_SENTINEL = (id: string) => ` XMEMUCITEX${id}XMEMUENDX`;
const SENTINEL_RE = /\s?XMEMUCITEX([a-zA-Z0-9_-]+)XMEMUENDX/g;

function citeCommand(c: CitationWithArtefact): string {
  return CITE_SENTINEL(c.id);
}

function bibitem(a: CitedArtefact): string {
  const key = buildCitationKey(a);
  const author = escapeTex(a.authorHint || 'Memu');
  const year = escapeTex(a.yearHint || 'n.d.');
  const title = escapeTex(a.title || 'Untitled');
  const url = a.urlHint || a.uri;
  return `\\bibitem{${key}} ${author} (${year}). \\emph{${title}}. \\url{${escapeTex(url)}}`;
}

/**
 * Minimal markdown → LaTeX. Headings, bold, italic, links,
 * paragraphs. Anything fancier (tables, code blocks) gets escaped
 * as-is — the researcher can fix up in their TeX editor.
 */
function markdownToLatex(md: string): string {
  const blocks = md.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        const level = heading[1].length;
        const cmd = level <= 1 ? 'section' : level === 2 ? 'subsection' : 'subsubsection';
        return `\\${cmd}{${inlineTex(heading[2])}}`;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        const items = trimmed
          .split(/\n/)
          .map(l => l.replace(/^[-*]\s+/, ''))
          .map(l => `  \\item ${inlineTex(l)}`)
          .join('\n');
        return `\\begin{itemize}\n${items}\n\\end{itemize}`;
      }
      return inlineTex(trimmed.replace(/\n/g, ' '));
    })
    .filter(Boolean)
    .join('\n\n');
}

function inlineTex(s: string): string {
  // Capture markdown bold/italic/link BEFORE escaping so the
  // delimiters aren't mangled.
  const tokens: Array<{ type: 'text' | 'bold' | 'italic' | 'link'; value: string; url?: string }> = [];
  let remaining = s;
  while (remaining.length) {
    const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(remaining);
    const bold = /\*\*([^*]+)\*\*/.exec(remaining);
    const italic = /(^|[^*])\*([^*]+)\*/.exec(remaining);
    const candidates = [
      link ? { match: link, type: 'link' as const, idx: link.index } : null,
      bold ? { match: bold, type: 'bold' as const, idx: bold.index } : null,
      italic ? { match: italic, type: 'italic' as const, idx: italic.index + (italic[1] ? italic[1].length : 0) } : null,
    ].filter(Boolean) as Array<{ match: RegExpExecArray; type: 'link' | 'bold' | 'italic'; idx: number }>;
    if (candidates.length === 0) {
      tokens.push({ type: 'text', value: remaining });
      break;
    }
    candidates.sort((a, b) => a.idx - b.idx);
    const first = candidates[0];
    if (first.idx > 0) tokens.push({ type: 'text', value: remaining.slice(0, first.idx) });
    if (first.type === 'link') {
      tokens.push({ type: 'link', value: first.match[1], url: first.match[2] });
      remaining = remaining.slice(first.idx + first.match[0].length);
    } else if (first.type === 'bold') {
      tokens.push({ type: 'bold', value: first.match[1] });
      remaining = remaining.slice(first.idx + first.match[0].length);
    } else {
      tokens.push({ type: 'italic', value: first.match[2] });
      remaining = remaining.slice(first.idx + first.match[0].length);
    }
  }
  return tokens
    .map(t => {
      if (t.type === 'text') return escapeTex(t.value);
      if (t.type === 'bold') return `\\textbf{${escapeTex(t.value)}}`;
      if (t.type === 'italic') return `\\emph{${escapeTex(t.value)}}`;
      return `\\href{${t.url}}{${escapeTex(t.value)}}`;
    })
    .join('');
}

export function renderLatex(context: RenderContext): ExportResult {
  const drifted = detectDriftedCitations(context.bodyMarkdown, context.citations);

  const { bodyWithReplacements, substitutedCitationIds } = substitutePlaceholders(
    context.bodyMarkdown,
    context.citations,
    citeCommand,
  );

  const idToCitation = new Map(context.citations.map(c => [c.id, c]));
  const seen = new Set<string>();
  const biblioArtefacts: CitedArtefact[] = [];
  for (const id of substitutedCitationIds) {
    const c = idToCitation.get(id);
    if (!c || !c.artefact) continue;
    if (seen.has(c.artefact.uri)) continue;
    seen.add(c.artefact.uri);
    biblioArtefacts.push(c.artefact);
  }

  const titleTex = escapeTex(context.title || 'Untitled');
  const authorLine = context.authorHint ? `\\author{${escapeTex(context.authorHint)}}` : '\\author{}';
  const dateLine = context.updatedAt ? `\\date{${escapeTex(context.updatedAt)}}` : '\\date{}';
  // Two-pass: markdown→LaTeX first (escapes everything safely), then
  // post-substitute the citation sentinels with real \cite{} commands.
  const bodyById = new Map(context.citations.map(c => [c.id, c]));
  const bodyTex = markdownToLatex(bodyWithReplacements.trim()).replace(
    SENTINEL_RE,
    (_match, citeId: string) => {
      const c = bodyById.get(citeId);
      if (!c || !c.artefact) return ' \\cite{deleted-artefact}';
      return ` \\cite{${buildCitationKey(c.artefact)}}`;
    },
  );

  const bibBlock = biblioArtefacts.length
    ? `\\begin{thebibliography}{${biblioArtefacts.length}}\n${biblioArtefacts.map(bibitem).join('\n')}\n\\end{thebibliography}`
    : '';

  const tex =
    `\\documentclass{article}\n` +
    `\\usepackage[utf8]{inputenc}\n` +
    `\\usepackage{hyperref}\n` +
    `\\title{${titleTex}}\n` +
    `${authorLine}\n` +
    `${dateLine}\n` +
    `\\begin{document}\n` +
    `\\maketitle\n\n` +
    `${bodyTex}\n\n` +
    `${bibBlock}\n` +
    `\\end{document}\n`;

  return {
    content: tex,
    mimeType: 'application/x-tex',
    filename: `${safeFilename(context.title, 'writing-space')}.tex`,
    driftedCitationIds: drifted,
  };
}
