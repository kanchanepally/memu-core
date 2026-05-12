-- 026_households.sql
--
-- Pre-Beta Stream 1 — Multi-tenancy via Postgres RLS.
--
-- Introduces the canonical `collectives` table that supersedes the
-- "family_id = primary admin profile_id" convention used since Stories
-- 2.1–2.3. Every tenant-scoped query after Stream 1 lands routes via
-- collectives.id, enforced by RLS policies on every tenant table.
--
-- "Collective" is the ARCH-01 rename of what earlier drafts called
-- "household" — chosen per ADR-002 (memu-platform/decisions/
-- ADR-002-tenant-model-collectives-2026-05.md) so the type column
-- can later distinguish household / friend-group / care-circle /
-- team without the table name implying a domestic-only model. The
-- default `type` is 'household' so existing single-family deployments
-- still describe themselves accurately at the type level.
--
-- This migration is split from 027 (collective_id columns + backfill)
-- and 028 (RLS enable + policies) so each can be applied and verified
-- independently. 026 + 027 are zero-behaviour-change at runtime; 028
-- ships with the app-code refactor in the same PR.
--
-- Migration 029 follows up by renaming the legacy `household_members`
-- and (if present) `household_settings` tables introduced in
-- migration 014 to their `collective_*` counterparts. 026 itself
-- still references `household_members` because at 026's execution
-- time 029 hasn't run yet and the legacy table is still under its
-- original name.
--
-- ID convention: TEXT primary keys with gen_random_uuid()::text, matching
-- every other Memu table. Postgres 13+ provides gen_random_uuid() as a
-- built-in (no pgcrypto extension required); the Z2 runs Postgres 16.
--
-- Rationale for the migration is in:
--   memu-core/docs/plans/pre-beta-1-plan.md
--   memu-platform/docs/MEMU-SELF-REPORT-2026-05-07.md (audit §C.6, §L#1)
--   memu-platform/decisions/ADR-002-tenant-model-collectives-2026-05.md

-- ---------------------------------------------------------------------------
-- collectives
-- ---------------------------------------------------------------------------
--
-- One row per family/household/friend-group/care-circle/team. The
-- primary_admin is the profile that registered the collective first
-- (the inviter for any subsequently-added members). pending_deletion_at
-- is added now even though Stream 3 (GDPR erasure) is its only consumer
-- — landing both column adds in one ALTER TABLE saves a second
-- migration round.
--
-- `type` defaults to 'household' so the existing Z2 deployment
-- describes itself accurately without an explicit set. Future shapes
-- (friend_group, care_circle, team, …) are application-level choices;
-- the column is free-form TEXT so adding a new shape doesn't require
-- a schema migration. RLS policies operate on collective_id alone,
-- so type does not need to participate in the tenant boundary.

CREATE TABLE IF NOT EXISTS collectives (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'household',
  -- DEFERRABLE INITIALLY DEFERRED: the bootstrap flow inserts the
  -- profile first (with collective_id pointing at this row's id) and
  -- then this collective row. Within that single transaction one of
  -- the FKs always sees a not-yet-existing target; deferring lets
  -- the constraint check happen at COMMIT instead of INSERT time.
  -- We defer BOTH circular FKs (this one + profiles.collective_id)
  -- so the bootstrap flow is robust to insert ordering — a future
  -- refactor that reorders won't accidentally break the boot path.
  primary_admin_profile_id TEXT NOT NULL REFERENCES profiles(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  pending_deletion_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- One active collective per primary admin. Soft-deleted collectives (status
-- 'deleted', deleted_at set) are excluded from the constraint so a profile
-- can re-register after erasure without colliding on this index.
CREATE UNIQUE INDEX IF NOT EXISTS collectives_primary_admin_active_idx
  ON collectives(primary_admin_profile_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- profiles.collective_id
-- ---------------------------------------------------------------------------
--
-- Every profile belongs to exactly one collective. Nullable during the
-- migration; backfilled below; SET NOT NULL at the end of the file.

-- DEFERRABLE INITIALLY DEFERRED matches collectives.primary_admin_profile_id
-- above. The two FKs are circular (profile → collective, collective → profile)
-- and the bootstrap flow inserts both rows inside one transaction. Deferring
-- both lets the inserts happen in either order; the constraints validate at
-- COMMIT, by which point both rows exist.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS collective_id TEXT
    REFERENCES collectives(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS profiles_collective_id_idx
  ON profiles(collective_id);

-- ---------------------------------------------------------------------------
-- Backfill — the existing-data migration
-- ---------------------------------------------------------------------------
--
-- Today the convention is "family_id = primary admin profile_id". For
-- Hareesh's Z2 deployment (and any other Memu instance running pre-026),
-- this means every profile is either:
--   (a) a primary admin in its own right (Hareesh, in single-profile
--       deployments), or
--   (b) a member invited via the magic-link flow shipped 2026-04-26,
--       recorded in household_members (legacy table — 029 will rename
--       this to collective_members later).
--
-- Strategy:
--   Step A — create a collective for every profile that doesn't already
--            have one as primary admin. Default name from display_name.
--   Step B — point each profile at the collective where it is primary.
--   Step C — for invited members (recorded in household_members),
--            re-point their collective_id at the inviter's collective.
--   Step D — delete now-orphaned collectives created in Step A for
--            members who got reassigned in Step C.
--
-- The migration is safe to re-run: every step uses NOT EXISTS or
-- IS NULL guards so a partial application can be resumed.

-- Step A
INSERT INTO collectives (id, name, primary_admin_profile_id, created_at)
SELECT
  gen_random_uuid()::text,
  CASE
    WHEN COALESCE(NULLIF(TRIM(p.display_name), ''), '') = '' THEN 'Household'
    ELSE p.display_name || '''s household'
  END,
  p.id,
  COALESCE(p.created_at, NOW())
FROM profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM collectives c
  WHERE c.primary_admin_profile_id = p.id AND c.status = 'active'
);

-- Step B
UPDATE profiles p
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = p.id
  AND c.status = 'active'
  AND p.collective_id IS NULL;

-- Step C — only runs if household_members rows exist
-- (the table was added in migration 014 and may be empty; 029 will
-- rename it to collective_members AFTER this migration runs, so at
-- 026's execution time we still reference the legacy name).
UPDATE profiles p
SET collective_id = inviter.collective_id
FROM household_members hm
JOIN profiles inviter ON inviter.id = hm.invited_by_profile_id
WHERE hm.internal_profile_id = p.id
  AND hm.status IN ('active', 'invited')
  AND inviter.collective_id IS NOT NULL
  AND p.collective_id IS DISTINCT FROM inviter.collective_id;

-- Step D — drop orphaned single-profile collectives created in Step A
-- for profiles that got reassigned in Step C. A collective with no
-- profiles pointing at it AND no household_members rows is a true
-- orphan and is safe to remove. (household_admin_profile_id stays
-- under its legacy name here — 029 will rename it to
-- collective_admin_profile_id when it renames the table.)
DELETE FROM collectives c
WHERE c.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM profiles WHERE collective_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM household_members hm WHERE hm.household_admin_profile_id = c.primary_admin_profile_id);

-- ---------------------------------------------------------------------------
-- Enforce: every profile must have a collective
-- ---------------------------------------------------------------------------
--
-- After backfill, this constraint is upheld by registration code (which
-- creates a collective for new primary admins) and by the magic-link
-- invite flow (which points new profiles at the inviter's collective).
-- The application code change shipped in the same PR as 028 enforces
-- this; the constraint here is the defence in depth.

-- Force the two circular DEFERRABLE INITIALLY DEFERRED FKs (collectives →
-- profiles, profiles → collectives) to validate NOW instead of at COMMIT.
-- Without this, the backfill INSERTs/UPDATEs above leave pending deferred
-- trigger events on `profiles`, and the SET NOT NULL ALTER below fails
-- with "cannot ALTER TABLE because it has pending trigger events" (SQLSTATE
-- 55006 — observed on Hareesh's Z2 standalone deploy 2026-05-12). After
-- this statement runs the deferred checks have fired; the FKs continue
-- to be deferrable for future bootstrap-time transactions but the queue
-- is empty so ALTER TABLE can proceed.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE profiles
  ALTER COLUMN collective_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Comments — readable in psql via \d+ profiles
-- ---------------------------------------------------------------------------

COMMENT ON TABLE collectives IS
  'Pre-Beta Stream 1: tenant boundary. Every tenant-scoped table has a collective_id FK; RLS policies enforce isolation per current_setting(memu.collective_id). Shape (household / friend-group / care-circle / team) is recorded in the type column per ADR-002.';

COMMENT ON COLUMN collectives.type IS
  'ADR-002 shape: ''household'' (default), ''friend_group'', ''care_circle'', ''team'', or any future free-form value. RLS does not key on type — tenant isolation is by collective_id alone.';

COMMENT ON COLUMN collectives.primary_admin_profile_id IS
  'The profile that registered the collective. Becomes the inviter for any subsequently-added members.';

COMMENT ON COLUMN collectives.pending_deletion_at IS
  'Stream 3 (GDPR Article 17 erasure): NOT NULL means a deletion is scheduled; the cron hard-deletes after the grace period.';

COMMENT ON COLUMN profiles.collective_id IS
  'Pre-Beta Stream 1: every profile belongs to exactly one collective. Set on registration or magic-link invite acceptance.';
