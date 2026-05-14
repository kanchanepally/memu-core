/**
 * Phase 6 of Build Spec 1 — wikilink extraction + persistence helpers.
 *
 * Lifts the existing `extractWikilinkTargets` regex out of
 * `src/api/spaces_graph.ts` (where it was originally written for the
 * per-request in-memory derivation) into a shared module that both
 * the graph view and the upsertSpace write hook can use. DRY per the
 * spec rule: "there is an existing extraction routine for this — read
 * it, reuse it. Do not introduce a parallel one."
 *
 * `persistWikilinkEdges` is the new piece — called from upsertSpace
 * inside the same transaction as the Space write — that resolves
 * extracted targets to Space URIs within the active collective (RLS
 * scopes the resolution), canonical-orders the pair, and upserts
 * space_connections rows with source_mechanism='wikilink'.
 */

import type { PoolClient } from 'pg';

/**
 * Matches `[[target]]` and `[[target|display]]` anywhere in a Space body.
 *
 * Conservative: refuses newlines inside the link (a `[[` that runs to
 * end-of-paragraph is probably a typo, not a link), refuses empty
 * targets, lower-cases the result so resolution is case-insensitive.
 */
const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;

export function extractWikilinkTargets(body: string): string[] {
  if (!body) return [];
  const targets = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) {
    const raw = m[1].trim();
    if (!raw) continue;
    const pipeIdx = raw.indexOf('|');
    const target = pipeIdx >= 0 ? raw.slice(0, pipeIdx).trim() : raw;
    if (target) targets.add(target.toLowerCase());
  }
  return [...targets];
}

/**
 * Phase 6 — populate space_connections from the wikilinks in a Space's
 * body. Called inside upsertSpace's transaction after the synthesis_pages
 * write, so the source Space is guaranteed to exist before its outbound
 * edges land.
 *
 * Resolution: each lower-cased target string is matched against existing
 * Spaces by lower(slug) OR lower(title). RLS automatically scopes to
 * the active collective, so cross-collective wikilinks resolve to
 * nothing (they're silently dropped — same behaviour as the per-request
 * derivation that preceded this hook).
 *
 * Self-edges are filtered out — `[[my-own-slug]]` produces no row (the
 * canonical-ordering CHECK in 042 would reject it anyway, this filter
 * is defence in depth).
 *
 * ON CONFLICT refreshes last_seen_at so stale edges age via cron rather
 * than accumulating.
 */
export async function persistWikilinkEdges(
  client: PoolClient,
  selfUri: string,
  body: string,
): Promise<{ persisted: number; resolved: number; extracted: number }> {
  const targets = extractWikilinkTargets(body);
  if (targets.length === 0) {
    return { persisted: 0, resolved: 0, extracted: 0 };
  }

  // Resolve target strings to URIs within the active collective. RLS
  // scopes the SELECT — a target that names a Space in a different
  // collective resolves to nothing.
  const lookup = await client.query<{ uri: string; slug: string; title: string }>(
    `SELECT uri, slug, title
       FROM synthesis_pages
      WHERE LOWER(slug) = ANY($1) OR LOWER(title) = ANY($1)`,
    [targets],
  );

  const resolvedUris = new Set<string>();
  for (const row of lookup.rows) {
    if (row.uri !== selfUri) resolvedUris.add(row.uri);
  }

  let persisted = 0;
  for (const otherUri of resolvedUris) {
    const [a, b] = selfUri < otherUri ? [selfUri, otherUri] : [otherUri, selfUri];
    // Canonical ordering enforced by the CHECK in 042; we honour it
    // explicitly here so the UNIQUE collapses (A→B) and (B→A).
    await client.query(
      `INSERT INTO space_connections (space_uri_a, space_uri_b, source_mechanism, confidence)
       VALUES ($1, $2, 'wikilink', 1.00)
       ON CONFLICT (collective_id, space_uri_a, space_uri_b, source_mechanism)
       DO UPDATE SET last_seen_at = NOW()`,
      [a, b],
    );
    persisted += 1;
  }

  return {
    persisted,
    resolved: resolvedUris.size,
    extracted: targets.length,
  };
}
