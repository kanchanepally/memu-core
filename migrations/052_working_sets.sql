-- migrations/052_working_sets.sql
--
-- Build Spec 3 Phase W2 — Working Sets.
--
-- A Working Set is a NAMED, ORDERED collection of artefact references
-- (Spaces — memos / quotes / codes / questions / connections) that a
-- researcher assembles when preparing to write. *"These 15 artefacts
-- go into the section on graded inequality."* The set then feeds
-- into a Writing Space (W3) via writing_spaces.working_set_id.
--
-- ## Schema decisions
--
-- - `working_sets` is the parent — name + optional description +
--   owner_profile_id + optional feeds_into_writing_space_id (set when
--   a Writing Space is started from the set).
-- - `working_set_items` is the children — artefact_space_uri + an
--   ordered index + an optional per-item note ("opens with the
--   cookie-banner thing"). UNIQUE on (working_set_id,
--   artefact_space_uri) prevents accidental duplicate adds.
-- - `artefact_space_uri` references synthesis_pages.uri (the stable
--   identifier from migration 042's pattern) rather than the integer
--   id, so a Space rename / re-slug doesn't orphan the set.
-- - order_index is INTEGER, default 0; the application maintains
--   strict ordering via re-numbering on insert / drag-reorder. No
--   constraint enforces uniqueness of order_index — float-style
--   gaps are allowed during interactive reorder.
--
-- ## Cascade behaviour
--
-- - Deleting a working_set deletes its items (CASCADE).
-- - Deleting a writing_space NULLs out the feeds_into pointer on any
--   set that referenced it (SET NULL) — the set survives so the user
--   can re-link it to a different Writing Space. The set's items
--   stay.
-- - The artefact_space_uri does NOT cascade — if a Space is deleted
--   the working_set_items row stays as a tombstone (the application
--   shows "deleted artefact" rather than dropping the item silently).
--   This is deliberate: a Working Set is the researcher's curated
--   intent, and silent deletion would erase that intent without
--   their knowledge.
--
-- ## Tenant scoping (per memu-core CLAUDE.md)
--
-- Both new tables follow the standard discipline: collective_id NOT
-- NULL with session-var default, RLS enabled + FORCED, isolation
-- policy on collective_id match, conditional GRANT to memu_app.

BEGIN;

SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- working_sets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS working_sets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id),
  -- Optional link to a Writing Space started from this set. Nullable
  -- because a set can exist before any writing happens. Set when the
  -- user clicks "Start Writing Space from this set" (W3); cleared
  -- (SET NULL) if the Writing Space is later deleted so the user
  -- can re-link.
  feeds_into_writing_space_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS working_sets_collective_idx
  ON working_sets (collective_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS working_sets_owner_idx
  ON working_sets (collective_id, owner_profile_id);

ALTER TABLE working_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE working_sets FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'working_sets'
      AND policyname = 'working_sets_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY working_sets_collective_isolation ON working_sets
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- working_set_items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS working_set_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  working_set_id TEXT NOT NULL REFERENCES working_sets(id) ON DELETE CASCADE,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  -- artefact_space_uri — references synthesis_pages.uri (stable
  -- identifier surviving Space rename/re-slug). NOT enforced by FK
  -- because synthesis_pages.uri isn't a primary key; the application
  -- enforces existence at insert time and tolerates dangling URIs as
  -- tombstones (renders "deleted artefact" in the UI).
  artefact_space_uri TEXT NOT NULL,
  -- Optional per-item annotation. Captures WHY this artefact is in
  -- the set — becomes the seed for draft_grounding (W7) when the
  -- user asks the agent to draft a paragraph against this set.
  note TEXT NOT NULL DEFAULT '',
  -- 0-based ordering within the set. The application re-numbers on
  -- reorder. No uniqueness constraint — interactive reorder uses
  -- float-style gaps (insert between 1 and 2 as 1.5, then re-pack
  -- on save). Stored as INT today; if interactive reorder needs
  -- mid-insert without re-pack, this becomes NUMERIC.
  order_index INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (working_set_id, artefact_space_uri)
);

CREATE INDEX IF NOT EXISTS working_set_items_set_order_idx
  ON working_set_items (working_set_id, order_index);

CREATE INDEX IF NOT EXISTS working_set_items_collective_idx
  ON working_set_items (collective_id);

ALTER TABLE working_set_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE working_set_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'working_set_items'
      AND policyname = 'working_set_items_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY working_set_items_collective_isolation ON working_set_items
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- Conditional GRANTs — memu_app only exists on Hosted-tier deploys
-- (per feedback memory grant-memu-app-conditional from 2026-05-15).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memu_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON working_sets TO memu_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON working_set_items TO memu_app';
  END IF;
END $$;

COMMENT ON TABLE working_sets IS
  'BS3 Phase W2 — a named, ordered collection of artefact refs (Spaces) assembled by a researcher when preparing to write. Bridge from Workbench to Writing Space (W3). The application enforces strict ordering on items; the schema accepts loose order_index values for interactive reorder.';

COMMENT ON TABLE working_set_items IS
  'BS3 Phase W2 — items in a working_set. artefact_space_uri references synthesis_pages.uri (stable identifier) without a hard FK so a Space rename/re-slug does not orphan the item. Application tolerates dangling URIs as tombstones rather than silently dropping them — preserves the researcher curated intent.';

COMMIT;
