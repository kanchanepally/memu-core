# Phase 1 — Embeddings on Spaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Embed every Space body, keep the embedding fresh on every write, and use it to vector-shortlist the catalogue matcher's candidate set — so retrieval shortlists semantically-relevant Spaces before the LLM matcher runs.

**Architecture:** Reuse the existing `embedText` (Xenova `all-MiniLM-L6-v2`, 384-dim, quantized, mean-pooled + normalised) from `src/intelligence/context.ts`. Same model, same dimensionality, same pgvector setup as `context_entries`. New `embedding vector(384)` column on `synthesis_pages` with an ivfflat index sized for the current row volume (low hundreds). Hook into the one canonical write path (`upsertSpace`). Modify `askCatalogueMatcher` in `src/spaces/retrieval.ts` to vector-shortlist before LLM.

**Tech Stack:** pgvector + `@xenova/transformers` (already in deps). vitest. node-tsx.

**Spec reference:** `memu-platform/files/build-spec-1-workspace-architecture.md` §4 (Phase 1).

**Branch:** `feat/phase-1-embeddings` (off main, post-Phase 0).

**Acceptance:** Phase 0's eval harness shows recall **flat or improved** on real Z2 data. Regression = real regression.

---

### Task 1: Migration 038 — `embedding` column + index

**Files:**
- Create: `memu-core/migrations/038_synthesis_pages_embedding.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migrations/038_synthesis_pages_embedding.sql
--
-- Phase 1 of Build Spec 1 — embed every Space body so retrieval can
-- vector-shortlist the catalogue matcher's candidate set. Reuses the
-- exact model + dimensionality of context_entries.embedding (Xenova
-- all-MiniLM-L6-v2, 384-dim) per the spec rule "do not introduce a
-- second model or dimension".
--
-- Index sizing: spec says "size for tens to low hundreds of rows".
-- For ivfflat, lists = sqrt(rows) is the rule of thumb at this scale;
-- lists = 10 covers up to a few hundred rows comfortably. pgvector
-- falls back to sequential scan when the table is tiny anyway.
--
-- Idempotent.

ALTER TABLE synthesis_pages
  ADD COLUMN IF NOT EXISTS embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_synthesis_pages_embedding
  ON synthesis_pages
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);
```

- [ ] **Step 2: Commit**

```bash
git add migrations/038_synthesis_pages_embedding.sql
git commit -m "feat(db): migration 038 — embedding column + ivfflat index on synthesis_pages"
```

---

### Task 2: Backfill command

**Files:**
- Create: `memu-core/src/eval/backfillEmbeddings.ts` *(repurposed location — `src/eval/` is the closest existing module to "ops scripts run from CLI/cron"; keeps the surface narrow)*

Actually — create at `memu-core/src/spaces/backfillEmbeddings.ts` to keep it adjacent to other Spaces code.

- [ ] **Step 1: Write the implementation**

```typescript
// src/spaces/backfillEmbeddings.ts
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
import { resolve } from 'node:path';
import { db, enterCollectiveContext } from '../db/tenant';
import { embedText } from '../intelligence/context';

interface SpaceRow {
  id: string;
  title: string;
  description: string;
  body_markdown: string;
}

function embeddingTextFor(row: SpaceRow): string {
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

if (resolve(process.argv[1] ?? '').endsWith('backfillEmbeddings.ts')
    || resolve(process.argv[1] ?? '').endsWith('backfillEmbeddings.js')) {
  main().catch(err => { console.error(err); process.exit(2); });
}
```

- [ ] **Step 2: Add the npm script**

Edit `package.json`, after the existing `eval:replay` line:

```json
    "spaces:backfill-embeddings": "tsx src/spaces/backfillEmbeddings.ts"
```

- [ ] **Step 3: Smoke-check the entry point doesn't crash at parse**

Run: `npx tsx -e "import('./src/spaces/backfillEmbeddings.js').then(m => console.log(typeof m.backfillCollective)).catch(e => { console.error(e); process.exit(1); })"`
Expected: prints `function`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/spaces/backfillEmbeddings.ts package.json
git commit -m "feat(spaces): backfillEmbeddings — populate embedding column for existing Spaces"
```

---

### Task 3: Re-embed on write — hook into `upsertSpace`

**Files:**
- Modify: `memu-core/src/spaces/store.ts:244` (`upsertSpace`)

- [ ] **Step 1: Add the import**

In `src/spaces/store.ts`, after the existing imports near line 21, add:

```typescript
import { embedText } from '../intelligence/context';
```

- [ ] **Step 2: Compute the embedding inside the transaction**

In `upsertSpace` (line 244+), before the `await client.query(`INSERT INTO synthesis_pages ...`)` call, compute the embedding:

```typescript
    // Phase 1: embed the Space body on every write. Same text shape as
    // backfill (title + description + body) so the backfilled values
    // remain comparable.
    const embeddingText = [input.name, input.description ?? '', input.bodyMarkdown]
      .map(s => (s ?? '').trim())
      .filter(Boolean)
      .join('\n\n');
    const embeddingVec = embeddingText ? await embedText(embeddingText) : null;
    const embeddingStr = embeddingVec ? `[${embeddingVec.join(',')}]` : null;
```

- [ ] **Step 3: Add the column to the INSERT and update SET clause**

Change the INSERT statement to include `embedding` as parameter `$17`, and the UPDATE SET clause to include `embedding = EXCLUDED.embedding`. Pass `embeddingStr` as the 17th positional parameter (and cast `$17::vector`).

The plan tells you to read line 288 of `store.ts` — that INSERT lists 16 columns. Add `embedding` as the 17th. The VALUES list becomes `($1,...,$16,$17::vector, NOW())` — but wait, NOW() was the 17th positional, so it's now 18th. Re-index carefully.

Concretely, change:

```typescript
      `INSERT INTO synthesis_pages (
         id, profile_id, family_id, uri, slug, category, title, body_markdown,
         description, domains, people, visibility, confidence,
         source_references, tags, parent_space_uri, last_updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         body_markdown = EXCLUDED.body_markdown,
         description = EXCLUDED.description,
         domains = EXCLUDED.domains,
         people = EXCLUDED.people,
         visibility = EXCLUDED.visibility,
         confidence = EXCLUDED.confidence,
         source_references = EXCLUDED.source_references,
         tags = EXCLUDED.tags,
         ${updateClauseParent}
         last_updated_at = NOW()`,
```

to:

```typescript
      `INSERT INTO synthesis_pages (
         id, profile_id, family_id, uri, slug, category, title, body_markdown,
         description, domains, people, visibility, confidence,
         source_references, tags, parent_space_uri, embedding, last_updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, $17::vector, NOW())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         body_markdown = EXCLUDED.body_markdown,
         description = EXCLUDED.description,
         domains = EXCLUDED.domains,
         people = EXCLUDED.people,
         visibility = EXCLUDED.visibility,
         confidence = EXCLUDED.confidence,
         source_references = EXCLUDED.source_references,
         tags = EXCLUDED.tags,
         embedding = EXCLUDED.embedding,
         ${updateClauseParent}
         last_updated_at = NOW()`,
```

And add `embeddingStr` after `parentInsertValue` in the values array (around line 322), making it position 17.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: 669/669 still passing. Any failures = a regression to investigate.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/spaces/store.ts
git commit -m "feat(spaces): re-embed body on every upsertSpace (Phase 1)"
```

---

### Task 4: Vector-shortlist in catalogue matcher

**Files:**
- Modify: `memu-core/src/spaces/retrieval.ts` (the `askCatalogueMatcher` function around lines 185-226)
- Test: `memu-core/src/spaces/retrieval.test.ts` (if it exists — verify)

- [ ] **Step 1: Read the existing test file to understand its shape**

Run: `head -50 src/spaces/retrieval.test.ts` to see test patterns. If it doesn't exist, skip the test step for this task — the eval harness from Phase 0 is the real acceptance test.

- [ ] **Step 2: Add a vector-shortlist helper to retrieval.ts**

Above `askCatalogueMatcher`, add:

```typescript
import { embedText } from '../intelligence/context';

/**
 * Phase 1: vector-shortlist the catalogue against the query embedding.
 * Returns up to `topK` URIs ranked by cosine similarity. Falls back to
 * the full catalogue if embeddings aren't populated (no NULL filter
 * mismatch — pgvector's `<=>` operator handles NULL by sorting them
 * last, but we filter explicitly for clarity).
 *
 * Visibility is enforced upstream: `catalogue` is already filtered by
 * the viewer's allowed-readers, so any URI we return is safe.
 */
async function shortlistByEmbedding(
  catalogue: CatalogueEntry[],
  query: string,
  topK = 20,
): Promise<CatalogueEntry[]> {
  if (catalogue.length <= topK) return catalogue;  // no point shortlisting
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
```

Also add `import { db } from '../db/tenant';` at the top of the file (it may already be there from elsewhere — check).

- [ ] **Step 3: Wire the shortlist into `askCatalogueMatcher`**

In `askCatalogueMatcher`, between the early-return for empty catalogue and the `renderCatalogueForPrompt` call, add the shortlist:

```typescript
async function askCatalogueMatcher(
  input: RetrieveInput,
  catalogue: CatalogueEntry[],
): Promise<CatalogueEntry[]> {
  if (catalogue.length === 0) return [];

  // Phase 1: vector-shortlist before handing to the LLM. Cuts prompt
  // size + improves recall by surfacing semantically-relevant Spaces
  // even when their name/description doesn't keyword-match the query.
  const shortlisted = await shortlistByEmbedding(catalogue, input.query);

  const cataloguePrompt = renderCatalogueForPrompt(shortlisted);
  const uriLookup = new Map(shortlisted.map(e => [e.uri, e]));

  // ...rest unchanged
```

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: 669/669 still passing.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/spaces/retrieval.ts
git commit -m "feat(spaces): vector-shortlist catalogue before LLM matcher (Phase 1)"
```

---

## Operator action (after the plan is fully executed)

1. **Deploy to Z2**:
   ```
   ssh hareesh@memu-hub
   cd /opt/memu-core
   git pull origin <branch>
   docker compose -f docker-compose.standalone.yml up -d --build memu_core_standalone_api
   ```
   Watch boot logs for `migration 038 applied`.

2. **Backfill existing Spaces**:
   ```
   docker exec memu_core_standalone_api npm run spaces:backfill-embeddings
   ```
   Expected output: `[backfill] done — embedded=N skipped=0 across 1 collective(s)`. N depends on how many Spaces you've accumulated.

3. **Re-run the Phase 0 eval harness**:
   ```
   docker exec memu_core_standalone_api npm run eval:replay -- --collective <id> --viewer <profile_id>
   ```
   Compare recall to yesterday's. **Acceptance:** flat or improved. If down, do not merge to main — investigate.

4. **Tomorrow morning at 05:15** — the nightly cron emits a fresh `eval_recall` card. Verify drift line shows "up" or "same".

---

## Self-review

**Spec coverage:**
- Story 1.1 (embedding column + index + backfill) → Tasks 1 + 2 ✓
- Story 1.2 (re-embed on write) → Task 3 ✓
- Story 1.3 (vector shortlist in catalogue matcher) → Task 4 ✓
- Acceptance via Phase 0 harness → Operator action 3 ✓

**Type consistency:** `embedText(text: string): Promise<number[]>` used identically across backfill + write hook + shortlist. Vector dim 384 matches existing context_entries pattern. Index sized for low row count per spec.

**Placeholder scan:** clean — every step has its actual code or command.

**The one risk to watch:** Task 4 inserts a `db.query` call inside `askCatalogueMatcher` (currently pure logic + one `dispatch` call). The shortlist query MUST run inside a collective context — verify the caller (orchestrator → retrieveForQuery → askCatalogueMatcher) is already inside one. It should be (chat goes through `requireCollective`), but log it on first deploy.
