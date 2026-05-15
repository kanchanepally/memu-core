/**
 * Build Spec 2 Phase R4 Story R4.1 — deterministic service:
 * near-duplicate Space detection.
 *
 * Cosine similarity over Space embeddings within the active workspace.
 * Pure code (no LLM), pure SQL via pgvector's <=> operator. Used by:
 *   - R5.2's theme-former agent (avoid creating near-duplicate theme
 *     names — propose merging into an existing theme instead)
 *   - A future "Spaces that resemble this one" surface on the Space
 *     detail view, gated by Z.7's inbound-connections panel
 *   - R7.2's cross-workspace re-emergence (extend across workspaces
 *     once the workspace-private invariant is preserved)
 *
 * Pgvector `<=>` returns the cosine *distance* (0 = identical, 2 =
 * opposite). Similarity = 1 - distance, in [-1, 1]; for embeddings
 * from Xenova's all-MiniLM-L6-v2 (normalised, all-positive vectors)
 * similarity in practice stays in [0, 1]. We threshold on similarity,
 * not distance, because the caller's intent is "find similar things"
 * not "find close things in vector space" — semantically the same
 * but easier to read in calling code.
 *
 * Workspace scoping happens automatically — `db.query` enters the
 * active collective_id session var, RLS filters synthesis_pages to
 * just this workspace's Spaces. The query CANNOT reach across
 * workspaces; the invariant from Build Spec 1 §2.3 holds.
 */

import { db } from '../../db/tenant';

export interface NearDuplicate {
  spaceId: string;
  uri: string;
  title: string;
  category: string;
  /** Cosine similarity in [0, 1]. 1.0 = identical content / title. */
  similarity: number;
}

export interface NearDuplicateOptions {
  /** Top-N candidates to return. Default 5. Capped at 50. */
  limit?: number;
  /** Minimum similarity to include in the result. Default 0.75. Below
   *  this we're effectively returning random neighbours, not duplicates.
   *  Set lower for "Spaces that resemble this one" surfaces; higher
   *  (0.90+) for "is this a true duplicate of an existing Space?" checks. */
  minSimilarity?: number;
}

/**
 * Find Spaces in the active workspace whose embedding is most similar
 * to the target Space's embedding. Excludes the target itself.
 *
 * Returns [] when:
 *   - the target Space doesn't exist OR is outside the active workspace
 *   - the target has no embedding (very old Spaces pre-Build-Spec-1)
 *   - no other Space crosses the similarity threshold
 */
export async function detectNearDuplicateSpaces(
  candidateSpaceId: string,
  options: NearDuplicateOptions = {},
): Promise<NearDuplicate[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 5, 50));
  const minSimilarity = options.minSimilarity ?? 0.75;
  // Pgvector cosine: distance = 1 - similarity (for normalised vectors).
  // Threshold-on-similarity → threshold-on-(1 - distance).
  const maxDistance = 1 - minSimilarity;

  // Single query: pull the target's embedding inline (subquery), then
  // rank every OTHER Space in the active workspace by distance. RLS
  // scopes both the inner SELECT and the outer to this collective.
  const res = await db.query<{
    id: string;
    uri: string;
    title: string;
    category: string;
    distance: number;
  }>(
    `
    WITH target AS (
      SELECT embedding
        FROM synthesis_pages
        WHERE id = $1
        LIMIT 1
    )
    SELECT
      sp.id,
      sp.uri,
      sp.title,
      sp.category,
      (sp.embedding <=> t.embedding) AS distance
    FROM synthesis_pages sp
    CROSS JOIN target t
    WHERE sp.id != $1
      AND sp.embedding IS NOT NULL
      AND t.embedding IS NOT NULL
      AND (sp.embedding <=> t.embedding) <= $2
    ORDER BY distance ASC
    LIMIT $3
    `,
    [candidateSpaceId, maxDistance, limit],
  );

  return res.rows.map(r => ({
    spaceId: r.id,
    uri: r.uri,
    title: r.title,
    category: r.category,
    similarity: 1 - Number(r.distance),
  }));
}
