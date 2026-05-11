# Pre-Beta Stream 1 — End-of-Stream Report

**Branch:** `pre-beta-1-rls`
**Plan:** `docs/plans/pre-beta-1-plan.md`
**Date:** 2026-05-07
**Status:** code-complete on the branch; awaiting review + Z2 deploy verification.

---

## What shipped

Postgres Row Level Security as the tenant boundary. Three migrations,
one new tenant-aware DB API, one new auth-chain middleware, ~150
mechanical call-site rewrites across 32 files, seven RLS isolation
tests. TypeScript clean (`tsc --noEmit` passes); existing 597 tests
green; the new isolation suite skips when `DATABASE_URL` is unset
(running it requires Postgres).

Full narrative in `memu-platform/docs/CHANGES-PRE-BETA.md` § Stream 1.
Pattern documentation for future engineers in
`memu-platform/docs/MULTI-TENANCY.md`.

## What was harder than expected

1. **The codebase uses `pool.query()` directly almost everywhere — no
   transaction-per-request pattern.** This was the single biggest
   plan question. The brief's `set_config(..., true)` requires being
   inside a transaction, but threading transactions through ~150 call
   sites is a different shape of refactor. AsyncLocalStorage closed
   the gap: a single `db.query` wrapper opens a short transaction
   only when a context is active, picks up the household_id
   automatically, and releases the connection cleanly. The mechanical
   refactor became `pool.query → db.query` per file rather than a
   threading-parameter refactor.

2. **`pool.connect()` exceptions for the bootstrap paths.**
   `registerProfile` (in `auth.ts`) and `signInWithGoogle` (in
   `channels/auth/google-signin.ts`) create a profile *and* its
   household in the same transaction. Both run before any household
   context exists (they're the entry points that *create* it), so
   they keep using raw `pool.connect()` directly. `db.transaction`
   throws if no context is active, which is exactly the behaviour I
   want — bootstrap paths must be explicit.

3. **The cron jobs were trickier than the request handlers.** Crons
   live outside the request lifecycle and can't rely on the auth-chain
   middleware to enter context. Each had to be updated to enumerate
   households via `db.queryWithoutTenant` (households is Tier-C, no
   RLS) and `enterHouseholdContext` per iteration. The morning
   briefing, daily maintenance, weekly reflection, weekly git gc, and
   household sweep crons all got this treatment. The
   `runReflectionForAllFamilies` and `runDailyMaintenanceForAllFamilies`
   service functions in `reflection.ts` were updated to do the same
   thing internally, since they're called from the crons.

4. **Currently-global tables.** `entity_registry`, `content_rules`,
   `allowed_groups` had no tenant column at all — they were global
   by deployment convention (one tenant per deployment). The Stream 1
   migrations add `household_id` to all three; the backfill assumes a
   single household at migration time and aborts loudly if it finds
   more than one (the DO $$ block at the top of `027`). For Hareesh's
   Z2 this is correct; for any future deployment with more than one
   household at migration time, a manual decision is needed.

5. **The `family_id = primary admin profile_id` convention is still
   in the columns.** I deliberately did not remove it. Every existing
   `WHERE family_id = $1` clause is now belt-and-braces over RLS
   (the policy already filters; the explicit predicate also filters).
   Removing the convention would touch ~50 sites and is a separate
   refactor — it's in `IDEAS-FOR-LATER.md`. The behaviour is correct
   either way; just slightly inefficient.

## Things that ended up in `IDEAS-FOR-LATER.md`

- Drop the `family_id` column convention (mechanical, large)
- Refactor `src/index.ts` (90 routes in 3007 lines)
- Cron-job module extraction
- Connection pool tuning under RLS
- Refresh `retro-translate-spaces.ts` for the new context shape
- Multi-tenant onboarding stress test before opening Founding-50
- Audit `oidc_payload`/`oidc_jwks` for whether they need tenant-scoping
- Migration backfill blast-radius dashboard
- Comment-block at remaining `pool.connect()` sites explaining why
- Lint rule for `db.queryWithoutTenant`

## Residual concerns

- **Migrations 026 + 027 + 028 have not run against any database.**
  They've been read by a human and validated by structural review.
  The backfill logic in 026 (one household per primary profile,
  re-point invitees) and 027 (per-table backfill from existing
  scoping conventions) is the highest-risk part. It needs to run
  against Hareesh's Z2 with a backup taken first, and the resulting
  data state needs review before 028 enables enforcement.

- **The new `rls-isolation.test.ts` has not been run.** It skips
  cleanly when `DATABASE_URL` is unset (which is the case in the
  default vitest run), and exercises the full isolation contract
  when run against a Postgres with the migrations applied. We need
  a CI step (or a manual run) against a test DB to confirm.

- **WhatsApp ingest "fallback create profile" path was removed.** The
  old `lookupOrCreateProfile` function would create a "Hub Owner"
  profile if no profile existed. With Stream 1 this would skip the
  household-creation path and produce a profile with NULL
  household_id, failing the NOT NULL constraint. The new
  `lookupPrimaryProfile` returns null when the DB is empty;
  `handleIncomingMessage` drops the message with a warning. This is
  the right behaviour (profile creation is a deliberate user action)
  but it's a behavioural change worth noting.

- **The `MEMU_BUDGET_PRESSURE` and provider-key BYOK paths were not
  individually verified.** They route through the same `db.query`
  path as everything else, and TypeScript compiles, but no targeted
  test exercised them post-refactor. Smoke testing on Z2 should
  cover this implicitly through normal use.

## Suggested deploy procedure on Z2

The safest order for landing this on Hareesh's existing data:

1. **Take a fresh `pg_dumpall` backup before anything.**
2. **Apply 026 and 027 only.** Inspect the resulting data state:
   ```sql
   SELECT id, name, primary_admin_profile_id, status FROM households;
   SELECT id, display_name, household_id FROM profiles;
   SELECT count(*), household_id FROM synthesis_pages GROUP BY 2;
   SELECT count(*), household_id FROM stream_cards GROUP BY 2;
   SELECT count(*), household_id FROM messages GROUP BY 2;
   ```
   Expected: one household, all profiles point at it, all rows
   carry the same household_id.
3. **If the data state looks correct**, apply 028 + restart the API
   container with the application code refactor. Watch logs for
   any "row-level security" or "new row violates" errors.
4. **Smoke test the chat path**: send a message, get a reply,
   confirm a Space gets created/updated, confirm the morning
   briefing fires next 7am.
5. **If anything regresses**, the rollback path is: stop the new
   container, restore from `pg_dumpall`, restart the previous
   container. The migrations are idempotent on rerun, but rolling
   back 028's RLS enable requires a manual `ALTER TABLE … DISABLE ROW
   LEVEL SECURITY` on each table (or restore from backup).

## Hareesh review hooks

Three things specifically benefit from your eyes:

1. **Confirm the RLS policy shape.** The policy `USING (household_id =
   NULLIF(current_setting('memu.household_id', true), ''))` is what
   gates every read. If anything about the comparison feels off
   (NULL handling, empty-string coercion, case-sensitivity of TEXT
   comparison), now is the time to flag it.

2. **Confirm the household-bootstrap paths.** `registerProfile` and
   `signInWithGoogle` are the only entry points that create a new
   household. If there's a third path I missed (e.g., an admin tool,
   a script), it needs the same household-creation transaction.

3. **The cron jobs.** Five crons in `src/index.ts` and two service
   functions in `reflection.ts` were updated to enumerate households
   without RLS and enter context per iteration. If your daily
   briefing doesn't land at 07:00 the morning after deploy, this is
   the area to suspect first.

---

*Plan complete. Ready for review.*
