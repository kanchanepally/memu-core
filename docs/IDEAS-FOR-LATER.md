# Ideas for Later

Things noticed during pre-beta remediation work that are worth doing
eventually but were out of scope for the active stream. Each entry
includes context (which stream surfaced it) so the rationale doesn't
rot.

---

## Surfaced during Stream 1 (RLS / multi-tenancy)

- **Drop the `family_id` column.** Now that `collective_id` exists with
  RLS enforcement, `family_id` (= primary admin profile_id) is
  redundant. Every `WHERE family_id = $1` clause is belt-and-braces
  duplication of what RLS already enforces. Removing it would be a
  cross-cutting refactor touching ~50 query sites and 15+ tables;
  defer until the convention is fully cooled and no live code paths
  depend on it.

- **Refactor `src/index.ts`.** 3000+ lines, 90 routes in one file.
  Splitting per-resource (`spaces`, `dashboard`, `lists`, `auth`, `cron`)
  would make the surface comprehensible. Audit K.2 already named this;
  scope is large and doing it badly carries real risk (Fastify
  lifecycle ordering subtleties).

- **Cron jobs deserve their own module.** The five `cron.schedule(...)`
  blocks in `src/index.ts` (morning briefing, daily maintenance,
  weekly reflection, weekly git gc, daily collective sweep) all share
  the "enumerate collectives without RLS, enter each context" pattern.
  Worth a `src/cron/` module with a `forEachCollective(fn)` helper.

- **Connection pool tuning under RLS.** Every tenant-scoped query now
  opens a transaction (BEGIN + set_config + COMMIT). For Memu's
  current traffic volume this is invisible; at >100 collectives it may
  warrant either (a) a smarter `db` API that batches statements per
  request, or (b) a connection-pool size tune to match transaction
  duration. Revisit when telemetry shows it.

- **Refresh `src/scripts/retro-translate-spaces.ts`.** It runs without
  a collective context; with RLS enforcing, its writes will fail. Wrap
  in `enterCollectiveContext` before re-running, or convert to a
  per-collective script. Out of scope because the script is a one-off.

- **Multi-tenant onboarding stress test.** Today Hareesh's deployment
  has one collective. The RLS plumbing supports many but has only been
  exercised against one. Worth running through the Founding-50
  onboarding flow with 3+ test collectives on a non-production
  database before opening real beta.

- **Audit `oidc_payload` and `oidc_jwks` for tenant-scoping.** They
  are Tier-C (no RLS) today on the assumption that Memu's IdP is
  globally shared. If a collective ever needs to use its own IdP keys
  (e.g., regulated industry beta family) this assumption breaks. Not
  blocking Founding-50.

- **Migration backfill blast-radius dashboard.** Running 026 + 027
  on Hareesh's Z2 should produce a single collective. A dashboard
  query (`SELECT count(*), collective_id FROM <table> GROUP BY 1`)
  per Tier-A table would catch any backfill mismatches before 028
  enforces.

- **`pool.connect()` callsites that escaped.** A handful of files
  (`src/auth.ts`, `src/channels/auth/google-signin.ts`) still use
  `pool.connect()` directly for the bootstrap-create-collective
  transactions. That's correct because they run before context exists.
  Worth a comment block at each site naming why; absent that, a future
  refactor may try to "fix" them by switching to `db.transaction` and
  break the bootstrap path.

- **`db.queryWithoutTenant` as a smell.** Every use of it is a
  deliberate cross-collective read (cron enumeration, mostly). Worth
  a lint rule that flags new uses for review — easy to add a 1-line
  comment requirement once the codebase has stabilised.

---

*Add new entries above this line. Each entry: brief description,
context for why it's deferred, severity if it ever becomes blocking.*
