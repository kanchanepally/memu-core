-- migrations/039_collectives_type_enum.sql
--
-- Phase 2 of Build Spec 1 (memu-platform/files/build-spec-1-workspace-
-- architecture.md §5) — adapted per the 2026-05-14 vocabulary decision:
-- keep the `collectives` table (ARCH-01 already shipped that rename),
-- adopt Spec 1's type-enum values via a CHECK constraint, add the
-- spec's `parent_workspace_id` column as `parent_collective_id`.
--
-- ## Two adjustments vs the verbatim spec
--
-- 1. Spec 1's enum is ['personal','family','work','project','research',
--    'community']. We include 'household' as a seventh value because
--    every existing collective on the Z2 deployment carries
--    type='household' (migration 026 default + ADR-002 vocabulary).
--    Dropping 'household' would invalidate the existing data and force
--    a re-label that doesn't change product semantics.
--
-- 2. Spec 1 calls the FK column `parent_workspace_id`. We use
--    `parent_collective_id` to match the schema's existing vocabulary.
--    Per Spec 1 §2.4, the column "exists only so a future organisation-
--    shaped customer composes without a re-migration. No code reads it.
--    No code writes it." Same rule applies here.
--
-- ## Behaviour neutrality
--
-- Existing rows on Z2 all have type='household' (migration 026 default).
-- 'household' is in the new CHECK enum, so the constraint validates
-- without touching the existing row's value. The new column is nullable
-- with no default and no code reads it — its presence does not change
-- any query plan or any application path.
--
-- ## Why no NOT VALID → VALIDATE pattern
--
-- The build-spec working principles call out the NOT VALID → VALIDATE
-- pattern for FOREIGN KEYS added to populated tables. We're adding a
-- CHECK (existing rows already match the enum) and a NULLABLE FK on a
-- newly-added column (no existing values to validate). Neither needs
-- the deferred-validation dance.
--
-- ## Idempotency
--
-- ALTER TABLE ... ADD CONSTRAINT lacks IF NOT EXISTS in older Postgres;
-- guarded with DO $$ + pg_constraint lookup. ADD COLUMN IF NOT EXISTS
-- is straight Postgres 16. Re-running this migration is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collectives_type_check'
      AND conrelid = 'collectives'::regclass
  ) THEN
    ALTER TABLE collectives
      ADD CONSTRAINT collectives_type_check
      CHECK (type IN (
        'household',  -- existing default (migration 026); shared homes / co-living
        'personal',   -- single-person workspace, auto-created on profile registration (Spec 1 §8 Story 5.2)
        'family',     -- relatives across households (subset/superset of household)
        'work',       -- professional team / colleagues
        'project',    -- time-bound effort with mixed membership
        'research',   -- research workspace; gets the research category set (Build Spec 2)
        'community'   -- open group, club, interest community
      ));
  END IF;
END $$;

ALTER TABLE collectives
  ADD COLUMN IF NOT EXISTS parent_collective_id TEXT NULL
    REFERENCES collectives(id);

COMMENT ON COLUMN collectives.type IS
  'Workspace shape per Build Spec 1 + ADR-002. Allowed values: household (default), personal, family, work, project, research, community. RLS does not key on type — tenant isolation is by collective_id alone.';

COMMENT ON COLUMN collectives.parent_collective_id IS
  'Forward compatibility for organisation-shaped customers (e.g. a school with classrooms). NULL today on every row. No code reads or writes it in Build Spec 1 — added now so a future composition does not need a re-migration.';
