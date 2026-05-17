/**
 * BS3 Phase W3 — Writing Spaces data layer.
 *
 * A Writing Space is a long-form draft (essay, paper, substack article)
 * with version history, typed citation rows, and a status lifecycle.
 *
 * This module is the lower-level data layer underneath api/writingSpaces.ts:
 *
 *   - Pure helpers (testable without a DB): computeSurroundingHash,
 *     validateStatusTransition, extractCitationPlaceholders, summariseChanges
 *   - DB helpers (use db.query / db.transaction, run inside the active
 *     collective context): createWritingSpace, findWritingSpace,
 *     listWritingSpaces, saveWritingSpaceVersion, transitionStatus,
 *     deleteWritingSpace, insertCitation, listCitations, deleteCitation,
 *     listVersions, findVersion, runCitePickerDeterministic
 *
 * RLS scopes every read/write — every table touched here (writing_spaces,
 * writing_space_versions, writing_space_citations, artefact_uses) is
 * collective-scoped per migration 053. db.query / db.transaction inherit
 * the active collective context bound by requireCollective.
 */

import crypto from 'crypto';
import { db } from '../db/tenant';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const WRITING_STATUSES = [
  'drafting',
  'revising',
  'ready_to_publish',
  'published',
  'archived',
] as const;
export type WritingStatus = typeof WRITING_STATUSES[number];

export function isWritingStatus(s: unknown): s is WritingStatus {
  return typeof s === 'string' && (WRITING_STATUSES as readonly string[]).includes(s);
}

export const CITATION_FORMATS = ['footnote', 'inline', 'parenthetical', 'author_date'] as const;
export type CitationFormat = typeof CITATION_FORMATS[number];

export function isCitationFormat(s: unknown): s is CitationFormat {
  return typeof s === 'string' && (CITATION_FORMATS as readonly string[]).includes(s);
}

export interface WritingSpaceRow {
  id: string;
  collectiveId: string;
  title: string;
  template: string;
  bodyMarkdown: string;
  status: WritingStatus;
  workingSetId: string | null;
  currentVersion: number;
  ownerProfileId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface WritingSpaceWithCitations extends WritingSpaceRow {
  citations: CitationRow[];
}

export interface VersionRow {
  id: string;
  writingSpaceId: string;
  versionNumber: number;
  bodyMarkdown: string;
  changesSummary: string | null;
  savedByProfileId: string;
  createdAt: string;
}

export interface CitationRow {
  id: string;
  writingSpaceId: string;
  artefactSpaceUri: string;
  passageId: string | null;
  positionInDraft: number;
  surroundingHash: string;
  citationFormat: CitationFormat | null;
  insertedAt: string;
}

export interface CitePickerCandidate {
  uri: string;
  title: string;
  category: string;
  description: string;
  snippet: string;
  isInWorkingSet: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * SHA-1 hex of the windowSize chars centred on `position` (windowSize/2
 * before + windowSize/2 after, clamped to body bounds). Used to detect
 * citation drift — if the surrounding context at export time hashes to
 * a different value than what was captured at insert time, the citation
 * is flagged as potentially stale.
 *
 * - Empty body → hash the empty string (stable, deterministic).
 * - Position outside the body is clamped to the nearest valid index.
 * - windowSize defaults to 200.
 */
export function computeSurroundingHash(
  bodyMarkdown: string,
  position: number,
  windowSize: number = 200,
): string {
  const body = typeof bodyMarkdown === 'string' ? bodyMarkdown : '';
  const half = Math.floor(windowSize / 2);
  const clampedPos = Math.max(0, Math.min(body.length, Math.floor(position)));
  const start = Math.max(0, clampedPos - half);
  const end = Math.min(body.length, clampedPos + half);
  const window = body.slice(start, end);
  return crypto.createHash('sha1').update(window, 'utf8').digest('hex');
}

/**
 * Allowed status transitions for a Writing Space.
 *
 *   drafting          → revising | ready_to_publish | archived
 *   revising          → drafting | ready_to_publish | archived
 *   ready_to_publish  → published | revising | archived
 *   published         → archived           (one-way past publish; revisions
 *                                            require re-opening as revising —
 *                                            but the spec says published is
 *                                            terminal except for archive)
 *   archived          → drafting           (recover an archived draft)
 *
 * Same-state transitions are rejected (they're no-ops and the API layer
 * shouldn't have to special-case them). Any other transition rejects.
 */
export type StatusTransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

const ALLOWED_TRANSITIONS: Record<WritingStatus, readonly WritingStatus[]> = {
  drafting: ['revising', 'ready_to_publish', 'archived'],
  revising: ['drafting', 'ready_to_publish', 'archived'],
  ready_to_publish: ['published', 'revising', 'archived'],
  published: ['archived'],
  archived: ['drafting'],
};

export function validateStatusTransition(
  from: WritingStatus,
  to: WritingStatus,
): StatusTransitionResult {
  if (!isWritingStatus(from)) {
    return { ok: false, reason: `invalid_from_status: ${String(from)}` };
  }
  if (!isWritingStatus(to)) {
    return { ok: false, reason: `invalid_to_status: ${String(to)}` };
  }
  if (from === to) {
    return { ok: false, reason: `already_${to}` };
  }
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `transition_not_allowed: ${from}->${to}` };
  }
  return { ok: true };
}

/**
 * Extract `<!-- cite:UUID -->` placeholders from a draft body. Returns
 * each marker's citation id (the UUID inside the placeholder) and its
 * starting character position in the body.
 *
 * The export pipeline (W6) uses this to know which citation rows to
 * materialise — every placeholder in the body should match exactly one
 * row in writing_space_citations.
 *
 * Pattern is permissive about UUID shape (any 1+ chars of [A-Za-z0-9_-])
 * so a Writing Space written before strict UUIDs were enforced still
 * parses. The cite id is whatever's after `cite:` and before ` -->`.
 */
export function extractCitationPlaceholders(
  bodyMarkdown: string,
): { id: string; position: number }[] {
  if (typeof bodyMarkdown !== 'string' || !bodyMarkdown) return [];
  const pattern = /<!--\s*cite:([A-Za-z0-9_-]+)\s*-->/g;
  const out: { id: string; position: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(bodyMarkdown)) !== null) {
    out.push({ id: m[1], position: m.index });
  }
  return out;
}

/**
 * Pure diff-stat — counts the change in word count between two bodies.
 *
 *   "Added N words; removed M words"
 *   "Added N words"           (when M is 0)
 *   "Removed M words"         (when N is 0)
 *   "No changes"              (when both 0 and bodies are identical)
 *
 * Character-level diff: this is intentionally simple — used as the
 * default changes_summary when the caller doesn't supply one. The
 * UI surfaces it as a hint, not a precise diff. The real diff lives
 * in the version history (full body snapshot per version).
 *
 * Word definition: any run of non-whitespace characters. Hyphenated
 * tokens count as one word. Whitespace-only changes register as zero.
 */
export function summariseChanges(beforeBody: string, afterBody: string): string {
  const before = typeof beforeBody === 'string' ? beforeBody : '';
  const after = typeof afterBody === 'string' ? afterBody : '';
  if (before === after) return 'No changes';
  const beforeWords = countWords(before);
  const afterWords = countWords(after);
  const delta = afterWords - beforeWords;
  if (delta === 0) {
    // Word count unchanged but bodies differ — could be reordering or
    // synonym swaps. Surface that the count is stable, not that nothing
    // happened (caller can tell that bodies differ from the rows being
    // distinct).
    return 'Edited (word count unchanged)';
  }
  if (delta > 0 && beforeWords === 0) {
    return `Added ${delta} word${delta === 1 ? '' : 's'}`;
  }
  if (delta > 0) {
    return `Added ${delta} word${delta === 1 ? '' : 's'}`;
  }
  // delta < 0
  const removed = -delta;
  return `Removed ${removed} word${removed === 1 ? '' : 's'}`;
}

function countWords(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface RawWritingSpaceRow {
  id: string;
  collective_id: string;
  title: string;
  template: string;
  body_markdown: string;
  status: WritingStatus;
  working_set_id: string | null;
  current_version: number;
  owner_profile_id: string;
  created_at: Date | string;
  updated_at: Date | string;
  published_at: Date | string | null;
}

interface RawVersionRow {
  id: string;
  writing_space_id: string;
  version_number: number;
  body_markdown: string;
  changes_summary: string | null;
  saved_by_profile_id: string;
  created_at: Date | string;
}

interface RawCitationRow {
  id: string;
  writing_space_id: string;
  artefact_space_uri: string;
  passage_id: string | null;
  position_in_draft: number;
  surrounding_hash: string;
  citation_format: CitationFormat | null;
  inserted_at: Date | string;
}

function toISO(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function rowToWritingSpace(r: RawWritingSpaceRow): WritingSpaceRow {
  return {
    id: r.id,
    collectiveId: r.collective_id,
    title: r.title,
    template: r.template,
    bodyMarkdown: r.body_markdown,
    status: r.status,
    workingSetId: r.working_set_id,
    currentVersion: r.current_version,
    ownerProfileId: r.owner_profile_id,
    createdAt: toISO(r.created_at)!,
    updatedAt: toISO(r.updated_at)!,
    publishedAt: toISO(r.published_at),
  };
}

function rowToVersion(r: RawVersionRow): VersionRow {
  return {
    id: r.id,
    writingSpaceId: r.writing_space_id,
    versionNumber: r.version_number,
    bodyMarkdown: r.body_markdown,
    changesSummary: r.changes_summary,
    savedByProfileId: r.saved_by_profile_id,
    createdAt: toISO(r.created_at)!,
  };
}

function rowToCitation(r: RawCitationRow): CitationRow {
  return {
    id: r.id,
    writingSpaceId: r.writing_space_id,
    artefactSpaceUri: r.artefact_space_uri,
    passageId: r.passage_id,
    positionInDraft: r.position_in_draft,
    surroundingHash: r.surrounding_hash,
    citationFormat: r.citation_format,
    insertedAt: toISO(r.inserted_at)!,
  };
}

const WRITING_SPACE_COLUMNS = `id, collective_id, title, template, body_markdown, status,
       working_set_id, current_version, owner_profile_id,
       created_at, updated_at, published_at`;

const VERSION_COLUMNS = `id, writing_space_id, version_number, body_markdown,
       changes_summary, saved_by_profile_id, created_at`;

const CITATION_COLUMNS = `id, writing_space_id, artefact_space_uri, passage_id,
       position_in_draft, surrounding_hash, citation_format, inserted_at`;

// ---------------------------------------------------------------------------
// DB helpers — Writing Space CRUD
// ---------------------------------------------------------------------------

export interface CreateWritingSpaceInput {
  ownerProfileId: string;
  title: string;
  template: string;
  workingSetId: string | null;
}

/**
 * Create a Writing Space at status='drafting', version 1, empty body.
 * collective_id defaults from the session var (active collective context).
 *
 * Citations are NOT auto-copied from the working set — the composer
 * inserts citations explicitly via POST /citations after the user picks
 * an artefact at a specific cursor position. The working_set_id link
 * stays on the row so the cite-picker can prefer artefacts in that set.
 */
export async function createWritingSpace(
  input: CreateWritingSpaceInput,
): Promise<WritingSpaceRow> {
  const res = await db.query<RawWritingSpaceRow>(
    `INSERT INTO writing_spaces (title, template, working_set_id, owner_profile_id)
     VALUES ($1, $2, $3, $4)
     RETURNING ${WRITING_SPACE_COLUMNS}`,
    [input.title, input.template, input.workingSetId, input.ownerProfileId],
  );
  return rowToWritingSpace(res.rows[0]);
}

export async function findWritingSpace(id: string): Promise<WritingSpaceRow | null> {
  const res = await db.query<RawWritingSpaceRow>(
    `SELECT ${WRITING_SPACE_COLUMNS} FROM writing_spaces WHERE id = $1 LIMIT 1`,
    [id],
  );
  return res.rows[0] ? rowToWritingSpace(res.rows[0]) : null;
}

export async function findWritingSpaceWithCitations(
  id: string,
): Promise<WritingSpaceWithCitations | null> {
  const row = await findWritingSpace(id);
  if (!row) return null;
  const citations = await listCitations(id);
  return { ...row, citations };
}

export async function listWritingSpaces(): Promise<WritingSpaceRow[]> {
  // RLS scopes to active collective. Newest first.
  const res = await db.query<RawWritingSpaceRow>(
    `SELECT ${WRITING_SPACE_COLUMNS} FROM writing_spaces
      ORDER BY updated_at DESC`,
  );
  return res.rows.map(rowToWritingSpace);
}

export async function deleteWritingSpace(id: string): Promise<boolean> {
  const res = await db.query(`DELETE FROM writing_spaces WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

export interface SaveVersionInput {
  writingSpaceId: string;
  bodyMarkdown: string;
  changesSummary: string | null;
  savedByProfileId: string;
}

/**
 * Save a new version of the draft. Transactional:
 *   1. Read the current row (need current_version + collective_id +
 *      previous body to derive a default changes_summary if absent).
 *   2. INSERT a writing_space_versions row at current_version + 1.
 *   3. UPDATE writing_spaces: bump current_version, replace body,
 *      touch updated_at.
 *
 * Returns the updated WritingSpaceRow. Throws if the Writing Space
 * doesn't exist (RLS-hidden or genuinely missing — same outcome).
 */
export async function saveWritingSpaceVersion(
  input: SaveVersionInput,
): Promise<WritingSpaceRow> {
  return db.transaction(async (client) => {
    const cur = await client.query<RawWritingSpaceRow>(
      `SELECT ${WRITING_SPACE_COLUMNS} FROM writing_spaces WHERE id = $1 LIMIT 1`,
      [input.writingSpaceId],
    );
    if (cur.rowCount === 0) {
      throw new Error(`writing_space_not_found: ${input.writingSpaceId}`);
    }
    const before = cur.rows[0];
    const nextVersion = before.current_version + 1;
    const summary =
      input.changesSummary !== null && input.changesSummary !== undefined
        ? input.changesSummary
        : summariseChanges(before.body_markdown, input.bodyMarkdown);

    await client.query(
      `INSERT INTO writing_space_versions
         (writing_space_id, collective_id, version_number, body_markdown,
          changes_summary, saved_by_profile_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.writingSpaceId,
        before.collective_id,
        nextVersion,
        input.bodyMarkdown,
        summary,
        input.savedByProfileId,
      ],
    );

    const upd = await client.query<RawWritingSpaceRow>(
      `UPDATE writing_spaces
          SET body_markdown = $1,
              current_version = $2,
              updated_at = NOW()
        WHERE id = $3
        RETURNING ${WRITING_SPACE_COLUMNS}`,
      [input.bodyMarkdown, nextVersion, input.writingSpaceId],
    );
    return rowToWritingSpace(upd.rows[0]);
  });
}

export async function listVersions(
  writingSpaceId: string,
  limit: number = 20,
): Promise<VersionRow[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const res = await db.query<RawVersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM writing_space_versions
      WHERE writing_space_id = $1
      ORDER BY version_number DESC
      LIMIT $2`,
    [writingSpaceId, safeLimit],
  );
  return res.rows.map(rowToVersion);
}

export async function findVersion(
  writingSpaceId: string,
  versionNumber: number,
): Promise<VersionRow | null> {
  const res = await db.query<RawVersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM writing_space_versions
      WHERE writing_space_id = $1 AND version_number = $2
      LIMIT 1`,
    [writingSpaceId, versionNumber],
  );
  return res.rows[0] ? rowToVersion(res.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/**
 * Transition a Writing Space's status. Reads the current status,
 * validates the transition, applies it. On `published`, additionally:
 *   - sets published_at = NOW
 *   - inserts an artefact_uses row for every citation (idempotent —
 *     the UNIQUE constraint on (artefact_space_uri, writing_space_id,
 *     citation_id) makes re-publish safe)
 *
 * Returns the updated row. Throws if the Writing Space is missing or
 * the transition is illegal — both surface as 4xx at the API layer.
 */
export async function transitionStatus(
  writingSpaceId: string,
  toStatus: WritingStatus,
): Promise<WritingSpaceRow> {
  return db.transaction(async (client) => {
    const cur = await client.query<RawWritingSpaceRow>(
      `SELECT ${WRITING_SPACE_COLUMNS} FROM writing_spaces WHERE id = $1 LIMIT 1`,
      [writingSpaceId],
    );
    if (cur.rowCount === 0) {
      throw new Error(`writing_space_not_found: ${writingSpaceId}`);
    }
    const fromStatus = cur.rows[0].status;
    const check = validateStatusTransition(fromStatus, toStatus);
    if (!check.ok) {
      // Carry the reason out so the API layer can surface it as 422.
      const err: Error & { code?: string; reason?: string } = new Error(
        `invalid_status_transition: ${check.reason}`,
      );
      err.code = 'INVALID_TRANSITION';
      err.reason = check.reason;
      throw err;
    }

    const isPublishing = toStatus === 'published';
    const publishedAtClause = isPublishing ? ', published_at = NOW()' : '';
    const upd = await client.query<RawWritingSpaceRow>(
      `UPDATE writing_spaces
          SET status = $1,
              updated_at = NOW()${publishedAtClause}
        WHERE id = $2
        RETURNING ${WRITING_SPACE_COLUMNS}`,
      [toStatus, writingSpaceId],
    );

    if (isPublishing) {
      // Materialise the compounding hook: one artefact_uses row per
      // citation. UNIQUE (artefact_space_uri, writing_space_id,
      // citation_id) makes ON CONFLICT DO NOTHING idempotent — a
      // re-publish doesn't double-write.
      const collectiveId = cur.rows[0].collective_id;
      await client.query(
        `INSERT INTO artefact_uses
           (collective_id, artefact_space_uri, writing_space_id, citation_id)
         SELECT collective_id, artefact_space_uri, writing_space_id, id
           FROM writing_space_citations
          WHERE writing_space_id = $1
         ON CONFLICT (artefact_space_uri, writing_space_id, citation_id)
         DO NOTHING`,
        [writingSpaceId],
      );
      // Suppress unused-var warning — kept for log/audit hooks later.
      void collectiveId;
    }

    return rowToWritingSpace(upd.rows[0]);
  });
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

export interface InsertCitationInput {
  writingSpaceId: string;
  artefactSpaceUri: string;
  passageId: string | null;
  positionInDraft: number;
  surroundingHash: string;
  citationFormat: CitationFormat | null;
}

export async function insertCitation(
  input: InsertCitationInput,
): Promise<CitationRow> {
  const res = await db.query<RawCitationRow>(
    `INSERT INTO writing_space_citations
       (writing_space_id, artefact_space_uri, passage_id,
        position_in_draft, surrounding_hash, citation_format)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${CITATION_COLUMNS}`,
    [
      input.writingSpaceId,
      input.artefactSpaceUri,
      input.passageId,
      input.positionInDraft,
      input.surroundingHash,
      input.citationFormat,
    ],
  );
  return rowToCitation(res.rows[0]);
}

export async function listCitations(writingSpaceId: string): Promise<CitationRow[]> {
  const res = await db.query<RawCitationRow>(
    `SELECT ${CITATION_COLUMNS} FROM writing_space_citations
      WHERE writing_space_id = $1
      ORDER BY position_in_draft ASC, inserted_at ASC`,
    [writingSpaceId],
  );
  return res.rows.map(rowToCitation);
}

export async function deleteCitation(
  writingSpaceId: string,
  citationId: string,
): Promise<boolean> {
  const res = await db.query(
    `DELETE FROM writing_space_citations
      WHERE writing_space_id = $1 AND id = $2`,
    [writingSpaceId, citationId],
  );
  return (res.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Cite-picker (W3 deterministic baseline; W4 swaps in an LLM ranker)
// ---------------------------------------------------------------------------

export interface CitePickerInput {
  writingSpaceId: string;
  cursorContext: string;
  limit: number;
}

/**
 * Given the text around the cursor, return up to `limit` artefacts
 * ranked by simple text-match relevance. Scoped to the active
 * collective by RLS. When the Writing Space has a working_set_id,
 * artefacts in that set are flagged with isInWorkingSet=true (the
 * UI orders these first, then the rest).
 *
 * Ranking: ILIKE against title / description / body_markdown. We
 * weight title > description > body via three separate match counts
 * combined into a score. Deterministic — same input always returns
 * the same ranking.
 *
 * W4 (next phase) replaces the body of this with an LLM rank step
 * that also produces per-candidate rationale. The endpoint shape
 * stays stable.
 */
export async function runCitePickerDeterministic(
  input: CitePickerInput,
): Promise<CitePickerCandidate[]> {
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit)));
  // Extract simple keywords from cursor context: split on whitespace,
  // strip punctuation, drop short tokens. Deterministic, no LLM, no
  // stopword list (overkill for a typeahead-grade query).
  const keywords = extractKeywords(input.cursorContext);
  if (keywords.length === 0) {
    // No usable keywords — fall back to recent artefacts in the active
    // collective. Still RLS-scoped.
    const res = await db.query<{
      uri: string;
      title: string;
      category: string;
      description: string;
      body_markdown: string;
      is_in_set: boolean;
    }>(
      `SELECT s.uri, s.title, s.category, s.description, s.body_markdown,
              EXISTS (
                SELECT 1 FROM working_set_items wsi
                  JOIN writing_spaces ws ON ws.working_set_id = wsi.working_set_id
                 WHERE ws.id = $1 AND wsi.artefact_space_uri = s.uri
              ) AS is_in_set
         FROM synthesis_pages s
        ORDER BY s.last_updated_at DESC
        LIMIT $2`,
      [input.writingSpaceId, limit],
    );
    return res.rows.map(r => ({
      uri: r.uri,
      title: r.title || 'Untitled',
      category: r.category,
      description: r.description || '',
      snippet: snippetFromBody(r.body_markdown, keywords, 160),
      isInWorkingSet: !!r.is_in_set,
    }));
  }

  // Build a parameterised ILIKE filter. Each keyword becomes its own
  // pattern; we OR them so any single match qualifies, then score by
  // weighted sum of per-field match counts.
  //
  // Score = 3 * (title match count)
  //       + 2 * (description match count)
  //       + 1 * (body match count)
  // Plus an isInWorkingSet boost when the artefact is in the draft's
  // working set (preferred for the user's curated picks).
  //
  // The expression is constructed in JS with positional params; no
  // string interpolation of user input into SQL.
  const patterns = keywords.map(k => `%${k}%`);
  // Param layout:
  //   $1 = writingSpaceId (for is_in_set lookup)
  //   $2..$(2+N-1) = keyword patterns
  //   $(2+N) = limit
  const paramBase = 2;
  const orClauses: string[] = [];
  const titleSums: string[] = [];
  const descSums: string[] = [];
  const bodySums: string[] = [];
  for (let i = 0; i < patterns.length; i++) {
    const p = `$${paramBase + i}`;
    orClauses.push(`s.title ILIKE ${p} OR s.description ILIKE ${p} OR s.body_markdown ILIKE ${p}`);
    titleSums.push(`(CASE WHEN s.title ILIKE ${p} THEN 1 ELSE 0 END)`);
    descSums.push(`(CASE WHEN s.description ILIKE ${p} THEN 1 ELSE 0 END)`);
    bodySums.push(`(CASE WHEN s.body_markdown ILIKE ${p} THEN 1 ELSE 0 END)`);
  }
  const limitParam = `$${paramBase + patterns.length}`;
  const params: any[] = [input.writingSpaceId, ...patterns, limit];

  const sql = `
    SELECT s.uri, s.title, s.category, s.description, s.body_markdown,
           EXISTS (
             SELECT 1 FROM working_set_items wsi
               JOIN writing_spaces ws ON ws.working_set_id = wsi.working_set_id
              WHERE ws.id = $1 AND wsi.artefact_space_uri = s.uri
           ) AS is_in_set,
           (3 * (${titleSums.join(' + ')})
            + 2 * (${descSums.join(' + ')})
            + 1 * (${bodySums.join(' + ')})) AS score
      FROM synthesis_pages s
     WHERE ${orClauses.join(' OR ')}
     ORDER BY is_in_set DESC, score DESC, s.last_updated_at DESC
     LIMIT ${limitParam}
  `;

  const res = await db.query<{
    uri: string;
    title: string;
    category: string;
    description: string;
    body_markdown: string;
    is_in_set: boolean;
    score: string;
  }>(sql, params);

  return res.rows.map(r => ({
    uri: r.uri,
    title: r.title || 'Untitled',
    category: r.category,
    description: r.description || '',
    snippet: snippetFromBody(r.body_markdown, keywords, 160),
    isInWorkingSet: !!r.is_in_set,
  }));
}

/**
 * Extract simple keyword tokens from cursor context. Pure helper for
 * the cite-picker. Drops tokens shorter than 3 chars and a tiny set of
 * extremely common stopwords (the / and / for / of). De-dupes while
 * preserving first-occurrence order. Cap at 8 tokens — the cite-picker
 * is a typeahead, not a search engine.
 */
function extractKeywords(cursorContext: string): string[] {
  if (typeof cursorContext !== 'string' || !cursorContext.trim()) return [];
  const STOPWORDS = new Set([
    'the', 'and', 'for', 'of', 'in', 'to', 'a', 'is', 'it', 'on',
    'with', 'as', 'by', 'an', 'at', 'be', 'this', 'that', 'or',
  ]);
  const tokens = cursorContext
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
      if (out.length >= 8) break;
    }
  }
  return out;
}

/**
 * Build a short snippet from the artefact body, ideally centred on the
 * first keyword match. Used to render under the title in the picker.
 */
function snippetFromBody(
  body: string | null | undefined,
  keywords: string[],
  maxChars: number,
): string {
  const b = (body ?? '').trim();
  if (!b) return '';
  if (keywords.length === 0) {
    return b.length > maxChars ? `${b.slice(0, maxChars - 1)}…` : b;
  }
  const lower = b.toLowerCase();
  let bestIdx = -1;
  for (const k of keywords) {
    const idx = lower.indexOf(k);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx === -1) {
    return b.length > maxChars ? `${b.slice(0, maxChars - 1)}…` : b;
  }
  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, bestIdx - half);
  const end = Math.min(b.length, start + maxChars);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < b.length ? '…' : '';
  return `${prefix}${b.slice(start, end).trim()}${suffix}`;
}
