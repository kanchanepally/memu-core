-- migrations/048_space_reading_state.sql
--
-- Build Spec 2 Phase Z Story Z.6b — per-(profile, space) reading state.
-- Records when a profile last opened a Space, how far through they got
-- (scroll-position fraction for markdown / page number for PDF /
-- elapsed-time fraction for audio — caller decides what the number
-- means; we just store and surface it), and whether they pinned it.
--
-- ## Why a sidecar, not columns on synthesis_pages
--
-- Reading state is per-USER, not per-Space. In a multi-profile
-- household (today: a research workspace shared between Hareesh and
-- Rach; future: a research group workspace) each member has their
-- own progress — Hareesh halfway through a paper Rach already
-- finished. Stacking last_read_at / read_progress / pinned_at as
-- columns on synthesis_pages would force per-Space writes to be
-- replaced by per-(profile, space) writes anyway, and would mix
-- a per-user concern into a per-Space row. Sidecar is the right
-- shape.
--
-- ## Composite primary key
--
-- (profile_id, space_id) is the natural key — every (member, Space)
-- pair has at most one reading state. UPSERTs use this for conflict
-- resolution. collective_id is denormalised onto the row so RLS can
-- scope cheaply (the alternative — JOIN to synthesis_pages to derive
-- collective_id — is slow and harder to RLS).
--
-- ## RLS pattern
--
-- New tenant-scoped table. Follows the contract per memu-core/CLAUDE.md
-- and the pattern from 041, 042, 043:
--   - collective_id NOT NULL with session-var default
--   - ENABLE + FORCE ROW LEVEL SECURITY
--   - collective_isolation policy on collective_id match
--   - GRANT to memu_app wrapped in pg_roles existence check
--     (memu_app exists only on Hosted-tier — feedback memory
--     grant-memu-app-conditional from 2026-05-15)
--
-- An additional per-profile read filter is NOT enforced at the RLS
-- layer — a household member could in theory read another member's
-- reading state for a shared Space within the same Collective. This
-- is privacy-acceptable (reading state is "I opened a paper", not
-- the content of memos) and read isolation can be tightened at the
-- application layer if a real need surfaces.
--
-- ## Idempotency
--
-- IF NOT EXISTS guards throughout; policy + GRANT guarded by lookups.
-- Safe to re-run on a populated schema.

BEGIN;

SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- space_reading_state
-- ---------------------------------------------------------------------------

-- profiles.id and synthesis_pages.id are both TEXT (gen_random_uuid()::text
-- per the original schema). The FK column types MUST match — declaring
-- profile_id/space_id as UUID here caused migration 048 to fail with
-- "foreign key constraint cannot be implemented: incompatible types"
-- on first deploy. TEXT for all three id columns; we keep the values
-- looking like UUIDs because gen_random_uuid()::text is what the FK
-- targets generate.
CREATE TABLE IF NOT EXISTS space_reading_state (
  profile_id TEXT NOT NULL
    REFERENCES profiles(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL
    REFERENCES synthesis_pages(id) ON DELETE CASCADE,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_progress REAL NOT NULL DEFAULT 0
    CHECK (read_progress >= 0 AND read_progress <= 1),
  pinned_at TIMESTAMPTZ,
  PRIMARY KEY (profile_id, space_id)
);

-- Index for the "what did this user read recently in this Collective?"
-- query — Continue-reading affordance on the Spaces tab home.
CREATE INDEX IF NOT EXISTS space_reading_state_profile_recent_idx
  ON space_reading_state (profile_id, collective_id, last_read_at DESC);

-- Index for the "what's pinned in this Collective?" query — pin
-- surface for later (Story R7 timeline / power-user filter). Partial
-- index so it costs nothing on unpinned rows.
CREATE INDEX IF NOT EXISTS space_reading_state_pinned_idx
  ON space_reading_state (profile_id, collective_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE space_reading_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_reading_state FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'space_reading_state'
      AND policyname = 'space_reading_state_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY space_reading_state_collective_isolation ON space_reading_state
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- Conditional GRANT — memu_app only exists on Hosted-tier deploys.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memu_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON space_reading_state TO memu_app';
  END IF;
END $$;

COMMENT ON TABLE space_reading_state IS
  'Build Spec 2 Phase Z Story Z.6b. Per-(profile, space) reading state — last opened, scroll/page progress, pin. Sidecar to synthesis_pages because reading state is per-USER, not per-Space; a household member''s progress through a paper is theirs alone.';

COMMENT ON COLUMN space_reading_state.read_progress IS
  '0.0 to 1.0. Caller-defined semantics — scroll-position fraction for markdown, page-number fraction for PDF, elapsed-time fraction for audio. Z.6b ships the column; the wiring that updates it as a user scrolls / pages through is deferred to a follow-up. Today (Z.6b first slice) every recordRead() sets progress to its current persisted value (no-op) — the affordance is just "recently opened".';

COMMIT;
