/**
 * Phase 6 of Build Spec 1 — wikilink backfill for existing Spaces.
 *
 * The upsertSpace hook (Phase 6 Task 2) populates space_connections
 * going forward: every Space write extracts and persists its wikilink
 * edges. But existing Spaces on a populated deployment (Z2: 16 Spaces
 * as of 2026-05-15) carry wikilinks in their bodies that have never
 * been extracted to the new table. Without this backfill, the graph
 * view's wikilink edges disappear until each existing Space is
 * rewritten — a real product regression vs the pre-Phase-6 per-request
 * derivation.
 *
 * Invoked via `npm run spaces:backfill-wikilinks`. Safe to run while
 * the API container is up. Idempotent — ON CONFLICT inside
 * persistWikilinkEdges refreshes last_seen_at on a re-run.
 *
 * Uses a transaction per Space so a partial failure on one body
 * doesn't poison the rest of the sweep — same posture as the daily
 * collective sweep in src/index.ts.
 */
import { db, enterCollectiveContext } from '../db/tenant';
import { persistWikilinkEdges } from './wikilinks';

interface SpaceRow {
  id: string;
  uri: string;
  body_markdown: string;
}

export async function backfillCollective(): Promise<{ processed: number; persisted: number }> {
  // Inside enterCollectiveContext — RLS scopes to this collective.
  const rows = await db.query<SpaceRow>(
    `SELECT id, uri, body_markdown FROM synthesis_pages`,
  );
  let processed = 0;
  let persisted = 0;
  for (const row of rows.rows) {
    if (!row.body_markdown) { processed += 1; continue; }
    try {
      const result = await db.transaction(async (client) => {
        return await persistWikilinkEdges(client, row.uri, row.body_markdown);
      });
      processed += 1;
      persisted += result.persisted;
    } catch (err) {
      console.error(`[backfill-wikilinks] space ${row.uri} failed:`, (err as Error).message);
    }
  }
  return { processed, persisted };
}

async function main() {
  const collectives = await db.queryWithoutTenant<{ id: string }>(
    `SELECT id FROM collectives WHERE status = 'active'`,
  );
  let totalProcessed = 0;
  let totalPersisted = 0;
  for (const c of collectives.rows) {
    try {
      const { processed, persisted } = await enterCollectiveContext(c.id, async () => {
        return await backfillCollective();
      });
      console.log(`[backfill-wikilinks] collective ${c.id}: processed=${processed} persisted=${persisted}`);
      totalProcessed += processed;
      totalPersisted += persisted;
    } catch (err) {
      console.error(`[backfill-wikilinks] collective ${c.id} failed:`, err);
    }
  }
  console.log(`[backfill-wikilinks] done — processed=${totalProcessed} edges-persisted=${totalPersisted} across ${collectives.rows.length} collective(s)`);
  process.exit(0);
}

main().catch(err => {
  console.error('[backfill-wikilinks] fatal:', err);
  process.exit(2);
});
