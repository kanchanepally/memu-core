/**
 * Phase 1 of Build Spec 1 — embed every Space body that doesn't have
 * an embedding yet. Enumerates collectives without a tenant context
 * (collectives is Tier-C, no RLS), then enters each one for the
 * per-collective update. Idempotent: re-running this is a no-op
 * once everything is embedded.
 *
 * Invoked via `npm run spaces:backfill-embeddings`. Safe to run while
 * the API container is up.
 */
import { db, enterCollectiveContext } from '../db/tenant';
import { embedText } from '../intelligence/context';

interface SpaceRow {
  id: string;
  title: string;
  description: string;
  body_markdown: string;
}

export function embeddingTextFor(row: SpaceRow): string {
  // Title + description + body in that order, separated by blank lines.
  // The description is a short summary; title is the topic; body is
  // the full compiled understanding. Concatenating gives the embedding
  // the same signal the matcher sees in renderCatalogueForPrompt + the
  // full body.
  return [row.title, row.description, row.body_markdown]
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

export async function backfillCollective(): Promise<{ embedded: number; skipped: number }> {
  // Inside enterCollectiveContext — RLS scopes to this collective.
  const rows = await db.query<SpaceRow>(
    `SELECT id, title, description, body_markdown
       FROM synthesis_pages
      WHERE embedding IS NULL`,
  );
  let embedded = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    const text = embeddingTextFor(row);
    if (!text) { skipped += 1; continue; }
    const vec = await embedText(text);
    const vecStr = `[${vec.join(',')}]`;
    await db.query(
      `UPDATE synthesis_pages SET embedding = $1::vector WHERE id = $2`,
      [vecStr, row.id],
    );
    embedded += 1;
  }
  return { embedded, skipped };
}

async function main() {
  const collectives = await db.queryWithoutTenant<{ id: string }>(
    `SELECT id FROM collectives WHERE status = 'active'`,
  );
  let total = 0;
  let totalSkipped = 0;
  for (const c of collectives.rows) {
    try {
      const { embedded, skipped } = await enterCollectiveContext(c.id, async () => {
        return await backfillCollective();
      });
      console.log(`[backfill] collective ${c.id}: embedded=${embedded} skipped=${skipped}`);
      total += embedded;
      totalSkipped += skipped;
    } catch (err) {
      console.error(`[backfill] collective ${c.id} failed:`, err);
    }
  }
  console.log(`[backfill] done — embedded=${total} skipped=${totalSkipped} across ${collectives.rows.length} collective(s)`);
  process.exit(0);
}

main().catch(err => {
  console.error('[backfill] fatal:', err);
  process.exit(2);
});
