/**
 * Story 2.1 — synthesis-first retrieval.
 *
 * The three tiers:
 *
 *   1. Direct addressing: if the query clearly names a known Space
 *      (slug, display name, or [[wikilink]]), load that Space's full
 *      body and skip any further search.
 *
 *   2. Catalogue-driven match: ask the LLM which Spaces from the
 *      visibility-filtered catalogue are relevant to the query. Load
 *      the full bodies of the matches.
 *
 *   3. Embedding fallback: only when nothing from tiers 1-2 was
 *      relevant, fall back to pgvector over context_entries for raw
 *      historical context. This path persists for things that never
 *      got compiled into a Space ("did anyone mention dinner plans
 *      last week?").
 *
 * Provenance is returned alongside the loaded content so the answer UI
 * can show which Spaces contributed.
 */

import { dispatch } from '../skills/router';
import { embedText, retrieveRelevantContext, type Visibility as RagVisibility } from '../intelligence/context';
import { getCatalogue, matchBySlug, renderCatalogueForPrompt, resolveWikilinks, type CatalogueEntry } from './catalogue';
import { findSpaceByUri } from './store';
import type { Space } from './model';
import { getOnboardingState } from '../onboarding/state';
import { db } from '../db/tenant';

export type RetrievalPath = 'direct' | 'catalogue' | 'embedding' | 'none';

/**
 * The user-and-LLM-facing summary of what retrieval found for a turn.
 *
 *   - 'sourced'  — at least one compiled Space matched (direct or catalogue path).
 *                  The reply is grounded in stored family understanding.
 *   - 'fallback' — no Space matched, but embeddings or onboarding-summary
 *                  fallback gave something. The reply is grounded but loosely.
 *   - 'empty'    — nothing retrieved at all. The reply is unsourced.
 *
 * Single source of truth — derived from RetrievalResult and consumed by:
 *   (a) the prompt builder (renders an explicit EMPTY marker for the LLM)
 *   (b) the chat API response shape (so the UI can show an "unsourced" badge)
 *   (c) the privacy ledger (so audit can filter by sourced/unsourced turns)
 */
export type RetrievalState = 'sourced' | 'fallback' | 'empty';

export interface Provenance {
  path: RetrievalPath;
  spaceUris: string[];
  embeddingHits: number;
}

export interface RetrievalResult {
  spaces: Space[];
  embeddingContexts: string[];
  fallbackSpaces?: Space[];
  fallbackOnboardingText?: string;
  provenance: Provenance;
}

export function deriveRetrievalState(result: Pick<RetrievalResult, 'spaces' | 'embeddingContexts' | 'fallbackSpaces' | 'fallbackOnboardingText'>): RetrievalState {
  if (result.spaces.length > 0) return 'sourced';
  if (
    (result.fallbackSpaces && result.fallbackSpaces.length > 0) ||
    !!result.fallbackOnboardingText ||
    result.embeddingContexts.length > 0
  ) {
    return 'fallback';
  }
  return 'empty';
}

export interface RetrieveInput {
  familyId: string;
  viewerProfileId: string;
  query: string;
  embeddingVisibility?: RagVisibility;
  maxEmbeddings?: number;
  /**
   * Phase 4 of Build Spec 1 — optional project filter. When omitted,
   * retrieval sees every Space in the collective (project-tagged AND
   * collective-level). When set, retrieval narrows to that project's
   * Spaces only. The retrieval tiers themselves are unchanged —
   * project filtering is one extra predicate applied at catalogue
   * load time and inherited by every downstream tier.
   */
  projectId?: string | null;
}

export async function retrieveForQuery(input: RetrieveInput): Promise<RetrievalResult> {
  const catalogue = await getCatalogue(input.familyId, input.viewerProfileId, input.projectId);

  const directHits = uniqueByUri([
    ...resolveWikilinks(catalogue, input.query),
    ...matchBySlug(catalogue, input.query),
  ]);

  if (directHits.length > 0) {
    const spaces = await loadFullSpaces(directHits);
    return {
      spaces,
      embeddingContexts: [],
      provenance: { path: 'direct', spaceUris: spaces.map(s => s.uri), embeddingHits: 0 },
    };
  }

  const catalogueMatches = await askCatalogueMatcher(input, catalogue);
  if (catalogueMatches.length > 0) {
    const spaces = await loadFullSpaces(catalogueMatches);
    return {
      spaces,
      embeddingContexts: [],
      provenance: { path: 'catalogue', spaceUris: spaces.map(s => s.uri), embeddingHits: 0 },
    };
  }

  const ragHits = await retrieveRelevantContext(
    input.query,
    input.maxEmbeddings ?? 3,
    input.viewerProfileId,
    input.embeddingVisibility ?? 'family',
  );

  let fallbackSpaces: Space[] = [];
  let fallbackOnboardingText: string | undefined;

  try {
    const onboarding = await getOnboardingState(input.viewerProfileId);
    const onboardingText = Object.entries(onboarding.answers)
      .filter(([_, ans]) => typeof ans === 'string' && ans.trim().length > 0)
      .map(([step, ans]) => `${step.toUpperCase()}: ${ans}`)
      .join('\n');
    
    if (onboardingText) {
      fallbackOnboardingText = onboardingText;
    }

    const fallbackEntries = catalogue
      .filter(e => e.category === 'person' || e.category === 'routine')
      .slice(0, 2);

    if (fallbackEntries.length > 0) {
      fallbackSpaces = await loadFullSpaces(fallbackEntries);
    }
  } catch (err) {
    console.error('[SPACES] Failed to load fallback context:', err);
  }

  return {
    spaces: [],
    embeddingContexts: ragHits,
    fallbackSpaces,
    fallbackOnboardingText,
    provenance: {
      path: ragHits.length > 0 ? 'embedding' : 'none',
      spaceUris: [],
      embeddingHits: ragHits.length,
    },
  };
}

function uniqueByUri(entries: CatalogueEntry[]): CatalogueEntry[] {
  const seen = new Set<string>();
  const out: CatalogueEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.uri)) continue;
    seen.add(e.uri);
    out.push(e);
  }
  return out;
}

async function loadFullSpaces(entries: CatalogueEntry[]): Promise<Space[]> {
  const loaded: Space[] = [];
  for (const entry of entries) {
    const space = await findSpaceByUri(entry.uri);
    if (space) loaded.push(space);
  }
  return loaded;
}

interface MatcherReturn {
  uris: string[];
}

/**
 * Ask the LLM which catalogue entries are relevant to the query. The
 * LLM is asked to return a JSON array of URIs — no prose. The catalogue
 * is already visibility-filtered, so any URI the LLM returns is safe
 * to load for this viewer.
 */
/**
 * Phase 1 of Build Spec 1 — vector-shortlist the catalogue against the
 * query embedding before handing to the LLM matcher. Returns up to
 * `topK` catalogue entries ranked by cosine similarity to the query.
 *
 * Behaviour:
 *  - If catalogue.length ≤ topK, returns catalogue unchanged (no point
 *    shortlisting; the matcher already sees everything).
 *  - Otherwise, queries synthesis_pages for the top-K URIs by cosine
 *    distance, filtered to the visible catalogue's URIs (RLS scope +
 *    catalogue's pre-applied visibility check make this safe).
 *  - Spaces whose `embedding` is NULL (mid-backfill, or freshly-written
 *    before a future indexer fires) fall through and are appended to
 *    fill the topK so recall isn't punished during the migration.
 *
 * MUST run inside an active collective context — db.query is
 * RLS-scoped via the request pipeline.
 */
async function shortlistByEmbedding(
  catalogue: CatalogueEntry[],
  query: string,
  topK = 20,
): Promise<CatalogueEntry[]> {
  if (catalogue.length <= topK) return catalogue;
  const queryVec = await embedText(query);
  const queryStr = `[${queryVec.join(',')}]`;
  const uris = catalogue.map(e => e.uri);
  const rows = await db.query<{ uri: string }>(
    `SELECT uri
       FROM synthesis_pages
      WHERE uri = ANY($1)
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $2::vector
      LIMIT $3`,
    [uris, queryStr, topK],
  );
  const ranked = new Set(rows.rows.map(r => r.uri));
  // Stable order: keep catalogue's order but only the shortlisted URIs.
  // Anything embedding-NULL falls through and is appended afterwards
  // so the matcher still sees them (recall safety net during backfill).
  const inShortlist = catalogue.filter(e => ranked.has(e.uri));
  if (inShortlist.length >= topK) return inShortlist;
  const notRanked = catalogue.filter(e => !ranked.has(e.uri));
  return [...inShortlist, ...notRanked.slice(0, topK - inShortlist.length)];
}

async function askCatalogueMatcher(
  input: RetrieveInput,
  catalogue: CatalogueEntry[],
): Promise<CatalogueEntry[]> {
  if (catalogue.length === 0) return [];

  // Phase 1: vector-shortlist before the LLM. Cuts prompt size + improves
  // recall by surfacing semantically-relevant Spaces even when their
  // name/description doesn't keyword-match the query.
  const shortlisted = await shortlistByEmbedding(catalogue, input.query);

  const cataloguePrompt = renderCatalogueForPrompt(shortlisted);
  const uriLookup = new Map(shortlisted.map(e => [e.uri, e]));

  const userMessage = [
    'You are the Memu retrieval matcher. Given the user query and the catalogue of',
    'available compiled Spaces, return the URIs of Spaces whose compiled body is likely',
    'to answer or inform this query. Return ONLY a JSON object of the shape',
    '{"uris": ["memu://...", ...]}. Return {"uris": []} if no Space is relevant.',
    '',
    'USER QUERY:',
    input.query,
    '',
    'CATALOGUE:',
    cataloguePrompt,
    '',
    'Return JSON only. No preamble.',
  ].join('\n');

  try {
    const { text } = await dispatch({
      skill: 'interactive_query',
      templateVars: { context_block: '' },
      userMessage,
      profileId: input.viewerProfileId,
      familyId: input.familyId,
      useBYOK: true,
    });
    const parsed = parseMatcherResponse(text);
    return parsed.uris
      .map(uri => uriLookup.get(uri))
      .filter((e): e is CatalogueEntry => !!e);
  } catch (err) {
    console.warn('[SPACES] catalogue matcher failed, falling through to embeddings:', (err as Error).message);
    return [];
  }
}

export function parseMatcherResponse(text: string): MatcherReturn {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.uris)) {
      return { uris: parsed.uris.filter((u: unknown) => typeof u === 'string') };
    }
  } catch {
    // fall through
  }
  return { uris: [] };
}

export function renderSpacesForPrompt(spaces: Space[]): string {
  if (spaces.length === 0) return '';
  const blocks = spaces.map(s => [
    `=== SPACE: ${s.name} (${s.category}) ===`,
    `uri: ${s.uri}`,
    `description: ${s.description}`,
    `confidence: ${s.confidence}`,
    `last_updated: ${s.lastUpdated.toISOString()}`,
    '',
    s.bodyMarkdown.trim(),
    '=== END SPACE ===',
  ].join('\n'));
  return blocks.join('\n\n');
}

export function renderEmbeddingsForPrompt(contexts: string[]): string {
  if (contexts.length === 0) return '';
  return contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n');
}

/**
 * Build the final context block that the orchestrator passes to the
 * interactive_query skill. Prefer compiled Spaces; only show raw
 * embedding hits when we had nothing else.
 *
 * **Critical: never returns an empty string.** When retrieval produced
 * nothing, this emits an explicit `=== RETRIEVAL: EMPTY ===` block so
 * the model has a *structural* signal that it has no family context for
 * this turn — not a silent gap that Rule 11 has to notice in the
 * prompt's whitespace.
 *
 * This is the LLM-facing half of BUG-15 (confabulation from emptiness).
 * The UI-facing half (an "Unsourced" badge below the bubble) reads the
 * same state via `deriveRetrievalState` so the two surfaces can never
 * disagree about whether a turn was sourced.
 */
export function buildContextBlock(result: RetrievalResult): string {
  if (result.spaces.length > 0) {
    return [
      '=== COMPILED FAMILY UNDERSTANDING (Spaces) ===',
      renderSpacesForPrompt(result.spaces),
      '==============================================',
    ].join('\n');
  }

  const parts: string[] = [];
  const hasFallback = (result.fallbackSpaces && result.fallbackSpaces.length > 0) || !!result.fallbackOnboardingText;

  if (hasFallback) {
    const fallbackParts: string[] = [];
    if (result.fallbackOnboardingText) {
      fallbackParts.push(`Onboarding Summary:\n${result.fallbackOnboardingText}`);
    }
    if (result.fallbackSpaces && result.fallbackSpaces.length > 0) {
      fallbackParts.push(renderSpacesForPrompt(result.fallbackSpaces));
    }
    parts.push(
      '=== HOUSEHOLD SUMMARY (Fallback Context) ===',
      fallbackParts.join('\n\n'),
      '============================================'
    );
  }

  if (result.embeddingContexts.length > 0) {
    parts.push(
      '=== RELEVANT FAMILY CONTEXT (raw recall) ===',
      renderEmbeddingsForPrompt(result.embeddingContexts),
      '=========================================='
    );
  }

  if (parts.length === 0) {
    return [
      '=== RETRIEVAL: EMPTY ===',
      'No compiled Spaces, no recalled facts, no household summary apply to this query.',
      'Per Rule 11 of your prompt: if the user is asking about personal facts, family',
      'members, past events, or their own context, do NOT answer from training — say',
      "\"I don't have notes on that yet\" or similar. General knowledge, reasoning,",
      'coding, and creative questions are still fine to answer normally.',
      '=========================',
    ].join('\n');
  }

  return parts.join('\n\n');
}
