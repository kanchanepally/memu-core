-- migrations/044_drop_profiles_role.sql
--
-- Multi-Collective Membership spec — Story 2.2.
--
-- Now that every reader and every writer of role has moved onto
-- collective_memberships (Stories 2.1 + 2.2 in code), drop the column
-- from profiles. Two reasons this matters more than the usual "remove
-- the dead field" cleanup:
--
--   1. Single source of truth. profiles.role and
--      collective_memberships.role would silently drift the moment a
--      person joined a second Collective (which the whole spec is
--      about enabling). Keeping the column "for backwards compat"
--      would entrench the 1:1 assumption we're explicitly retiring.
--
--   2. Solid-alignment leave test. The spec defines role as a property
--      of the relationship between a profile and a Collective, not of
--      the profile itself. profiles is a local cache; the membership
--      row is what carries role. profiles.role contradicts that model
--      structurally, so it goes.
--
-- ## Backfill verification
--
-- Migration 043 backfilled collective_memberships from profiles for
-- every existing profile with a collective_id. The backfill used
-- ON CONFLICT DO NOTHING — safe to re-run, but it means anything
-- that landed in profiles AFTER 043 ran (and was not also written to
-- collective_memberships) would be dropped here.
--
-- Story 2.2 closes that window in code: registerProfile +
-- signInWithGoogle now write the membership row inside the same
-- transaction as the profile row. Any deployment that ran 043 and
-- then ran Story 2.2 code before this migration is guaranteed
-- consistent. A safety net assertion below catches the case where
-- 044 is applied to a database that ran 043 but missed Story 2.2
-- in code (e.g. operator pulled migration 044 only).
--
-- ## RLS note
--
-- profiles is Tier-B (the policy with the explicit memu.bootstrap
-- escape hatch). Dropping a column doesn't change the policy
-- expression — the policy references collective_id, not role.
--
-- ## Reversibility
--
-- Drop column is reversible *as long as we don't rely on the values*.
-- We re-add the column NULLable + nothing reads it = harmless. The
-- spec is explicit (§9 risk 3): never use profiles.role as the
-- entrenched role primitive again. If we ever need to roll back, the
-- backfill in 043 is the source of truth — restore it from the
-- membership table.

BEGIN;

SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- 1. Safety-net assertion — every profile with a collective_id MUST have
--    an active membership row matching it. If this fails, abort:
--    something wrote a profile in the window between 043 backfill and
--    Story 2.2 code, without writing the membership row. Re-run the
--    043 backfill query (idempotent via ON CONFLICT DO NOTHING) before
--    rolling 044 again.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing_count INT;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM profiles p
  WHERE p.collective_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM collective_memberships cm
       WHERE cm.profile_id = p.id
         AND cm.collective_id = p.collective_id
         AND cm.status = 'active'
    );

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Cannot drop profiles.role: % profile(s) lack an active membership row. '
      'Re-run migration 043''s INSERT (idempotent via ON CONFLICT DO NOTHING) '
      'and verify Story 2.2 code is deployed before re-running this migration.',
      missing_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Drop the column
-- ---------------------------------------------------------------------------

ALTER TABLE profiles DROP COLUMN IF EXISTS role;

-- ---------------------------------------------------------------------------
-- 3. Comment on the table to record the shift
-- ---------------------------------------------------------------------------

COMMENT ON TABLE profiles IS
  'Local-cache projection of an individual. The identity atom is conceptually the WebID; profiles is the database-side convenience. Role is NOT a column here — it lives on collective_memberships, because a person may belong to multiple Collectives with different roles in each (Multi-Collective Membership spec, Story 2.2).';

COMMIT;
