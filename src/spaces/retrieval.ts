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
import { retrieveRelevantContext, type Visibility as RagVisibility } from '../intelligence/context';
import { getCatalogue, matchBySlug, renderCatalogueForPrompt, resolveWikilinks, type CatalogueEntry } from './catalogue';
import { findSpaceByUri } from './store';
import type { Space } from './model';

export type RetrievalPath = 'direct' | 'catalogue' | 'embedding' | 'none';

export interface Provenance {
  path: RetrievalPath;
  spaceUris: string[];
  embeddingHits: number;
}

export interface RetrievalResult {
  spaces: Space[];
  embeddingContexts: string[];
  provenance: Provenance;
}

export interface RetrieveInput {
  familyId: string;
  viewerProfileId: string;
  query: string;
  embeddingVisibility?: RagVisibility;
  maxEmbeddings?: number;
}

export async function retrieveForQuery(input: RetrieveInput): Promise<RetrievalResult> {
  const catalogue = await getCatalogue(input.familyId, input.viewerProfileId);

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
  return {
    spaces: [],
    embeddingContexts: ragHits,
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
async function askCatalogueMatcher(
  input: RetrieveInput,
  catalogue: CatalogueEntry[],
): Promise<CatalogueEntry[]> {
  if (catalogue.length === 0) return [];

  const cataloguePrompt = renderCatalogueForPrompt(catalogue);
  const uriLookup = new Map(catalogue.map(e => [e.uri, e]));

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
 */
export function buildContextBlock(result: RetrievalResult): string {
  if (result.spaces.length > 0) {
    return [
      '=== COMPILED FAMILY UNDERSTANDING (Spaces) ===',
      renderSpacesForPrompt(result.spaces),
      '==============================================',
    ].join('\n');
  }
  if (result.embeddingContexts.length > 0) {
    return [
      '=== RELEVANT FAMILY CONTEXT (raw recall) ===',
      renderEmbeddingsForPrompt(result.embeddingContexts),
      '==========================================',
    ].join('\n');
  }
  return '';
}
