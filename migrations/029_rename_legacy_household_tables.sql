-- 029_rename_legacy_household_tables.sql
--
-- Pre-Beta Stream 1 — ARCH-01 follow-up: rename the legacy
-- `household_members` table (and its dependent indexes / constraints /
-- columns) to the new "collective" vocabulary introduced by
-- migration 026 and ADR-002
-- (memu-platform/decisions/ADR-002-tenant-model-collectives-2026-05.md).
--
-- 026 created `collectives` (renamed from `households` in-place before
-- first commit). 027 added `collective_id` to ~30 tenant-scoped
-- tables. 028 enabled RLS using `memu.collective_id` and policy
-- names of the form `<table>_collective_isolation`. The legacy
-- `household_members` table (created in committed migration 014) was
-- referenced under its legacy name throughout 026–028 because 029
-- is the migration that actually renames it.
--
-- This migration is the final piece: rename `household_members` to
-- `collective_members`, rename the embedded-in-name indexes, the
-- auto-named CHECK constraints, the FK constraints, the PK, and the
-- column `household_admin_profile_id` → `collective_admin_profile_id`.
-- Also add the new `admin BOOLEAN` column per ADR-002 (replaces the
-- single primary_admin_profile_id pointer in `collectives` as the way
-- to capture multiple admins per collective; the existing
-- `collectives.primary_admin_profile_id` stays as the inviter pointer).
--
-- `household_settings` was NOT created in migration 014 (or anywhere
-- else in this repo as of 2026-05-10). The corresponding ALTER block
-- below is therefore a no-op guarded by a DO $$ existence check, and
-- exists so a future schema that DOES introduce `household_settings`
-- would be caught by re-running this migration after that introduction.
--
-- Idempotent throughout: every ALTER uses IF EXISTS / IF NOT EXISTS.
-- Postgres normal ALTER TABLE … RENAME semantics auto-update foreign
-- key references; FK constraint NAMES, however, are NOT auto-renamed
-- and must be ALTER TABLE … RENAME CONSTRAINT'd explicitly so a future
-- DBA reading `\d collective_members` sees consistent names.
--
-- A note on dependent FKs in other tables: `pod_grants.member_id` and
-- `external_space_cache.member_id` both `REFERENCES household_members(id)
-- ON DELETE CASCADE` (migrations 014 and 015 respectively). Postgres
-- updates the FK target reference automatically on RENAME TABLE — the
-- constraints continue to reference the same physical relation under
-- its new name. Verified by reading migration 015: there is no other
-- name-coupling between external_space_cache and household_members
-- besides the FK column. No explicit ALTER is required on those
-- dependent tables; their auto-named constraints
-- (pod_grants_member_id_fkey, external_space_cache_member_id_fkey)
-- continue to work without rename.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rename household_members → collective_members
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'household_members'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
  ) THEN
    EXECUTE 'ALTER TABLE household_members RENAME TO collective_members';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Rename the column household_admin_profile_id → collective_admin_profile_id
-- ---------------------------------------------------------------------------
--
-- Done before constraint/index renames below so the constraint
-- introspection (which references the renamed column in some auto-
-- generated names — Postgres does NOT rename FK constraint names on
-- column rename) is consistent for future readers.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'collective_members'
      AND column_name = 'household_admin_profile_id'
  ) THEN
    EXECUTE 'ALTER TABLE collective_members RENAME COLUMN household_admin_profile_id TO collective_admin_profile_id';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Rename indexes whose names embed household_members
-- ---------------------------------------------------------------------------
--
-- From migration 014:
--   uq_household_members_admin_webid     → uq_collective_members_admin_webid
--   idx_household_members_status         → idx_collective_members_status
-- From migration 027:
--   household_members_collective_id_idx  → collective_members_collective_id_idx
-- Auto-generated PK index from migration 014:
--   household_members_pkey               → collective_members_pkey
--
-- ALTER INDEX … RENAME TO is the right call here (not ALTER TABLE … RENAME
-- CONSTRAINT) because Postgres treats indexes as first-class objects in
-- their own namespace; the underlying PK constraint name follows.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uq_household_members_admin_webid') THEN
    EXECUTE 'ALTER INDEX uq_household_members_admin_webid RENAME TO uq_collective_members_admin_webid';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_household_members_status') THEN
    EXECUTE 'ALTER INDEX idx_household_members_status RENAME TO idx_collective_members_status';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'household_members_collective_id_idx') THEN
    EXECUTE 'ALTER INDEX household_members_collective_id_idx RENAME TO collective_members_collective_id_idx';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'household_members_pkey') THEN
    EXECUTE 'ALTER INDEX household_members_pkey RENAME TO collective_members_pkey';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Rename CHECK + FK constraints whose names embed household_members
-- ---------------------------------------------------------------------------
--
-- These names are auto-generated by Postgres when CHECK / FK clauses
-- are declared inline (migration 014 does not name them). Postgres
-- generates them as <table>_<column>_check / <table>_<column>_fkey
-- and they do NOT auto-rename on table or column rename. Renaming
-- here is purely so `\d collective_members` shows consistent names;
-- the constraint semantics are unaffected.
--
-- From migration 014's CHECK clauses:
--   household_members_status_check
--   household_members_leave_policy_for_emergent_check
-- From migration 014's FK clauses (inline REFERENCES):
--   household_members_household_admin_profile_id_fkey
--   household_members_internal_profile_id_fkey
--   household_members_invited_by_profile_id_fkey
-- From migration 027's FK clause (collective_id REFERENCES collectives):
--   household_members_collective_id_fkey

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_members_status_check'
      AND conrelid = (SELECT oid FROM pg_class WHERE relname = 'collective_members'
                        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()))
  ) THEN
    EXECUTE 'ALTER TABLE collective_members RENAME CONSTRAINT household_members_status_check TO collective_members_status_check';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_members_leave_policy_for_emergent_check'
      AND conrelid = (SELECT oid FROM pg_class WHERE relname = 'collective_members'
                        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()))
  ) THEN
    EXECUTE 'ALTER TABLE collective_members RENAME CONSTRAINT household_members_leave_policy_for_emergent_check TO collective_members_leave_policy_for_emergent_check';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_members_household_admin_profile_id_fkey'
      AND conrelid = (SELECT oid FROM pg_class WHERE relname = 'collective_members'
                        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()))
  ) THEN
    EXECUTE 'ALTER TABLE collective_members RENAME CONSTRAINT household_members_household_admin_profile_id_fkey TO collective_members_collective_admin_profile_id_fkey';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_members_internal_profile_id_fkey'
      AND conrelid = (SELECT oid FROM pg_class WHERE relname = 'collective_members'
                        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()))
  ) THEN
    EXECUTE 'ALTER TABLE collective_members RENAME CONSTRAINT household_members_internal_profile_id_fkey TO collective_members_internal_profile_id_fkey';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_members_invited_by_profile_id_fkey'
      AND conrelid = (SELECT oid FROM pg_class WHERE relname = 'collective_members'
                        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()))
  ) THEN
    EXECUTE 'ALTER TABLE collective_members RENAME CONSTRAINT household_members_invited_by_profile_id_fkey TO collective_members_invited_by_profile_id_fkey';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_members_collective_id_fkey'
      AND conrelid = (SELECT oid FROM pg_class WHERE relname = 'collective_members'
                        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()))
  ) THEN
    EXECUTE 'ALTER TABLE collective_members RENAME CONSTRAINT household_members_collective_id_fkey TO collective_members_collective_id_fkey';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Add `admin BOOLEAN` column to collective_members (ADR-002)
-- ---------------------------------------------------------------------------
--
-- Captures per-member admin status inside the collective. The existing
-- `collectives.primary_admin_profile_id` pointer remains as the
-- inviter/owner reference; this new column lets any number of
-- additional members be marked as admins (multi-admin households /
-- care-circles / friend-groups). Defaults to FALSE so existing rows
-- become non-admin members of their collective; promotion to admin
-- is an explicit application-level action.

ALTER TABLE collective_members
  ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN collective_members.admin IS
  'ADR-002: per-member admin flag inside the collective. The collectives.primary_admin_profile_id pointer remains as the inviter/owner; this column permits multiple admins.';

-- ---------------------------------------------------------------------------
-- 6. household_settings → collective_settings (if it exists)
-- ---------------------------------------------------------------------------
--
-- Migration 014 does NOT create a `household_settings` table — verified
-- by reading 014 (2026-05-10). No other migration in this repo creates
-- it either. The block below is a forward-compat no-op: it renames the
-- table and its embedded-in-name indexes/PK if a future migration ever
-- adds `household_settings` and this migration is re-applied. Today
-- the IF EXISTS guards short-circuit every statement and nothing
-- happens at runtime.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'household_settings'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
  ) THEN
    EXECUTE 'ALTER TABLE household_settings RENAME TO collective_settings';
    -- PK index follows table name by Postgres convention.
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'household_settings_pkey') THEN
      EXECUTE 'ALTER INDEX household_settings_pkey RENAME TO collective_settings_pkey';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Dependent FK references in other tables — verification note
-- ---------------------------------------------------------------------------
--
-- Verified by reading migrations 014 and 015:
--   * pod_grants.member_id REFERENCES household_members(id) ON DELETE CASCADE
--     (migration 014). FK auto-named pod_grants_member_id_fkey. Postgres
--     updates the FK target automatically when household_members is
--     renamed to collective_members; the constraint NAME is not coupled
--     to the target table name (the target table appears in pg_constraint
--     by oid, not by name) so no rename is needed. The constraint name
--     stays pod_grants_member_id_fkey, which still correctly identifies
--     the column on pod_grants, not the target table.
--
--   * external_space_cache.member_id REFERENCES household_members(id)
--     ON DELETE CASCADE (migration 015). Same story — FK auto-named
--     external_space_cache_member_id_fkey; Postgres re-targets the
--     constraint by oid when the parent table is renamed; no rename
--     needed.
--
-- No other tables reference household_members or household_settings.

COMMIT;
