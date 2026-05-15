# Multi-Collective Membership — Phase 0 Audit

**Date:** 2026-05-15
**Spec:** Multi-Collective Membership (memu-platform/files/build-spec-multi-collective-membership.md — pasted into session)
**Branch:** `feat/multi-collective-membership`
**Author:** Claude Opus 4.7 (1M context)

This audit is committed before any code change. Story 1.1's decision is made against the facts it captures, not assumption. The principle from the spec — "the previous spec made a schema assumption from a snapshot and it had to be unwound; this spec will not repeat that" — governs every fact below.

---

## 1. `profiles` table — current shape

From `schema.sql` lines 13–27, with subsequent migrations applied:

```
profiles (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  display_name        TEXT NOT NULL,
  email               TEXT,
  api_key             TEXT UNIQUE,
  role                TEXT NOT NULL  CHECK (role IN ('owner', 'admin', 'adult', 'child', 'member', 'viewer')),
  date_of_birth       DATE,
  school_year         INTEGER,
  ai_model            TEXT DEFAULT 'claude-sonnet-4-6',
  system_prompt_override TEXT,
  daily_query_limit   INTEGER,
  encryption_key_hash TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  collective_id       TEXT NOT NULL REFERENCES collectives(id) DEFERRABLE INITIALLY DEFERRED  -- migration 026
)
```

**Key facts established by the audit:**

- **`profiles.role` exists** and has existed since the original schema. The spec refers to this as "the interim 1:1 model" — accurate, since the column can carry exactly one role per person, which is well-defined only while membership is 1:1. The enum was extended by migration 040 from `{admin, adult, child}` to `{owner, admin, adult, child, member, viewer}` as part of the earlier Phase 3 work.
- **`profiles.collective_id` exists** (migration 026, made NOT NULL after backfill). This is what makes membership 1:1 today — one column, one collective per profile. Migration 026 also added the index `profiles_collective_id_idx`.

---

## 2. `collective_members` table — current shape

Originally `household_members` (migration 014), renamed in migration 029. Final shape with migrations 014 + 027 + 029 applied:

```
collective_members (
  id                            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collective_admin_profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  member_webid                  TEXT NOT NULL,                          -- the WebID identifying this member
  member_display_name           TEXT NOT NULL,                          -- human-readable
  internal_profile_id           TEXT NULL REFERENCES profiles(id) ON DELETE SET NULL,
                                                                         -- NULL when member is purely external
  invited_by_profile_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status                        TEXT NOT NULL DEFAULT 'invited'
                                  CHECK (status IN ('invited','active','leaving','left')),
  leave_policy_for_emergent     TEXT NOT NULL DEFAULT 'retain_attributed'
                                  CHECK (leave_policy_for_emergent IN ('retain_attributed','anonymise','remove')),
  grace_period_days             INTEGER NOT NULL DEFAULT 30,
  invited_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at                     TIMESTAMPTZ,
  leave_initiated_at            TIMESTAMPTZ,
  leave_grace_until             TIMESTAMPTZ,
  left_at                       TIMESTAMPTZ,
  admin                         BOOLEAN NOT NULL DEFAULT FALSE,         -- migration 029, ADR-002
  collective_id                 TEXT NOT NULL REFERENCES collectives(id) -- migration 027
                                  DEFAULT NULLIF(current_setting('memu.collective_id', true), '')
)
```

**Indexes:**

- `collective_members_pkey` (PK on id)
- `uq_collective_members_admin_webid` UNIQUE on `(collective_admin_profile_id, member_webid)`
- `idx_collective_members_status` on `(collective_admin_profile_id, status)`
- `collective_members_collective_id_idx` on `collective_id`

**Tables with CASCADE FKs into `collective_members(id)`:**

- `pod_grants.member_id` (migration 014) — per-Space grants from a member's external Pod
- `external_space_cache.member_id` (migration 015) — cached parsed Spaces fetched from the member's Pod

**What this table actually is, in plain English:** the cross-household / cross-Pod membership bridge. Every row represents a person whose primary Pod may live elsewhere (another Memu deployment, PodSpaces, NSS, etc.) and whom this collective has granted access to. The row carries that person's WebID (always — `NOT NULL`), their display name (always), an optional internal profile pointer when they ALSO have a profile on this deployment, lifecycle state (invited → active → leaving → left, with grace-period semantics), and per-Pod grants via the `pod_grants` cascade.

**What this table is NOT:** a roster of the local profiles in a collective. The local roster today is implicit in `profiles.collective_id` — every profile points at its one collective, and reading `WHERE collective_id = X` gives the roster.

---

## 3. RLS policies touching `profiles` and `collective_members`

From migration 028:

**`profiles` — Tier-B policies (split read/write, explicit bootstrap mode):**

```
profiles_read   FOR SELECT
                USING (collective_id = NULLIF(current_setting('memu.collective_id', true), '')
                       OR NULLIF(current_setting('memu.bootstrap', true), '') = 'true')

profiles_write  FOR ALL
                USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
                WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
```

The bootstrap flag exists for the auth chain (`getProfileByApiKey`, `signInWithGoogle`, cron enumeration paths) which must look up profile-by-api_key BEFORE a collective context is set. Anywhere else, profile reads without context return zero rows.

**`collective_members` — Tier-A standard policy:**

`collective_members_collective_isolation FOR ALL` — same `collective_id = NULLIF(...)` USING + WITH CHECK pattern as every other Tier-A tenant table.

---

## 4. Every code path that reads "who is in this Collective"

Exhaustive list from grep + read:

| Path | What it reads | Reads from |
|---|---|---|
| `src/spaces/catalogue.ts` `loadRoster(familyId)` | `{ all, adults, partners }` — the family roster the visibility logic consumes | `SELECT id, role FROM profiles` (RLS-scoped to active collective). `adults` = role in `{'adult','admin'}`. `partners` = `adults.slice(0, 2)` (heuristic — first two adults by `role, created_at`). |
| `src/care/standards.ts` `loadRosterIds(familyId)` | `{ adults, children, all }` — used by care-standard "applies to each adult / each child" scopes | `SELECT id, role FROM profiles`. Same role-based filter pattern as above. |
| `src/spaces/model.ts` `canSee(viewer, space, roster)` / `resolveVisibility(visibility, people, roster)` | Pure functions — consume the `FamilyRoster` shape | Take roster as input; do not query DB themselves. |
| `src/api/spaces_graph.ts` `loadGraphForViewer` | Calls `loadRoster` and uses the roster in `applyVisibilityFilter` | Via `loadRoster` from `catalogue.ts`. |
| `src/spaces/solid_routes.ts` `authenticateOrReject` + visibility gate | Calls `loadRoster` and passes through `canSee` | Via `loadRoster`. |
| `src/spaces/solid.ts` `deriveAllowedReaders` | Uses `resolveVisibility` | Roster passed in by caller. |
| `src/api/workspaces.ts` `listWorkspaces(profileId)` | Caller's workspace + role | `SELECT c.id, c.name, c.type, c.parent_collective_id, c.status, p.role FROM profiles p JOIN collectives c ON c.id = p.collective_id`. Reads `profiles.role` directly. |
| `src/oidc/bearer.ts` `verifyBearer` | Returns `role` in the verified-bearer payload | `SELECT … role … FROM profiles WHERE webid_slug = …`. |

**Single source of "who is in this collective" today:** `profiles.collective_id` (column on profiles).
**Single source of "what role does this person have":** `profiles.role` (column on profiles).

Both are properties of the profile — neither is a property of the relationship — because today the relationship is 1:1 and a profile uniquely identifies the (person, collective) pair.

---

## 5. Subsequent migrations touching `profiles` (post-schema.sql)

| # | What |
|---|---|
| 008 | `webid_slug` column added |
| 026 | `collective_id` column added (NOT NULL after backfill); circular FK with `collectives.primary_admin_profile_id` |
| 027 | `collective_id` indexed |
| 040 | `role` CHECK extended from `{admin,adult,child}` to `{owner,admin,adult,child,member,viewer}` |

Migrations 028 added the RLS policies above; never touched the columns.

---

## 6. Highest existing migration number

`042_space_connections.sql`. Next sequential is **043**.

---

## 7. Decision (Story 1.1) — new `collective_memberships` table (Option B)

Decided against the spec's three criteria, in priority order.

### Criterion 1 — the Solid-alignment test

> "Can an individual leave any Collective and take their complete, intact context with them, identity unbroken?"

**Option A** (extend `collective_members` to be the unified roster): a profile leaves their collective by deleting/updating their row in `collective_members`. But `collective_members.id` is referenced by `pod_grants` and `external_space_cache` with `ON DELETE CASCADE`. If we add local-roster rows to this table and that row gets cascaded, the cascade behaviour designed for cross-Pod-member-leaves (drop their pod grants and cached spaces) fires for local profiles — irrelevant at best, semantically wrong at worst. The leave-path stops being clean. Solid-alignment is *harder*, not easier.

**Option B** (new table, leave `collective_members` as the Pod-bridge): a profile leaves a collective by deleting their `collective_memberships` row. No cascade into pod_grants — those remain tied to actual cross-Pod members. The two table-lifecycles stay independent. A future WebID-centric model can promote `collective_memberships` to be WebID-keyed when that slice arrives, with both tables still single-purpose.

**Option B wins criterion 1.**

### Criterion 2 — conflation risk

The spec is explicit:
> "If Option A cannot keep local-roster and cross-Pod rows *cleanly and structurally* distinguishable, prefer B."

**Option A**:
- `member_webid` is `NOT NULL`. Local profiles have no canonical external WebID; we'd either synthesise one (`memu://profileId/people/slug` — semi-honest) or relax the NOT NULL (changes contract for cross-Pod).
- `internal_profile_id` is `NULLABLE` by design — `NULL` means "external Pod member with no local profile". Local-roster rows would have it set. The discriminator "internal_profile_id IS NOT NULL" is a *runtime* check on every query, not a structural property. A bug that forgets the clause silently pollutes a roster query with cross-Pod rows.
- Cross-Pod rows carry lifecycle state (`invited`, `leaving`, grace periods) that local-roster rows have no equivalent of. Either local rows leave those NULL (asymmetric semantics) or we invent local-meaning for them (conflation).
- `pod_grants` and `external_space_cache` CASCADE on this table's PK — meaningful for cross-Pod, irrelevant for local.

The two row-kinds **cannot** be made cleanly, structurally distinguishable in `collective_members` without changing its contract. They can only be distinguished by runtime predicates, which the spec correctly calls a failure of criterion 2.

**Option B wins criterion 2** decisively.

### Criterion 3 — smallest honest change for today's need

**Option A**: relax NOT NULLs, add role enum + status, audit every existing reader of `collective_members` for cross-Pod-vs-local discrimination, audit every CASCADE consumer for local-irrelevance, audit every test fixture. Large surface area, lots of risk of missing a site.

**Option B**: one new table, one backfill from `profiles.collective_id` + `profiles.role`, switch the small set of readers identified in section 4. Single-purpose tables on each side, no contract changes.

**Option B wins criterion 3.**

### Decision documented

**Create a new `collective_memberships` table.** Leave `collective_members` strictly as the cross-household / cross-Pod bridge it already is. The two tables are different concepts at different scopes; they get their own clean homes.

### Future-reconciliation note (per spec)

When the WebID-centric identity model lands (its own slice — out of scope here), the two membership-shaped tables reconcile. The likely shape: `collective_memberships` becomes WebID-keyed (the link is to a WebID, with `profile_id` as the local cache hint), and `collective_members` either folds into it or becomes a more explicit "this membership represents an external Pod" subtype. Decision deferred to that slice, made with the WebID model in front of it — not pre-decided now under pressure.

---

## 8. What the next stories will do, given this decision

- **Story 1.2 (migration 043):** create `collective_memberships(id, collective_id FK, profile_id FK, role enum, status enum, created_at)`, UNIQUE `(collective_id, profile_id)`, indexes both directions, RLS pattern matching every Tier-A tenant table, conditional GRANT to memu_app (per the `feedback-grant-memu-app-conditional` memory from earlier today).
- **Story 1.3 (same migration):** backfill — every existing profile gets one row mapping to its current `profiles.collective_id` with role from `profiles.role`. After backfill: every profile has exactly one membership; the new table faithfully represents the current 1:1 reality.
- **Story 2.1:** `loadRoster` (`catalogue.ts`) and `loadRosterIds` (`care/standards.ts`) switch to reading from `collective_memberships`. Other readers identified above migrate similarly.
- **Story 2.2:** drop `profiles.role`. Decide on `profiles.collective_id` — keep as "current/default Collective hint" since active-Collective handling (Story 3.2) benefits from a default fallback, or drop if Story 3.2's implementation makes it dead weight. To be re-evaluated when Story 3.2 lands.
- **Phase 3:** create endpoint becomes real, switch endpoint added, personal-Collective-for-everyone migration reconciles existing profiles into the new atom model — all in one slice, no registration-date drift.
