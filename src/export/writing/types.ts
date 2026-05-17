/**
 * BS3 Phase W6 — shared types for the Writing Space export pipeline.
 *
 * Every target renderer (markdown / substack / docx / latex / pandoc /
 * bibtex / print) consumes the SAME RenderContext and returns an
 * ExportResult. Renderers are pure: no DB, no LLM, no Date.now(). The
 * DB-touching loader lives in src/api/writingSpaceExport.ts; it
 * assembles the RenderContext, then calls into the registry.
 *
 * Citation handling:
 *
 *   - bodyMarkdown contains placeholders like `<!-- cite:UUID -->`
 *     paired with `[^c1]` footnote anchors that the W4 editor
 *     inserted. The renderer strips both and emits target-correct
 *     citation forms from the typed CitationWithArtefact[] rows.
 *
 *   - surrounding_hash drift detection re-computes the SHA-1 of the
 *     200 characters surrounding position_in_draft against the
 *     current body. Mismatch ⇒ the id is added to
 *     ExportResult.driftedCitationIds so the API surface can warn
 *     ("review 2 drifted citations before export").
 *
 *   - Inline copy of computeSurroundingHash is kept here (rather
 *     than importing from src/spaces/writingSpaceStore.ts) so the
 *     pure renderer tier has zero coupling to the DB tier. The
 *     algorithm is documented inline; the store must use the same
 *     200-char window + SHA-1 hex contract for the cross-check to
 *     work.
 */

import crypto from 'node:crypto';

export type ExportTarget =
  | 'markdown'
  | 'substack'
  | 'docx'
  | 'latex'
  | 'pandoc'
  | 'bibtex'
  | 'print';

export const EXPORT_TARGETS: readonly ExportTarget[] = [
  'markdown',
  'substack',
  'docx',
  'latex',
  'pandoc',
  'bibtex',
  'print',
] as const;

export function isExportTarget(s: unknown): s is ExportTarget {
  return typeof s === 'string' && (EXPORT_TARGETS as readonly string[]).includes(s);
}

/**
 * Subset of artefact metadata the renderers care about. Synthesised
 * by the loader from `synthesis_pages` + heuristics over
 * `source_references` and `description`. Kept minimal — every field
 * the renderers need is here and nothing else is.
 */
export interface CitedArtefact {
  uri: string;
  title: string;
  category: string;
  description: string;
  bodyMarkdown: string;
  /** Lightweight heuristic — last token of "by X" / a doc filename / "memu". */
  authorHint?: string;
  /** First 4-digit year (19xx / 20xx) found in description. */
  yearHint?: string;
  /** First URL found in source_references. */
  urlHint?: string;
}

export type CitationFormat = 'footnote' | 'inline' | 'parenthetical' | 'author_date';

export interface CitationWithArtefact {
  id: string;
  artefactSpaceUri: string;
  passageId: string | null;
  positionInDraft: number;
  surroundingHash: string;
  citationFormat: CitationFormat | null;
  /** null when the cited artefact has been deleted (tombstone). */
  artefact: CitedArtefact | null;
}

export interface RenderContext {
  writingSpaceId: string;
  title: string;
  template: string;
  bodyMarkdown: string;
  citations: CitationWithArtefact[];
  /** owner profile display_name — populates docx Author meta, LaTeX \author{}, etc. */
  authorHint?: string;
  workspaceName?: string;
  /**
   * Deterministic timestamp string baked into the output where a
   * date is needed (LaTeX \date{}, DOCX header). Sourced from
   * writing_spaces.updated_at by the loader. Tests can pass a
   * fixed value.
   */
  updatedAt?: string;
}

export interface ExportResult {
  content: Buffer | string;
  mimeType: string;
  filename: string;
  /**
   * Citations whose surrounding_hash didn't match a recomputation
   * against the current body. The endpoint forwards this so the UI
   * can warn "Review N citations before export".
   */
  driftedCitationIds: string[];
}

// ---------------------------------------------------------------------------
// surrounding_hash drift detection
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-1 hex of the 200 characters surrounding the given
 * position in the body (100 before + 100 after, clipped at body
 * boundaries). Kept in lock-step with the same function in
 * writingSpaceStore.ts (when it lands); change either side
 * carelessly and EVERY drafted citation flags as drifted.
 */
export function computeSurroundingHash(body: string, position: number): string {
  if (!body) return crypto.createHash('sha1').update('').digest('hex');
  const len = body.length;
  const pos = Math.max(0, Math.min(position, len));
  const start = Math.max(0, pos - 100);
  const end = Math.min(len, pos + 100);
  const window = body.slice(start, end);
  return crypto.createHash('sha1').update(window).digest('hex');
}

/**
 * Walk the citations and recompute hashes against the current body.
 * Return the ids that no longer match. Empty array = nothing drifted.
 */
export function detectDriftedCitations(
  body: string,
  citations: readonly CitationWithArtefact[],
): string[] {
  const drifted: string[] = [];
  for (const c of citations) {
    const recomputed = computeSurroundingHash(body, c.positionInDraft);
    if (recomputed !== c.surroundingHash) drifted.push(c.id);
  }
  return drifted;
}

// ---------------------------------------------------------------------------
// Shared rendering helpers — used by multiple target renderers
// ---------------------------------------------------------------------------

const CITE_PLACEHOLDER_RE = /<!--\s*cite:([a-zA-Z0-9_-]+)\s*-->/g;
const FOOTNOTE_ANCHOR_RE = /\[\^c\d+\]/g;
/** [^c1]: blah ... up to a blank line. Stripped from body before render. */
const FOOTNOTE_DEFINITION_RE = /^\[\^c\d+\]:[^\n]*(?:\n[ \t]+[^\n]*)*\n?/gm;

/**
 * Result of substituting placeholders with target-emitted strings.
 * `bodyWithReplacements` is the editor body with each
 * `<!-- cite:UUID -->` and stale `[^c1]` token replaced by the
 * caller's per-citation string (or empty if the citation is unknown).
 * `unknownPlaceholders` lists citation UUIDs that appeared in the
 * body but had no row in citations[] — the renderer must decide
 * whether to drop them silently or footnote them.
 */
export interface PlaceholderSubstitution {
  bodyWithReplacements: string;
  /** UUIDs that appeared in <!-- cite:UUID --> but weren't in citations[]. */
  unknownPlaceholders: string[];
  /** Citation ids actually substituted in order of appearance. */
  substitutedCitationIds: string[];
}

/**
 * Replace each `<!-- cite:UUID -->` in the body with the string
 * returned by `render(citation, index)`. Strip any `[^c1]` and
 * `[^c1]: …` blocks the editor inserted — the renderer generates
 * its own footnote anchors from the typed rows so format is
 * canonical per target.
 */
export function substitutePlaceholders(
  body: string,
  citations: readonly CitationWithArtefact[],
  render: (citation: CitationWithArtefact, index: number) => string,
): PlaceholderSubstitution {
  const byId = new Map<string, CitationWithArtefact>();
  for (const c of citations) byId.set(c.id, c);

  const unknownPlaceholders: string[] = [];
  const substitutedCitationIds: string[] = [];
  let nextIndex = 0;

  // Strip editor-emitted footnote definitions FIRST so substitution
  // can't see them. (Definitions live at end of doc; anchors are
  // mid-paragraph and handled below.)
  const stripped = body.replace(FOOTNOTE_DEFINITION_RE, '');

  const replaced = stripped.replace(CITE_PLACEHOLDER_RE, (_match, uuid: string) => {
    const c = byId.get(uuid);
    if (!c) {
      unknownPlaceholders.push(uuid);
      return '';
    }
    const idx = nextIndex++;
    substitutedCitationIds.push(c.id);
    return render(c, idx);
  });

  // Strip any [^cN] anchors the editor left in the body — the
  // renderer emits its own form via `render(c)` above.
  const cleaned = replaced.replace(FOOTNOTE_ANCHOR_RE, '');
  return {
    bodyWithReplacements: cleaned,
    unknownPlaceholders,
    substitutedCitationIds,
  };
}

/**
 * Build a stable BibTeX-safe citation key: `${author}-${year}-${shortHash}`.
 * Lowercased; non-alphanumerics collapsed to '-'.
 */
export function buildCitationKey(artefact: CitedArtefact): string {
  const author = artefact.authorHint || 'memu';
  const year = artefact.yearHint || 'nd';
  const shortHash = crypto.createHash('sha1').update(artefact.uri).digest('hex').slice(0, 6);
  const raw = `${author}-${year}-${shortHash}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'memu-nd';
}

/** Sanitise a string for use in a filename. */
export function safeFilename(input: string, fallback: string): string {
  const cleaned = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

/**
 * Tombstone label for a deleted artefact. Used by every renderer so
 * the visual treatment is consistent across targets.
 */
export const DELETED_ARTEFACT_LABEL = '[deleted artefact]';
