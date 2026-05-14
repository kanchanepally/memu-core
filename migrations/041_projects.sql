-- migrations/041_projects.sql
--
-- Phase 4 of Build Spec 1 (memu-platform/files/build-spec-1-workspace-
-- architecture.md §7) — adapted per the 2026-05-14 vocabulary decision:
-- "workspace" reads as "collective" throughout.
--
-- ## What this introduces
--
-- A `projects` table (per-collective lightweight grouping; project IS
-- a filter, NOT a separate context pool) + a nullable `project_id`
-- column on `synthesis_pages` so Spaces can optionally belong to a
-- project.
--
-- ## Hard invariant
--
-- A project belongs to exactly one collective. A Space's project_id
-- (when set) must reference a project in the SAME collective. The
-- schema enforces "project belongs to one collective" via FK; the
-- application enforces "same collective" in the Space write path
-- (Task 2 of this Phase). RLS enforces "you can only see this
-- collective's projects" at the database layer.
--
-- ## RLS pattern
--
-- New tenant-scoped table — follows the multi-tenancy contract per
-- memu-core/CLAUDE.md:
--   - collective_id NOT NULL with DEFAULT from session variable
--   - ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY
--   - <table>_collective_isolation policy on collective_id match
--   - Covering index on collective_id (here: the UNIQUE on
--     (collective_id, slug) already covers it)
--
-- ## Idempotency
--
-- IF NOT EXISTS on the table, indexes, and column. The policy + RLS
-- enables are guarded with DO $$ pg_policies / pg_class lookups.

BEGIN;

SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (collective_id, slug)
);

CREATE INDEX IF NOT EXISTS projects_collective_status_idx
  ON projects (collective_id, status);

-- ---------------------------------------------------------------------------
-- RLS — same pattern as migration 028 for every other tenant table
-- ---------------------------------------------------------------------------

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'projects'
      AND policyname = 'projects_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY projects_collective_isolation ON projects
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO memu_app;

COMMENT ON TABLE projects IS
  'Phase 4 of Build Spec 1. Lightweight grouping inside a collective. A project is a FILTER over the collective''s one shared pool — not a separate context pool. Several projects in a collective share its members, anonymisation registry, and knowledge graph by design.';

COMMENT ON COLUMN projects.collective_id IS
  'The collective this project belongs to. A project never crosses collectives. Defaulted from memu.collective_id session var via the standard new-tenant-table pattern.';

-- ---------------------------------------------------------------------------
-- synthesis_pages.project_id — nullable; NULL means "collective-level Space"
-- ---------------------------------------------------------------------------

ALTER TABLE synthesis_pages
  ADD COLUMN IF NOT EXISTS project_id TEXT NULL
    REFERENCES projects(id);

-- Index on (collective_id, project_id) for the project filter in retrieval.
-- Partial WHERE excludes NULLs to keep the index small — collective-level
-- Spaces don't need a project_id-keyed lookup.
CREATE INDEX IF NOT EXISTS synthesis_pages_collective_project_idx
  ON synthesis_pages (collective_id, project_id)
  WHERE project_id IS NOT NULL;

COMMENT ON COLUMN synthesis_pages.project_id IS
  'Phase 4: optional project membership. NULL means collective-level Space (the default; most Spaces are not project-scoped). When set, MUST reference a project in the same collective — application enforces this in upsertSpace, FK enforces "project exists".';

COMMIT;
