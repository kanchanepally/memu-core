# Pre-Beta Stream 1 — Multi-tenancy via Postgres RLS

**Branch:** `pre-beta-1-rls` (created off main from `3372cff`)
**Status:** Plan awaiting Hareesh's approval. Do not execute.
**Audit reference:** `memu-platform/docs/MEMU-SELF-REPORT-2026-05-07.md` §C.6, §L#1.

---

## Two scope questions surfaced during investigation

These shift the plan from the brief's nominal shape. Both need a yes/no from Hareesh before I start executing.

### Q1. ID columns: `TEXT` (codebase convention) vs `UUID` (brief's example)

The audit and re-verified `schema.sql:14` confirm every existing `id` column is `TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text`. The brief's example schema uses `id UUID PRIMARY KEY`.

**Recommendation:** match codebase convention. New `households.id` is `TEXT`; new `household_id` FKs are `TEXT`. The 22+ `familyId: profileId` sites continue to handle string IDs; no client-side `parse(uuid)` calls need adding. RLS policy comparisons become `household_id = NULLIF(current_setting('memu.household_id', true), '')` (no `::uuid` cast).

This is the safer choice. Migrating existing TEXT FKs to UUID is a separate, larger refactor with no security benefit.

### Q2. Connection pattern: how does `SET LOCAL`/`set_config(..., true)` actually attach to queries?

The codebase uses `pool.query()` directly almost everywhere (verified: `pool.connect()` is called only in `db/connection.ts` testConnection, `households/membership.ts:367`, `spaces/store.ts:246, 562`). Each `pool.query` call gets a fresh connection from the pool, runs, releases.

**The brief's `set_config(..., true)` (transaction-local) requires being inside a transaction.** With no transaction, the call is a no-op or an error depending on driver. With `set_config(..., false)` (session-level), the variable persists on the pooled connection and leaks to the next request that grabs it.

I see three viable options. Recommendation: **Option A**.

| Option | What it means | Cost | Risk |
|---|---|---|---|
| **A. Request-scoped client checkout** | New `withTenantContext(req, fn)` helper checks out a client, BEGIN, sets `memu.household_id` via `set_config(..., true)`, runs `fn(client)`, COMMIT (or ROLLBACK on error), release. Every tenant-scoped query is rewritten to use the helper. | ~150 call-site rewrites. Substantial but mechanical. | Low. The pattern is the textbook one; matches Crunchy Data's Jan 2026 guidance. |
| **B. Override pool acquire/release** | Wrap node-postgres pool to set `memu.household_id` on acquire and `RESET memu.household_id` on release. Application code stays as `pool.query`. | Smaller code change. | Medium-high. If a query throws between SET and RESET, the variable persists on that connection until the pool eventually rotates it. The fail-open mode is silent cross-tenant data exposure. |
| **C. Session-level `SET` + manual reset per request** | Application middleware sets the variable at request start and resets at request end via Fastify hooks. | Smallest code change. | High. Same fail-open risk as B but with even more places to forget. Not recommended. |

Option A is what AWS's RLS pattern, Crunchy Data's recent post, and the GitHub-engineering / Notion / Linear public write-ups all converge on for connection-pooled Postgres + tenant isolation. The 150 call-site rewrite cost is real but bounded; most are a one-line change from `pool.query(...)` to `client.query(...)` inside a `withTenantContext` block.

If Hareesh approves Option A, the plan below assumes it.

---

## The household model

```sql
CREATE TABLE households (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  primary_admin_profile_id TEXT NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  pending_deletion_at TIMESTAMPTZ,  -- Stream 3 will populate; column added now to avoid two ALTER TABLE rounds
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX households_primary_admin_idx
  ON households(primary_admin_profile_id)
  WHERE status = 'active';

ALTER TABLE profiles ADD COLUMN household_id TEXT REFERENCES households(id);
CREATE INDEX profiles_household_id_idx ON profiles(household_id);
```

Note `pending_deletion_at` is added in Stream 1 — Stream 3 needs it and a single migration is cheaper than two.

## Tables that get RLS

Verified against `schema.sql` and `migrations/*.sql` (24 distinct tables across the schema). Tier-A (must have RLS — contain user data):

`personas`, `entity_registry`, `entity_relationships`, `conversations`, `messages`, `context_entries`, `synthesis_pages`, `actions`, `alerts`, `audit_log`, `settings`, `family_settings`, `stream_cards`, `stream_card_mentions`, `list_items`, `care_standards`, `domain_states`, `onboarding_state`, `whatsapp_consent`, `inbox_messages`, `spaces_log`, `external_pod_membership`, `external_space_cache`, `privacy_ledger`, `twin_violations`, `byok_keys`, `push_tokens`, `actions_executed_log` (if present — verify), `export_log`, `household_members`, `pod_grants`, `profile_channels`.

Tier-B (RLS with permissive policy — must allow auth lookup pre-context):

`profiles` — RLS policy: visible when `current_setting('memu.household_id', true)` is empty (auth-time lookup) OR row's `household_id` matches. This lets `requireAuth` look up by api_key before household context is set.

Tier-C (no RLS — global / IdP state):

`households` itself, `oidc_payload`, `oidc_jwks`, `schema_migrations`, `erasure_log` (Stream 3 will add).

I will produce the exhaustive table list in the actual migration file by running `\dt` in psql against Hareesh's Z2 DB before writing the migration; the list above is the audit-derived starting set.

## Migration sequence

1. **`026_households.sql`** — create `households`, add `profiles.household_id`, backfill (every existing profile becomes a single-profile household keyed off display_name).
2. **`027_household_id_columns.sql`** — `ALTER TABLE … ADD COLUMN household_id TEXT REFERENCES households(id)` for every Tier-A + Tier-B table; backfill from the existing `family_id`/`profile_id` convention; `SET NOT NULL` after backfill.
3. **`028_rls_enable.sql`** — `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on every table in Tier-A and Tier-B; add `CREATE POLICY` per table. Single-pattern policy: `USING (household_id = NULLIF(current_setting('memu.household_id', true), ''))` and the same for `WITH CHECK`.

Migrations 026 and 027 run cleanly on existing data. 028 enables enforcement — anything that bypasses the new middleware after this lands sees zero rows. This means **the application code change must be merged in the same PR as 028**, or the merge order must be 026 → 027 → app code → 028.

Recommended merge order: ship 026 + 027 first (zero behaviour change, just new column + backfill), verify on Z2, then ship app code + 028 together.

## Application code changes

### New: `src/db/tenant.ts`

```typescript
import { pool } from './connection';
import type { PoolClient } from 'pg';

export async function withTenantContext<T>(
  householdId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('memu.household_id', $1, true)", [householdId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

`set_config(..., true)` is transaction-local. The variable scope is exactly the BEGIN..COMMIT block; on COMMIT/ROLLBACK the variable is automatically discarded. After `client.release()`, the connection returns to the pool with no residual state.

### New: `requireHousehold` middleware

Slots in after `requireAuth` in `src/index.ts:172` preHandler chain. Loads `profile.household_id` (auth path stays on `pool.query()` — Tier-B policy on `profiles` allows pre-context read). Stores `request.householdId` for handlers to pass into `withTenantContext`.

Decision deferred to plan-step-2: do we attach `withTenantContext` automatically to every authenticated route via Fastify lifecycle hooks (which would allow the existing handler bodies to keep using `pool.query` against the implicit transaction client), or require handlers to opt in explicitly? The implicit pattern is cleaner code; the explicit pattern is more obvious. I lean implicit (Fastify `onRequest` checks out client + BEGIN; `onResponse` COMMIT + release; handler uses `request.dbClient`). Will make the call when I see the route surface.

### Refactor: `pool.query` → `request.dbClient.query` in tenant-scoped paths

The 22+ `familyId: profileId` sites identified in the audit are the obvious starting set. Beyond those, every `pool.query` that touches a Tier-A or Tier-B table needs the same treatment. Estimated full count: ~150 sites. Mechanical change.

The `requireAuth` lookup is the deliberate exception — it stays on raw `pool.query()` because it runs before household context is known.

The cron jobs (briefing, reflection in `src/index.ts` cron.schedule blocks) iterate over households. Each iteration enters `withTenantContext(household.id, async (client) => { ... })`.

The WhatsApp ingest path (`src/intelligence/orchestrator.ts:319 handleIncomingMessage`) currently calls `lookupOrCreateProfile` which picks the first profile. This becomes: look up profile → derive household_id → enter `withTenantContext`. The "personal assistant override" comment at `orchestrator.ts:418` becomes per-household instead of singleton.

## Tests

New file: `src/__tests__/rls-isolation.test.ts`. Six tests, per the brief's Step 1.7. Plus:
- A test that `requireAuth` works without household context set (Tier-B policy lets it through).
- A test that a cron-style call entering `withTenantContext(HH1)` cannot see HH2's rows.

These are the load-bearing safety tests for the whole stream. They run against a real Postgres (the existing test infrastructure spins one up — verify in plan-step-2).

## Documentation

- Update `CLAUDE.md` with: "Every tenant-scoped query runs inside `withTenantContext`. Direct `pool.query` against tenant-scoped tables is forbidden after Stream 1; use `request.dbClient` from authenticated routes or wrap explicitly in cron paths."
- Update `memu-platform/docs/CHANGES-PRE-BETA.md` (new file, Stream 1 section).
- New `memu-platform/docs/MULTI-TENANCY.md` describing the household model + RLS pattern + how to add a new tenant-scoped table going forward.

## Smoke test

- `npx tsc --noEmit` clean.
- All 597 existing tests pass (with the new isolation tests added).
- Boot Memu locally (or against a copy of Z2 data), sign in with Hareesh's profile, run /api/dashboard/brief, /api/dashboard/synthesis, /api/message → identical responses to pre-stream baseline.

## Out-of-scope (goes to `docs/IDEAS-FOR-LATER.md`)

- Cross-household pod federation under RLS (Story 3.4 work in `external_pod_membership`) — needs more thought; today's federation predates RLS and may need a security-definer function to read across households. Punt.
- Refactoring `src/index.ts` (3007 lines, audit K.2). Don't touch.
- Removing the "first profile wins" pattern in `WHATSAPP` legacy mode — only in scope where it touches RLS; not the broader cleanup.
- Performance benchmarking of RLS overhead. Tier-1 SaaS at 20 households is small enough that RLS overhead is invisible. Revisit at >100 households.

---

## Open questions for Hareesh

1. **Approve Option A (request-scoped client checkout)?** Or prefer something else?
2. **Approve TEXT (codebase convention) over UUID (brief's example) for the new ID columns?**
3. **Approve adding `pending_deletion_at` to `households` in this stream's migration**, even though Stream 3 is the consumer? (Saves a second ALTER TABLE.)
4. **Implicit vs explicit `withTenantContext`** for authenticated routes: do you have a strong preference, or shall I make the call when I see the route surface?

I'll wait for the answers before writing migration 026.
