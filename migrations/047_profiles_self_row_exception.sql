-- migrations/047_profiles_self_row_exception.sql
--
-- Hotfix: extend the profiles RLS policies to honor a memu.profile_id
-- session var for self-row reads + writes.
--
-- ## Why
--
-- Migration 028's profiles_read / profiles_write policies were
-- designed under the 1:1 era where every profile lived in exactly
-- one Collective and the home pointer was unambiguous. Their
-- USING / WITH CHECK predicates were:
--
--   collective_id = current_setting('memu.collective_id')
--   OR (read only) memu.bootstrap = 'true'
--
-- Post-multi-Collective (migrations 043–045), a profile is a property
-- of the PERSON, not of one Collective. A user has multiple active
-- memberships (household + personal + ventures…) and the resolver
-- can pick any of them as the active workspace for a request. But
-- `profiles.collective_id` still points at a single "home" Collective.
--
-- The bug: when the active workspace is NOT the home (the resolver
-- defaults to personal post-Story-3.3), the profile row's home
-- collective_id ≠ active context → policy filters the row out → the
-- caller cannot see THEIR OWN profile. Knock-on effects:
--   - getOnboardingState returns empty state → onboarding gate fires
--     → user redirected to /onboarding.html as if a new user
--   - Display-name update fails silently
--   - Brief-preferences read fails
--   - Any other profile-by-self-id read returns zero rows
--
-- Hareesh hit this the moment Z2 flipped to memu_app (TD-01). Under
-- superuser-bypass the bug was masked; under real RLS it surfaced
-- immediately on the workspace switcher landing.
--
-- ## What this changes
--
-- A new session variable `memu.profile_id` is added to the contract.
-- When set, it identifies "the authenticated caller's profile id"
-- and lets the profiles policies match the caller's OWN row from
-- any active workspace.
--
--   profiles_read (FOR SELECT, permissive):
--     row's collective_id matches active context
--     OR memu.bootstrap = 'true' (existing auth-flow escape hatch)
--     OR row's id matches memu.profile_id (NEW — self-row exception)
--
--   profiles_write (FOR ALL, permissive):
--     USING + WITH CHECK both: collective_id matches active context
--     OR id matches memu.profile_id (NEW — self-row exception)
--
-- ## Safety
--
-- memu.profile_id is set ONLY by bindRequestContext (src/db/tenant.ts),
-- which is called by requireCollective AFTER getProfileByApiKey has
-- authenticated the caller's identity via the API-key bearer (a
-- 32-byte random secret). So memu.profile_id can never refer to
-- anything except the authenticated caller's own profile.
--
-- Application-layer assumption (not policy-enforced): no path in the
-- codebase ever UPDATEs profiles.collective_id. If a future path
-- added that, an attacker calling that path could re-home their own
-- profile to a foreign Collective. Risk is theoretical — no such path
-- exists today. Documented here so a future reader knows to think
-- about it.
--
-- ## Other tables that may need similar treatment (deferred)
--
-- push_tokens, profile_provider_keys, oidc_subject lookups — any
-- Tier-A table with rows scoped to a single profile that the auth
-- flow needs to read for the CALLER'S OWN PROFILE from any active
-- workspace. None have surfaced bugs yet because they're not in the
-- onboarding-gate critical path. Add the same self-row exception
-- (OR profile_id = memu.profile_id) per-table as the symptoms appear.
--
-- ## Cron / worker paths
--
-- Cron jobs use enterCollectiveContext (NOT bindRequestContext) which
-- doesn't set memu.profile_id. The OR-self-row clause then evaluates
-- to FALSE (memu.profile_id is empty), and the policy reverts to the
-- strict tenant-scoped check. Correct behaviour: a worker enumerating
-- profiles in a collective should only see members of that collective.

BEGIN;

SET LOCAL search_path TO public;

DROP POLICY IF EXISTS profiles_read ON profiles;
DROP POLICY IF EXISTS profiles_write ON profiles;

CREATE POLICY profiles_read ON profiles
  FOR SELECT
  USING (
    collective_id = NULLIF(current_setting('memu.collective_id', true), '')
    OR NULLIF(current_setting('memu.bootstrap', true), '') = 'true'
    OR id = NULLIF(current_setting('memu.profile_id', true), '')
  );

CREATE POLICY profiles_write ON profiles
  FOR ALL
  USING (
    collective_id = NULLIF(current_setting('memu.collective_id', true), '')
    OR id = NULLIF(current_setting('memu.profile_id', true), '')
  )
  WITH CHECK (
    collective_id = NULLIF(current_setting('memu.collective_id', true), '')
    OR id = NULLIF(current_setting('memu.profile_id', true), '')
  );

COMMIT;
