-- migrations/046_collective_memberships_bootstrap.sql
--
-- Hotfix: extend collective_memberships RLS to honor the memu.bootstrap
-- session flag for reads — mirroring the profiles policy shape from
-- migration 028.
--
-- ## Why
--
-- requireCollective's flow (src/auth.ts) needs to read the caller's
-- active memberships BEFORE any collective_id session variable is set
-- — that's the whole point of the resolver: pick which Collective to
-- enter. The query is:
--
--   SELECT ... FROM collective_memberships cm ... WHERE cm.profile_id = $1
--
-- Bound to the authenticated profile by api_key. Cross-collective by
-- design: the caller has memberships in multiple Collectives and we
-- need to enumerate them.
--
-- Pre-multi-Collective era this never tripped because:
--   (a) every profile had exactly one membership matching
--       profile.collective_id, AND
--   (b) Z2 standalone ran as the SUPERUSER `memu` which bypasses RLS
--       regardless of FORCE.
--
-- TD-01 + multi-Collective together expose the latent bug:
--   - Z2 flipped to memu_app (NOSUPERUSER + NOBYPASSRLS) so RLS now
--     actually enforces.
--   - Story 3.2's resolver legitimately needs cross-collective reads
--     of the caller's own memberships.
--   - migration 043's policy strictly required collective_id match,
--     no bootstrap escape hatch. Auth chain returned zero rows → 403
--     `no_household` on every request → PWA stuck on "Loading…",
--     Today / Chat / Spaces / Lists empty.
--
-- ## What this changes
--
-- Drops the single combined policy and replaces it with the same two-
-- policy pattern profiles uses (migration 028):
--
--   collective_memberships_read (FOR SELECT, permissive):
--     row's collective_id matches the active context
--     OR explicit memu.bootstrap='true' flag is set.
--
--   collective_memberships_write (FOR ALL, permissive):
--     USING + WITH CHECK both require collective_id = active context.
--     Bootstrap does NOT enable cross-collective writes — same
--     asymmetric design as profiles.
--
-- ## Safety
--
-- The bootstrap flag is set only by `db.queryAsBootstrap` (src/db/
-- tenant.ts). Every caller in the codebase narrows by an authorized
-- identifier — `WHERE profile_id = $authenticated_profile_id` for
-- collective_memberships specifically. So even with the policy
-- allowing bootstrap reads in principle, the query SHAPE scopes
-- the result to the caller's own membership rows. No cross-tenant
-- leak surface.
--
-- Same trust-the-app design as profiles. Acceptable risk model
-- Hareesh signed off on in migration 028's docblock.

BEGIN;

SET LOCAL search_path TO public;

DROP POLICY IF EXISTS collective_memberships_collective_isolation ON collective_memberships;

CREATE POLICY collective_memberships_read ON collective_memberships
  FOR SELECT
  USING (
    collective_id = NULLIF(current_setting('memu.collective_id', true), '')
    OR NULLIF(current_setting('memu.bootstrap', true), '') = 'true'
  );

CREATE POLICY collective_memberships_write ON collective_memberships
  FOR ALL
  USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
  WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''));

COMMIT;
