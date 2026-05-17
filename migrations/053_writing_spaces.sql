-- migrations/053_writing_spaces.sql
--
-- Build Spec 3 Phase W3 + W6 — Writing Spaces (new first-class
-- top-level object), version history, citation rows, artefact-uses
-- back-refs, export logging.
--
-- ## Why a new top-level object, not a Space subtype
--
-- BS3 §2.2 — long-form has properties that don't fit gracefully into
-- a Space's body_markdown column:
--
--   - versions (every save creates a recoverable snapshot)
--   - typed citation rows (structural provenance, not free-text)
--   - status lifecycle (drafting / revising / ready_to_publish /
--     published) with publish-time side effects
--   - export targets (multiple renders of the same source)
--
-- Adding all that to synthesis_pages would muddy the Space model.
-- writing_spaces is its own table, with its own RLS, its own
-- lifecycle. Citations live in writing_space_citations as typed
-- references to artefact Spaces — provenance is structural and
-- can't drift to free-text.
--
-- ## Tables in this migration
--
-- 1. writing_spaces           — the live draft
-- 2. writing_space_versions   — append-only revision history
-- 3. writing_space_citations  — typed refs from draft → artefact
-- 4. artefact_uses            — back-ref: which Writing Spaces use
--                               this artefact (compounding hook)
-- 5. writing_space_exports    — log of every export action

BEGIN;

SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- 1. writing_spaces
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS writing_spaces (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  title TEXT NOT NULL,
  -- Output template — drives default citation style, default export
  -- targets, and (later) section scaffolds. Not enforced as enum so
  -- BS3's "additive templates" architecture can extend without a
  -- migration.
  template TEXT NOT NULL DEFAULT 'essay',
  -- Live draft body. Markdown extensions same as Phase Z reading
  -- surface (markdown-it + plugins). Citations are inserted as
  -- structured HTML comments: `<!-- cite:CITATION_ID -->` paired
  -- with a footnote reference like `[^c1]`. Detail in
  -- docs/CITATION-FORMAT.md (deferred — write before W6 export).
  body_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'drafting'
    CHECK (status IN ('drafting', 'revising', 'ready_to_publish', 'published', 'archived')),
  -- Optional link to the Working Set this draft was started from.
  -- NULL = ad-hoc draft (user clicked "New Writing Space" without
  -- assembling a set first). SET NULL on working_set delete so the
  -- draft survives even if the set is removed.
  working_set_id TEXT REFERENCES working_sets(id) ON DELETE SET NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS writing_spaces_collective_idx
  ON writing_spaces (collective_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS writing_spaces_owner_idx
  ON writing_spaces (collective_id, owner_profile_id);
CREATE INDEX IF NOT EXISTS writing_spaces_status_idx
  ON writing_spaces (collective_id, status);
CREATE INDEX IF NOT EXISTS writing_spaces_working_set_idx
  ON writing_spaces (collective_id, working_set_id)
  WHERE working_set_id IS NOT NULL;

ALTER TABLE writing_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_spaces FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'writing_spaces'
      AND policyname = 'writing_spaces_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY writing_spaces_collective_isolation ON writing_spaces
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- Backfill the working_sets → writing_spaces FK now that the table
-- exists. (Migration 052 created the column without an FK because
-- writing_spaces didn't exist yet.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'working_sets_feeds_into_fk'
  ) THEN
    ALTER TABLE working_sets
      ADD CONSTRAINT working_sets_feeds_into_fk
      FOREIGN KEY (feeds_into_writing_space_id)
      REFERENCES writing_spaces(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. writing_space_versions
-- ---------------------------------------------------------------------------
--
-- Append-only revision history. Every save creates a new row.
-- Recovery surface: "View version N" / "Restore version N" / "Diff
-- against current". No auto-prune — storage is cheap; revision
-- history is priceless for a draft you've worked on for weeks.

CREATE TABLE IF NOT EXISTS writing_space_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  writing_space_id TEXT NOT NULL REFERENCES writing_spaces(id) ON DELETE CASCADE,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  version_number INTEGER NOT NULL,
  body_markdown TEXT NOT NULL,
  -- Optional caption — populated when the save action carries one
  -- ("End of draft pass 2"), else NULL. Application doesn't surface
  -- unless populated.
  changes_summary TEXT,
  saved_by_profile_id TEXT NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (writing_space_id, version_number)
);

CREATE INDEX IF NOT EXISTS writing_space_versions_space_idx
  ON writing_space_versions (writing_space_id, version_number DESC);
CREATE INDEX IF NOT EXISTS writing_space_versions_collective_idx
  ON writing_space_versions (collective_id);

ALTER TABLE writing_space_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_space_versions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'writing_space_versions'
      AND policyname = 'writing_space_versions_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY writing_space_versions_collective_isolation ON writing_space_versions
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. writing_space_citations
-- ---------------------------------------------------------------------------
--
-- Typed reference from a position in the draft to an artefact Space.
-- The body_markdown contains a placeholder (`<!-- cite:UUID -->` +
-- a footnote anchor `[^c1]`); this table holds the actual link.
-- Render-time replacement of the placeholder + footnote anchor with
-- target-specific formatting happens in the export pipeline (W6).

CREATE TABLE IF NOT EXISTS writing_space_citations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  writing_space_id TEXT NOT NULL REFERENCES writing_spaces(id) ON DELETE CASCADE,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  -- Stable identifier of the cited artefact — synthesis_pages.uri
  -- (memu://...). Not FK'd because synthesis_pages.uri isn't a PK;
  -- the application validates existence at insert.
  artefact_space_uri TEXT NOT NULL,
  -- Optional passage_id within the cited artefact (when the
  -- artefact has internal passage refs — the Phase Z reading
  -- surface emits pid:p7a3 style ids). NULL when citing the whole
  -- artefact.
  passage_id TEXT,
  -- Character offset into body_markdown — where the citation is
  -- anchored. Used by W4 citation_typeahead to find the "cursor
  -- context" without re-scanning the whole draft.
  position_in_draft INTEGER NOT NULL DEFAULT 0,
  -- SHA-1 hex of the 200 characters surrounding position_in_draft
  -- at insertion time. W6 export checks this against the current
  -- surrounding context; a mismatch flags the citation as
  -- potentially drifted ("review before export?").
  surrounding_hash TEXT NOT NULL DEFAULT '',
  -- Optional override of the draft's default citation format for
  -- THIS specific citation. NULL = use draft's template default.
  citation_format TEXT
    CHECK (citation_format IS NULL OR citation_format IN ('footnote', 'inline', 'parenthetical', 'author_date')),
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS writing_space_citations_space_idx
  ON writing_space_citations (writing_space_id, position_in_draft);
CREATE INDEX IF NOT EXISTS writing_space_citations_collective_idx
  ON writing_space_citations (collective_id);
CREATE INDEX IF NOT EXISTS writing_space_citations_artefact_idx
  ON writing_space_citations (collective_id, artefact_space_uri);

ALTER TABLE writing_space_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_space_citations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'writing_space_citations'
      AND policyname = 'writing_space_citations_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY writing_space_citations_collective_isolation ON writing_space_citations
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. artefact_uses  (the compounding hook)
-- ---------------------------------------------------------------------------
--
-- When a Writing Space transitions to `published`, the application
-- writes one artefact_uses row per cited artefact. The artefact's
-- detail view (Spaces tab) then shows "Used in: [Writing Space
-- title] (status, published_at)". The corpus compounds: an artefact
-- accumulates evidence of its own usefulness over time.
--
-- One row per (artefact, writing_space, citation_id) triple so a
-- single artefact cited multiple times in one piece registers as
-- multiple uses — useful for the eventual "this artefact has been
-- cited 7 times across 3 pieces" surface.

CREATE TABLE IF NOT EXISTS artefact_uses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  artefact_space_uri TEXT NOT NULL,
  writing_space_id TEXT NOT NULL REFERENCES writing_spaces(id) ON DELETE CASCADE,
  citation_id TEXT REFERENCES writing_space_citations(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (artefact_space_uri, writing_space_id, citation_id)
);

CREATE INDEX IF NOT EXISTS artefact_uses_artefact_idx
  ON artefact_uses (collective_id, artefact_space_uri, used_at DESC);
CREATE INDEX IF NOT EXISTS artefact_uses_writing_space_idx
  ON artefact_uses (collective_id, writing_space_id);

ALTER TABLE artefact_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE artefact_uses FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'artefact_uses'
      AND policyname = 'artefact_uses_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY artefact_uses_collective_isolation ON artefact_uses
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. writing_space_exports
-- ---------------------------------------------------------------------------
--
-- Audit log of every export action. The pre-publish discipline (BS3
-- §2.7) is preview-then-commit; this row is written when the
-- commit action fires (download / copy-to-clipboard / direct-publish
-- via API). Recoverable when the published version diverges from
-- the captured one (the hash lets you spot it).

CREATE TABLE IF NOT EXISTS writing_space_exports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  writing_space_id TEXT NOT NULL REFERENCES writing_spaces(id) ON DELETE CASCADE,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  -- One of: markdown / substack / docx / latex / pandoc / bibtex / print
  target TEXT NOT NULL,
  exported_by_profile_id TEXT NOT NULL REFERENCES profiles(id),
  -- SHA-256 hex of the exported byte stream. Lets a later "is the
  -- live Substack page still what we exported" check work.
  content_hash TEXT NOT NULL DEFAULT '',
  -- Snapshot of which version was active at export time.
  version_number INTEGER NOT NULL DEFAULT 1,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS writing_space_exports_space_idx
  ON writing_space_exports (writing_space_id, exported_at DESC);
CREATE INDEX IF NOT EXISTS writing_space_exports_collective_idx
  ON writing_space_exports (collective_id);

ALTER TABLE writing_space_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_space_exports FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'writing_space_exports'
      AND policyname = 'writing_space_exports_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY writing_space_exports_collective_isolation ON writing_space_exports
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Conditional GRANTs
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memu_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON writing_spaces TO memu_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON writing_space_versions TO memu_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON writing_space_citations TO memu_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON artefact_uses TO memu_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON writing_space_exports TO memu_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE writing_spaces IS
  'BS3 Phase W3 — first-class writing surface (essay, paper, substack article, etc.). Lives alongside synthesis_pages (which holds artefact Spaces — memos/quotes/codes/questions/connections). Long-form properties (versions, typed citations, status lifecycle, export targets) that would muddy synthesis_pages get a dedicated home here.';
COMMENT ON TABLE writing_space_versions IS
  'BS3 Phase W3 — append-only revision history. Every save creates a row. No auto-prune.';
COMMENT ON TABLE writing_space_citations IS
  'BS3 Phase W3 — typed references from a position in a draft to an artefact Space. Provenance is structural — no free-text citation field. surrounding_hash tracks context drift so W6 export can flag stale citations.';
COMMENT ON TABLE artefact_uses IS
  'BS3 §2.6 — the compounding hook. Written when a Writing Space transitions to published. Artefact detail view surfaces "Used in: [Writing Space title]" so the researcher sees their own corpus accumulating evidence of usefulness.';
COMMENT ON TABLE writing_space_exports IS
  'BS3 Phase W6 — log of every export action (markdown / substack / docx / latex / pandoc / bibtex / print). Recoverable when published version diverges from captured one.';

COMMIT;
