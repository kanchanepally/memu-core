-- migrations/045_personal_collective_for_everyone.sql
--
-- Multi-Collective Membership spec — Story 3.3 + Build Spec 1 §8
-- Story 5.2: "Auto-created personal workspace. On profile registration,
-- auto-create exactly one type='personal' workspace owned by that
-- profile."
--
-- This migration ships TWO related pieces:
--
--   1. Drops the 1:1-era unique partial index that enforced
--      "one active Collective per primary admin". That index is
--      structurally incompatible with multi-Collective: every existing
--      household admin would, after this migration, become the
--      primary_admin of TWO active Collectives (their household AND
--      their personal) — and after Story 3.1's POST /api/workspaces
--      they can create more.
--
--      Note: the index would also have blocked Story 3.1's create-
--      workspace flow in production for any user who's already a
--      household primary_admin. No one tripped it because the API
--      shipped on the same day this migration is shipping; the latent
--      bug closes here.
--
--   2. Replaces it with a TIGHTER constraint that's still meaningful:
--      a profile can own at most ONE active personal Collective. The
--      spec is explicit ("exactly one type='personal' workspace owned
--      by that profile"). This index makes the constraint mechanical
--      rather than convention.
--
--   3. Backfills personal Collectives for every existing profile that
--      doesn't already have one. After the migration runs, every
--      profile has BOTH a household membership AND a personal-owner
--      membership.
--
-- ## RLS bypass for the backfill
--
-- Same shape as migration 043: collective_memberships is Tier-A with
-- FORCE RLS. The backfill creates rows across many collectives in one
-- INSERT-SELECT; we can't set the session var to all of them. Solution:
-- temporarily ALTER NO FORCE RLS → backfill → ALTER FORCE RLS, all
-- inside a single transaction. There is no window where a runtime
-- query can write across collectives — the migration runs as a single
-- atomic unit.
--
-- ## Idempotency
--
-- - DROP INDEX IF EXISTS: re-runnable.
-- - CREATE UNIQUE INDEX IF NOT EXISTS: re-runnable.
-- - Backfill skips profiles that already have an active personal
--   Collective owned by them (NOT EXISTS guard). Safe to re-run.
--
-- ## What this migration does NOT do
--
-- - Touch any data inside the personal Collectives. They are created
--   empty — no Spaces, no stream cards, no synthesis pages. The spec
--   is explicit (acceptance §8): "No content is pre-populated into any
--   workspace."
-- - Change profiles.collective_id. That stays as the "home" pointer to
--   the household. The personal Collective is a SECOND membership, not
--   a replacement for the home. (Story 3.2's resolver prefers personal
--   when no explicit header is sent — that's where the "personal is
--   the new default scope" behaviour lives, not here.)
-- - Change any RLS policy. The Tier-A pattern (collective_id = session
--   var) applies uniformly to every Collective regardless of type.

BEGIN;

SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- 1. Drop the 1:1-era unique index
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS collectives_primary_admin_active_idx;

-- ---------------------------------------------------------------------------
-- 2. Add the tighter personal-uniqueness index
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS collectives_one_personal_per_profile_idx
  ON collectives(primary_admin_profile_id)
  WHERE status = 'active' AND type = 'personal';

COMMENT ON INDEX collectives_one_personal_per_profile_idx IS
  'Multi-Collective Membership spec, Story 3.3: a profile owns exactly one active personal Collective. Soft-deleted personals (status=deleted) are excluded so a profile can re-register after erasure.';

-- ---------------------------------------------------------------------------
-- 3. Backfill personal Collectives for every existing profile
-- ---------------------------------------------------------------------------

ALTER TABLE collective_memberships NO FORCE ROW LEVEL SECURITY;

-- Two-step approach: create the collectives, then create the memberships.
-- A WITH … RETURNING + outer INSERT would be cleaner SQL but PG's CTE
-- evaluation order doesn't guarantee that side-effects from the inner
-- INSERT are visible to the outer INSERT in all versions — splitting
-- into two top-level statements is the safer shape.
--
-- Step 3a: create personal Collectives for profiles that lack one.
INSERT INTO collectives (id, type, name, primary_admin_profile_id, status)
SELECT
  gen_random_uuid()::text,
  'personal',
  'Personal',
  p.id,
  'active'
FROM profiles p
WHERE p.collective_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM collectives c
     WHERE c.primary_admin_profile_id = p.id
       AND c.type = 'personal'
       AND c.status = 'active'
  );

-- Step 3b: create owner memberships for every personal Collective that
-- doesn't yet have one. We match by (primary_admin_profile_id, type)
-- because that's the unique-key shape post-step-2.
INSERT INTO collective_memberships (collective_id, profile_id, role, status)
SELECT c.id, c.primary_admin_profile_id, 'owner', 'active'
FROM collectives c
WHERE c.type = 'personal'
  AND c.status = 'active'
  AND NOT EXISTS (
    SELECT 1
      FROM collective_memberships cm
     WHERE cm.collective_id = c.id
       AND cm.profile_id = c.primary_admin_profile_id
       AND cm.status = 'active'
  );

ALTER TABLE collective_memberships FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Sanity check — every profile with a collective_id now has exactly
--    one active personal Collective owned by them
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing_count INT;
  excess_count INT;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM profiles p
  WHERE p.collective_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM collective_memberships cm
        JOIN collectives c ON c.id = cm.collective_id
       WHERE cm.profile_id = p.id
         AND c.type = 'personal'
         AND c.primary_admin_profile_id = p.id
         AND cm.status = 'active'
         AND c.status = 'active'
    );

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Backfill incomplete: % profile(s) still lack an active personal Collective. '
      'Investigate before re-running.',
      missing_count;
  END IF;

  SELECT COALESCE(SUM(extra), 0) INTO excess_count
  FROM (
    SELECT p.id, COUNT(*) - 1 AS extra
      FROM profiles p
      JOIN collectives c
        ON c.primary_admin_profile_id = p.id
       AND c.type = 'personal'
       AND c.status = 'active'
     GROUP BY p.id
    HAVING COUNT(*) > 1
  ) dup;

  IF excess_count > 0 THEN
    RAISE EXCEPTION
      'Backfill produced duplicates: % extra active personal Collective(s) detected. '
      'The unique index should have prevented this — investigate.',
      excess_count;
  END IF;
END $$;

COMMIT;
