-- migrations/043_collective_memberships.sql
--
-- Multi-Collective Membership spec — Story 1.2 + 1.3.
-- Decision (Story 1.1) documented in
-- docs/audits/2026-05-15-multi-collective-audit.md §7: create a NEW
-- table for the local roster relationship rather than extending the
-- existing `collective_members` table. The existing table stays
-- strictly the cross-household / cross-Pod bridge it was designed
-- for; this new table is the membership relationship between a
-- local profile and the Collective it belongs to.
--
-- ## Why a new table — short version
--
-- Three criteria from the spec (priority order):
--   1. Solid-alignment leave test — collective_members has CASCADE
--      FKs from pod_grants + external_space_cache, designed for
--      cross-Pod-member-leaves. Putting local-roster rows there
--      entangles two different leave-lifecycles. New table keeps
--      them clean.
--   2. Conflation risk — collective_members.member_webid is NOT NULL
--      and internal_profile_id is NULLABLE by design (NULL = pure
--      external member). Local rows could only be distinguished by
--      runtime predicates, not structurally. Fails criterion 2.
--   3. Smallest honest change — new single-purpose table beats
--      relaxing NOT NULLs + auditing every existing cross-Pod
--      reader for local-vs-external discrimination.
--
-- The audit doc has the full reasoning + future-reconciliation note.
--
-- ## Schema shape
--
-- - collective_id, profile_id — the relationship endpoints (FK on
--   each side). UNIQUE on the pair so a person is in a given
--   collective exactly once.
-- - role enum — owner / admin / adult / child / member / viewer.
--   Same set as profiles.role (extended in migration 040). After
--   readers switch (Story 2.1), profiles.role is dropped (2.2).
-- - status enum — active / invited / left. Today every backfilled
--   row is 'active'. Invited + left are reserved for the
--   invitation flow (out of scope here) but the enum supports them
--   so the social slice doesn't need to re-migrate.
-- - profile_id link compatibility — the spec calls out (§9 risk 4)
--   that profiles.id should NOT become the entrenched identity
--   primitive. The FK is to profile_id today because that's all
--   we have, but the table is named `collective_memberships`
--   (relationship-shaped) so a future WebID-centric model can
--   either evolve this table or reconcile it with collective_members
--   without renaming.
--
-- ## RLS
--
-- Standard Tier-A pattern matching every other tenant table
-- (migration 028): collective_id NOT NULL with session-var default,
-- ENABLE + FORCE ROW LEVEL SECURITY,
-- collective_memberships_collective_isolation policy.
--
-- ## Conditional GRANT
--
-- Per feedback-grant-memu-app-conditional from migration 041's
-- hotfix earlier today: the memu_app role only exists on Hosted
-- deploys. The GRANT is wrapped in a pg_roles existence check.
--
-- ## Backfill (Story 1.3, same migration)
--
-- Every existing profile gets exactly one collective_memberships row
-- linking it to its current profiles.collective_id with role from
-- profiles.role. After the migration runs, the table is a complete
-- and faithful representation of the current 1:1 reality — nothing
-- lost, nothing invented. NO reader is switched yet (that's Story
-- 2.1 in subsequent code commits).

BEGIN;

SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- 1. The membership relationship table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS collective_memberships (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  profile_id TEXT NOT NULL
    REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'admin', 'adult', 'child', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'left')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One membership per (profile, collective). The spec is explicit:
  -- "a person is in a given Collective once."
  UNIQUE (collective_id, profile_id)
);

-- Reader-oriented indexes — both directions are needed:
--   "what Collectives is this person in" → profile_id-keyed
--   "who is in this Collective"          → collective_id-keyed
-- The UNIQUE on (collective_id, profile_id) covers the second; an
-- explicit index on profile_id is needed for the first.
CREATE INDEX IF NOT EXISTS collective_memberships_profile_idx
  ON collective_memberships (profile_id, status);

-- ---------------------------------------------------------------------------
-- 2. RLS — same pattern as every Tier-A tenant table
-- ---------------------------------------------------------------------------

ALTER TABLE collective_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE collective_memberships FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'collective_memberships'
      AND policyname = 'collective_memberships_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY collective_memberships_collective_isolation ON collective_memberships
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- Conditional GRANT — memu_app only exists on Hosted-tier deploys
-- (see feedback-grant-memu-app-conditional memory from 2026-05-15).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memu_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON collective_memberships TO memu_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Backfill from current 1:1 reality (Story 1.3)
-- ---------------------------------------------------------------------------
--
-- For every existing profile: insert one row linking it to its
-- current profiles.collective_id, with role from profiles.role. The
-- backfill uses pg_set_role-bypassing because RLS would otherwise
-- require entering each collective's context per insert — we do the
-- whole thing as one query under the migration superuser.
--
-- A migration runs as a superuser (or NOSUPERUSER memu_app on
-- Hosted) and FORCE ROW LEVEL SECURITY applies. But the WITH CHECK
-- on the new policy validates against current_setting('memu.
-- collective_id'). The backfill needs to insert across MANY
-- collectives in one query — we can't set the session var to all of
-- them simultaneously.
--
-- Solution: temporarily bypass FORCE for the backfill. ALTER TABLE
-- NO FORCE ROW LEVEL SECURITY → INSERT → re-enable. Same pattern
-- migration 028 documents in its closing block for emergency
-- maintenance.
--
-- This is safe: the backfill happens inside a single transaction,
-- the insert query is statically defined (no user input), and
-- FORCE is re-enabled before COMMIT. There is no window where a
-- runtime query can write across collectives.

ALTER TABLE collective_memberships NO FORCE ROW LEVEL SECURITY;

INSERT INTO collective_memberships (collective_id, profile_id, role, status)
SELECT
  p.collective_id,
  p.id,
  p.role,
  'active'
FROM profiles p
WHERE p.collective_id IS NOT NULL
ON CONFLICT (collective_id, profile_id) DO NOTHING;

ALTER TABLE collective_memberships FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE collective_memberships IS
  'Multi-Collective Membership spec — Story 1.2. The membership RELATIONSHIP between a profile and a Collective. One row per (profile, collective) — a person is in a given Collective once. Role lives here, not on the profile, because role is a property of the relationship once a person can belong to multiple Collectives. See docs/audits/2026-05-15-multi-collective-audit.md for the design decision (Option B — new table — over extending the WebID-flavoured collective_members).';

COMMENT ON COLUMN collective_memberships.profile_id IS
  'Local-projection link to the individual. profiles is the local cache of a person; the identity atom is conceptually the WebID. This link is structured so a future WebID-centric model can reconcile cleanly — see audit doc §7 future-reconciliation note.';

COMMENT ON COLUMN collective_memberships.role IS
  'Role IN THIS Collective. Each membership carries its own role: a person may be owner of their personal Collective and member of a venture. Migration 040 extended the enum to match this column; profiles.role is retired in Story 2.2 after readers switch.';

COMMIT;
