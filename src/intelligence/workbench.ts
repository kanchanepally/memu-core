/**
 * BS3 Phase W1 — Workbench intelligence.
 *
 * The Workbench is the queryable surface across a researcher
 * workspace's captured artefacts (Memos, Quotes, Codes, Questions,
 * Connections — Spaces by another name). Today it ships one agent:
 *
 *   corpusQuery — hybrid (semantic embedding → LLM rank). Answers
 *                 natural-language recall queries like *"where did I
 *                 write about graded inequality?"*.
 *
 * Hybrid is the load-bearing pattern (BS3 §3.4):
 *
 *   1. Deterministic step (pure code): catalogue visibility filter
 *      → pgvector cosine similarity → top N candidates.
 *   2. LLM step: re-rank the candidates with per-result rationale.
 *
 * The deterministic step is the truth gate. The skill literally
 * cannot return an artefact that wasn't in the candidate set — we
 * validate every returned index in `parseCorpusQueryResponse` and
 * drop fabricated ones. This is what makes hallucinated citations
 * architecturally impossible on this surface.
 */

import { db } from '../db/tenant';
import { dispatch } from '../skills/router';
import { embedText } from './context';
import { getCatalogue, type CatalogueEntry } from '../spaces/catalogue';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import type { SpaceCategory } from '../spaces/model';

export interface WorkbenchQueryInput {
  familyId: string;
  viewerProfileId: string;
  query: string;
  /** Max candidates passed to the LLM. Default 30. Caps cost per query. */
  candidateLimit?: number;
  /** Max ranked results returned. Default 10 — the skill caps too. */
  resultLimit?: number;
}

/**
 * One candidate sent into the LLM rank step. Title/description/body
 * are ALREADY anonymised before this struct is built — they ship
 * straight into the prompt.
 */
interface AnonymisedCandidate {
  uri: string;
  category: SpaceCategory;
  title: string;
  description: string;
  bodyExcerpt: string;
}

export interface WorkbenchQueryResult {
  uri: string;
  category: SpaceCategory;
  title: string;
  description: string;
  bodyExcerpt: string;
  score: number;
  why: string;
  /** The deterministic embedding-distance rank (0 = closest). Surfaces in UI so the user can see when the LLM disagreed with the search. */
  semanticRank: number;
}

export interface WorkbenchQueryResponse {
  results: WorkbenchQueryResult[];
  confidence: number;
  notes: string;
  candidateCount: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Pure helpers — testable without DB or LLM
// ---------------------------------------------------------------------------

const BODY_EXCERPT_CHARS = 240;

export function truncateBodyExcerpt(body: string, max: number = BODY_EXCERPT_CHARS): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Render the `{{candidates}}` template variable. Zero-indexed so the
 * skill's instructions about index validity match what we send.
 */
export function renderCandidates(candidates: AnonymisedCandidate[]): string {
  if (candidates.length === 0) {
    return '(no candidates — the workspace has no Spaces with embeddings yet)';
  }
  return candidates
    .map((c, i) => {
      const head = `[${i}] (${c.category}) ${c.title}`;
      const desc = c.description ? `    ${c.description}` : '';
      const body = c.bodyExcerpt ? `    Body: ${c.bodyExcerpt}` : '';
      return [head, desc, body].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

interface ParsedRankItem {
  index: number;
  score: number;
  why: string;
}

interface ParsedCorpusQueryResponse {
  ranked: ParsedRankItem[];
  confidence: number;
  notes: string;
}

/**
 * Parse the skill's JSON output and validate every index against the
 * candidate-set size. Drops fabricated indices silently — they cannot
 * become results. This is the architectural anti-hallucination gate.
 *
 * Tolerates: prose around the JSON object (some models prepend), an
 * empty `ranked` array, missing optional fields. Throws only on
 * fundamentally malformed output (not parseable as JSON at all).
 */
export function parseCorpusQueryResponse(
  rawText: string,
  candidateCount: number,
): ParsedCorpusQueryResponse {
  if (candidateCount < 0) {
    throw new Error('parseCorpusQueryResponse: candidateCount must be non-negative');
  }

  // Find the JSON object. Skills are instructed to return exactly one
  // object, no fence, no prose — but some models drift; we extract.
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) {
    // No JSON at all — treat as empty rather than throwing, so a flaky
    // dispatch surfaces as "nothing found" rather than crashing the
    // user's query.
    return { ranked: [], confidence: 0, notes: 'no parseable response from rank step' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { ranked: [], confidence: 0, notes: 'malformed JSON from rank step' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ranked: [], confidence: 0, notes: 'rank step returned non-object' };
  }
  const obj = parsed as Record<string, unknown>;

  const rawRanked = Array.isArray(obj.ranked) ? obj.ranked : [];
  const ranked: ParsedRankItem[] = [];
  for (const r of rawRanked) {
    if (!r || typeof r !== 'object') continue;
    const item = r as Record<string, unknown>;
    const idxRaw = item.index;
    const idx = typeof idxRaw === 'number' ? Math.floor(idxRaw) : Number.NaN;
    // Truth gate — drop fabricated indices.
    if (!Number.isFinite(idx) || idx < 0 || idx >= candidateCount) continue;
    const score = clampUnit(typeof item.score === 'number' ? item.score : 0);
    const why = typeof item.why === 'string' ? item.why.trim() : '';
    if (!why) continue; // useless without rationale
    ranked.push({ index: idx, score, why });
  }
  // Dedup by index — keep first occurrence (highest semantic rank typically).
  const seen = new Set<number>();
  const deduped = ranked.filter(r => {
    if (seen.has(r.index)) return false;
    seen.add(r.index);
    return true;
  });

  const confidence = clampUnit(typeof obj.confidence === 'number' ? obj.confidence : 0);
  const notes = typeof obj.notes === 'string' ? obj.notes.trim() : '';

  return { ranked: deduped, confidence, notes };
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ---------------------------------------------------------------------------
// DB-touching pieces
// ---------------------------------------------------------------------------

interface EmbeddingRow {
  uri: string;
  title: string;
  description: string;
  category: SpaceCategory;
  body_markdown: string;
  distance: number;
}

/**
 * Run pgvector similarity against synthesis_pages.embedding, scoped to
 * the visible candidate URIs from the catalogue. Returns top N rows
 * ordered by distance ascending (nearest first).
 *
 * We pass the visibility-allowed URI set explicitly rather than
 * leaving it to RLS, because:
 *
 *   - RLS scopes to the active collective (membership-based) but
 *     does NOT enforce per-viewer visibility (private vs family etc).
 *   - getCatalogue already runs that visibility filter per viewer.
 *   - Passing the allowed URIs explicitly belt-and-braces.
 */
async function selectTopByEmbedding(
  visibleUris: string[],
  queryEmbedding: number[],
  limit: number,
): Promise<EmbeddingRow[]> {
  if (visibleUris.length === 0) return [];
  const vecStr = `[${queryEmbedding.join(',')}]`;
  const res = await db.query<EmbeddingRow>(
    `SELECT uri, title, description, category, body_markdown,
            (embedding <=> $1::vector) AS distance
       FROM synthesis_pages
      WHERE embedding IS NOT NULL
        AND uri = ANY($2::text[])
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [vecStr, visibleUris, limit],
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

export async function corpusQuery(input: WorkbenchQueryInput): Promise<WorkbenchQueryResponse> {
  const startedAt = Date.now();
  const candidateLimit = input.candidateLimit ?? 30;
  const resultLimit = input.resultLimit ?? 10;

  // 1. Catalogue (visibility-filtered for this viewer).
  const catalogue: CatalogueEntry[] = await getCatalogue(
    input.familyId,
    input.viewerProfileId,
  );
  const visibleUris = catalogue.map(c => c.uri);

  // 2. Embed the query (anonymisation deferred to step 3 for the
  //    user-facing query text passed into the prompt — the embedding
  //    itself is a local model that never leaves the box).
  const queryEmbedding = await embedText(input.query);

  // 3. pgvector rank against the visible candidate set.
  const topRows = await selectTopByEmbedding(
    visibleUris,
    queryEmbedding,
    candidateLimit,
  );

  // 4. Anonymise the candidates' title / description / body excerpt
  //    BEFORE rendering into the prompt. The Twin guard in the router
  //    is belt-and-braces; explicit anonymisation here is the rule.
  const anonymisedQuery = await translateToAnonymous(input.query);
  const anonymisedCandidates: AnonymisedCandidate[] = await Promise.all(
    topRows.map(async row => ({
      uri: row.uri,
      category: row.category,
      title: await translateToAnonymous(row.title),
      description: await translateToAnonymous(row.description ?? ''),
      bodyExcerpt: truncateBodyExcerpt(
        await translateToAnonymous(row.body_markdown ?? ''),
      ),
    })),
  );

  // 5. Empty candidate set — short-circuit. No point burning an LLM
  //    call to be told "no candidates".
  if (anonymisedCandidates.length === 0) {
    return {
      results: [],
      confidence: 0,
      notes:
        catalogue.length === 0
          ? 'workspace has no captured Spaces yet — start by importing a source or writing a memo'
          : 'no Spaces have embeddings yet — run the backfillEmbeddings script',
      candidateCount: 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  // 6. Dispatch the rank skill. Twin guard runs again inside the
  //    router as belt-and-braces.
  const result = await dispatch({
    skill: 'corpus_query',
    templateVars: {
      candidates: renderCandidates(anonymisedCandidates),
      query: anonymisedQuery,
    },
    familyId: input.familyId,
    profileId: input.viewerProfileId,
    maxTokens: 1500,
    temperature: 0.1,
  });

  // 7. Parse + truth-gate the response.
  const parsed = parseCorpusQueryResponse(result.text, anonymisedCandidates.length);

  // 8. Map indices back to real artefacts, reverse-translate the
  //    rationale + title + description so the user sees real names,
  //    cap at resultLimit.
  const results: WorkbenchQueryResult[] = [];
  for (const r of parsed.ranked.slice(0, resultLimit)) {
    const candidate = anonymisedCandidates[r.index];
    const row = topRows[r.index];
    if (!candidate || !row) continue; // shouldn't happen — indices validated
    results.push({
      uri: candidate.uri,
      category: candidate.category,
      // Use the original (non-anonymised) values from the DB rows for
      // display — preserves casing and any names the Twin shouldn't
      // have replaced.
      title: row.title,
      description: row.description ?? '',
      bodyExcerpt: truncateBodyExcerpt(row.body_markdown ?? ''),
      score: r.score,
      why: await translateToReal(r.why),
      semanticRank: r.index,
    });
  }

  return {
    results,
    confidence: parsed.confidence,
    notes: parsed.notes,
    candidateCount: anonymisedCandidates.length,
    latencyMs: Date.now() - startedAt,
  };
}
