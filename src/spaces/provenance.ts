/**
 * Story 2.1 — record which retrieval path answered a query. Feeds the
 * "recent queries that used each Space" surface in the Spaces tab and
 * makes it easy to debug why the LLM gave a particular answer.
 *
 * We piggyback on spaces_log rather than minting another table — the
 * event type `query_served` is not a Space-state change but shares the
 * same shape (family, Space URI, summary, actor).
 */

import { pool } from '../db/connection';
import type { Provenance } from './retrieval';

export async function recordRetrievalProvenance(
  familyId: string,
  messageId: string,
  provenance: Provenance,
): Promise<void> {
  if (provenance.path === 'none') return;
  const uris = provenance.spaceUris.length > 0 ? provenance.spaceUris : ['(embedding-only)'];
  for (const uri of uris) {
    await pool.query(
      `INSERT INTO spaces_log (family_id, space_uri, event, summary, actor_profile_id)
       VALUES ($1, $2, 'query_served', $3, $4)`,
      [
        familyId,
        uri,
        `query-served via ${provenance.path} (msg ${messageId}, embeddings=${provenance.embeddingHits})`,
        familyId,
      ],
    ).catch(err => {
      console.warn('[SPACES] provenance insert skipped:', (err as Error).message);
    });
  }
}
