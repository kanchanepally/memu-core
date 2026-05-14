-- migrations/040_profiles_role_enum.sql
--
-- Phase 3 of Build Spec 1 (memu-platform/files/build-spec-1-workspace-
-- architecture.md §6) — adopted as "Option 3" per the 2026-05-14
-- reconciliation decision (memory project_memu_phase3_interim_role_on_profile):
--
-- Extend the existing `profiles.role` CHECK to include the spec's full
-- enum (owner / admin / adult / child / member / viewer). Existing rows
-- keep their `admin / adult / child` values — they are still valid
-- under the extended CHECK, so no data migration is needed.
--
-- ## Why this — not the spec's verbatim workspace_members table
--
-- Spec 1 §6 calls for a new `workspace_members` table. The existing
-- `collective_members` table (migration 014, renamed in 029) speaks a
-- different language: WebID + Pod-flavoured, designed for the Story 3.4
-- cross-household Pod-sharing flow. The local roster today is implicit
-- in `profiles.collective_id` — every profile points at one collective.
--
-- Three options were on the table:
--   - Option 1: Skip Phase 3 entirely; role stays implied by household.
--   - Option 2: Unify `collective_members` to be the canonical roster.
--   - Option 3 (this migration): Make role explicit on the profile;
--     leave `collective_members` as the Solid-shaped WebID/Pod concept.
--
-- Option 2 was rejected because it would have diluted the one table
-- that already speaks Solid/Pod's language. Option 1 was rejected
-- because "role implied by which household you're in" subtly makes
-- the collective the source of truth about the person. Option 3 keeps
-- the seam clean between the local-database convenience layer
-- (profiles + collective_id) and the Solid-shaped future
-- (collective_members + WebIDs).
--
-- ## INTERIM-MODEL WARNING — read before extending this further
--
-- `profiles.role` is valid ONLY while membership is 1:1 (one collective
-- per profile, which is true today). The moment a person can belong to
-- more than one Collective — which the architecture is heading toward —
-- a scalar role column on `profiles` is wrong, because the same person
-- might be `owner` of their personal Collective and `member` of a
-- venture. The Solid-correct end state is role living on the membership
-- relation (person × collective × role).
--
-- When multi-collective membership lands (Phase 5 of Build Spec 1 or
-- later), promote `role` to the membership-relation table in the same
-- migration that introduces multi-collective. Drop `profiles.role` at
-- that point. Do NOT extend this interim further (e.g. don't add a
-- separate "context-specific" column on profiles).
--
-- ## IDENTITY-ATOM REMINDER
--
-- The WebID is the identity atom. `profiles` is the local-database
-- projection of a person. `profiles.id` is a convenience for local
-- queries — it is NOT the identity primitive. Any code reasoning that
-- treats `profiles.id` as "the person" is drifting from the Solid
-- alignment and needs correction. The leave-test for any future
-- membership/identity change: can the individual leave any Collective
-- and take their complete, intact context with them, with their
-- identity unbroken?
--
-- ## Idempotency
--
-- Drop existing CHECK constraint by name, re-add with extended enum.
-- Guarded by pg_constraint lookup so re-runs are safe.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_role_check'
      AND conrelid = 'profiles'::regclass
  ) THEN
    ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
  END IF;
END $$;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'owner',   -- collective creator / billing owner (Spec 1 §6); equivalent to collectives.primary_admin_profile_id today
    'admin',   -- collective administrator (existing); promote/demote, settings, member management
    'adult',   -- legal adult member (existing)
    'child',   -- legal minor member (existing)
    'member',  -- generic member, no special privilege (Spec 1 §6)
    'viewer'   -- read-only member (Spec 1 §6)
  ));

COMMENT ON COLUMN profiles.role IS
  'INTERIM: role in this profile''s single collective. Valid only while membership is 1:1. When multi-collective membership lands, role moves onto the membership relation (person × collective × role) — see migration 040 header. Enum: owner, admin, adult, child, member, viewer per Build Spec 1 §6.';
