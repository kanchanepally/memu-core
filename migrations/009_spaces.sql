-- Story 2.1 — Spaces: extend synthesis_pages with the frontmatter fields
-- that the compiled-understanding architecture needs (URI identifiers,
-- domains, people, visibility, description, confidence). Add the
-- append-only change log that mirrors the _log.md on disk. Extend the
-- stream_cards.card_type CHECK for the reflection finding types that
-- Story 2.2 emits.
--
-- Identifiers follow memu://<family_id>/<category>/<uuid>. The slug is
-- for filesystem ergonomics only; references between pages go through
-- the URI so renames don't break links.

ALTER TABLE synthesis_pages
  ADD COLUMN IF NOT EXISTS uri TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS family_id TEXT,
  ADD COLUMN IF NOT EXISTS domains TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS people TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'family',
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS source_references TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Backfill family_id and URI on any existing rows. Single-family
-- convention today: family_id = primary adult's profile_id. The primary
-- adult is whichever admin row exists on the profiles table; if there
-- isn't one yet, fall back to the page's own profile_id.
UPDATE synthesis_pages sp
   SET family_id = COALESCE(
         sp.family_id,
         (SELECT p.id FROM profiles p WHERE p.role = 'admin' ORDER BY p.created_at ASC LIMIT 1),
         sp.profile_id
       )
 WHERE sp.family_id IS NULL;

UPDATE synthesis_pages
   SET slug = COALESCE(
         slug,
         LOWER(REGEXP_REPLACE(title, '[^a-zA-Z0-9]+', '-', 'g'))
       )
 WHERE slug IS NULL;

UPDATE synthesis_pages
   SET uri = 'memu://' || family_id || '/' || category || '/' || id
 WHERE uri IS NULL;

ALTER TABLE synthesis_pages
  ALTER COLUMN uri SET NOT NULL,
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN family_id SET NOT NULL;

-- Expand the allowed category set to match the Story 2.1 spec.
-- Drop the old CHECK if present, then re-add with the full list.
ALTER TABLE synthesis_pages DROP CONSTRAINT IF EXISTS synthesis_pages_category_check;
ALTER TABLE synthesis_pages
  ADD CONSTRAINT synthesis_pages_category_check
  CHECK (category IN ('person', 'routine', 'household', 'commitment', 'document'));

ALTER TABLE synthesis_pages
  ADD CONSTRAINT synthesis_pages_visibility_check
  CHECK (visibility IN ('family', 'individual', 'adults_only', 'partners_only', 'private'))
  NOT VALID;
ALTER TABLE synthesis_pages VALIDATE CONSTRAINT synthesis_pages_visibility_check;

CREATE UNIQUE INDEX IF NOT EXISTS idx_synthesis_pages_uri ON synthesis_pages(uri);
CREATE UNIQUE INDEX IF NOT EXISTS idx_synthesis_pages_family_slug
  ON synthesis_pages(family_id, category, slug);
CREATE INDEX IF NOT EXISTS idx_synthesis_pages_family
  ON synthesis_pages(family_id, category);

-- Append-only log of Space changes per family. Mirrors spaces/<family>/_log.md
-- on disk. Kept in Postgres so reflection can query recent activity.
CREATE TABLE IF NOT EXISTS spaces_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  family_id TEXT NOT NULL,
  space_uri TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('created', 'updated', 'renamed', 'split', 'merged', 'deleted', 'query_served')),
  summary TEXT NOT NULL,
  actor_profile_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spaces_log_family ON spaces_log(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spaces_log_uri ON spaces_log(space_uri, created_at DESC);

-- Reflection finding idempotency. A daily or weekly reflection pass
-- may notice the same thing across consecutive runs; dedupe on a
-- stable hash of (kind, space_uris, title) so we don't double-card.
CREATE TABLE IF NOT EXISTS reflection_findings (
  finding_hash TEXT NOT NULL,
  family_id TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('per_message', 'daily', 'weekly')),
  kind TEXT NOT NULL CHECK (kind IN ('contradiction', 'stale_fact', 'unfinished_business', 'pattern')),
  stream_card_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (family_id, finding_hash)
);

-- Extend stream_cards.card_type with the reflection finding types and
-- pre-seed the Story 2.3 care_standard_lapsed type so that story only
-- needs a table + logic, not another CHECK migration.
ALTER TABLE stream_cards DROP CONSTRAINT IF EXISTS stream_cards_card_type_check;
ALTER TABLE stream_cards
  ADD CONSTRAINT stream_cards_card_type_check
  CHECK (card_type IN (
    'collision', 'extraction', 'unfinished_business',
    'reminder', 'document_extracted', 'calendar_added',
    'proactive_nudge', 'weekly_digest',
    'contradiction', 'stale_fact', 'pattern', 'care_standard_lapsed',
    'shopping'
  ));

-- Family-level settings. Today a "family" = the primary adult's profile
-- id, so the row keys off that. When a proper families table lands
-- (Phase 3 portability), this FK target moves; the columns don't change.
CREATE TABLE IF NOT EXISTS family_settings (
  family_id TEXT PRIMARY KEY,
  reflection_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reflection_daily_hour INT NOT NULL DEFAULT 3,
  reflection_weekly_dow INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
