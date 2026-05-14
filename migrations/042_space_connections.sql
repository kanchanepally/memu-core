-- migrations/042_space_connections.sql
--
-- Phase 6 of Build Spec 1 (memu-platform/files/build-spec-1-workspace-
-- architecture.md §9) — the connections layer. Persisted edges between
-- Spaces. Today's graph endpoint (src/api/spaces_graph.ts) re-derives
-- every edge in memory on each request, including the wikilink edges
-- that are a deterministic function of Space bodies. Phase 6 persists
-- those wikilink edges at write time so the graph view stops paying
-- the extraction cost per request — and so future semantic-proposal
-- edges (sub-phase 6.5, DEFERRED) have a home.
--
-- ## Schema decisions
--
-- - Canonical ordering enforced via CHECK (space_uri_a < space_uri_b).
--   The pair (A→B) and (B→A) collapse to one row. Connections are
--   undirected by design.
-- - `source_mechanism` enumerates how the edge was found. 'wikilink'
--   and 'manual' ship in this migration; 'proposed' (sub-phase 6.5)
--   is allowed in the enum so the table doesn't need re-migrating
--   when semantic proposals land.
-- - `confidence` is a numeric 0..1. Wikilinks ship at 1.0 (deterministic
--   extraction); manual ships at 1.0; proposed will carry the model's
--   similarity score when it lands.
-- - `status` distinguishes 'active' from 'dismissed'. A user-rejected
--   proposal becomes status='dismissed' and is never re-proposed (the
--   UNIQUE constraint includes source_mechanism so a re-extraction
--   collides on the dismissed row).
-- - Provenance columns (`source_message_id`, `source_skill`) are
--   nullable. Wikilink edges from upsertSpace leave them NULL (the
--   write itself carries no message context).
-- - last_seen_at refreshed on every wikilink upsert so the next
--   maintenance pass can age out stale links.
--
-- ## Hard invariant
--
-- A connection NEVER crosses a collective_id boundary. Both endpoints
-- must resolve to Spaces in the same collective. The schema enforces
-- "this row belongs to a collective" via the collective_id FK; the
-- application enforces "both endpoints belong to the same collective"
-- in the write path (Task 2 of this Phase + the manual endpoint in
-- Task 4). RLS makes the cross-collective case impossible by
-- construction — a SELECT against space_uri_b in another collective
-- returns zero rows from this session, so the resolution step that
-- would produce the cross-collective pair fails closed.
--
-- ## RLS pattern
--
-- New tenant-scoped table — follows the contract per
-- memu-core/CLAUDE.md and the projects table (migration 041):
--   - collective_id NOT NULL with session-var default
--   - ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY
--   - <table>_collective_isolation policy on collective_id match
--   - Conditional GRANT to memu_app (only when role exists — per
--     feedback-grant-memu-app-conditional memory from migration 041's
--     hotfix on 2026-05-15)
--
-- ## Idempotency
--
-- IF NOT EXISTS guards throughout; policy and RLS guarded by lookups
-- so re-runs are no-ops.

BEGIN;

SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- space_connections
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS space_connections (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  space_uri_a TEXT NOT NULL,
  space_uri_b TEXT NOT NULL,
  source_mechanism TEXT NOT NULL
    CHECK (source_mechanism IN ('wikilink', 'manual', 'proposed')),
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 1.00
    CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'dismissed')),
  source_message_id TEXT,
  source_skill TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Canonical pair ordering: the smaller URI is always space_uri_a.
  -- Prevents (A→B) and (B→A) from being stored as two rows.
  CONSTRAINT space_connections_canonical_order CHECK (space_uri_a < space_uri_b),

  -- Unique on (collective, pair, mechanism) — wikilink + manual on the
  -- same pair can co-exist (different mechanisms, different provenance).
  -- A re-extraction of an existing wikilink hits this row and refreshes
  -- last_seen_at via ON CONFLICT.
  UNIQUE (collective_id, space_uri_a, space_uri_b, source_mechanism)
);

CREATE INDEX IF NOT EXISTS space_connections_collective_a_idx
  ON space_connections (collective_id, space_uri_a);

CREATE INDEX IF NOT EXISTS space_connections_collective_b_idx
  ON space_connections (collective_id, space_uri_b);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE space_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_connections FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'space_connections'
      AND policyname = 'space_connections_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY space_connections_collective_isolation ON space_connections
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- Conditional GRANT — memu_app only exists on Hosted-tier deploys
-- (see feedback memory grant-memu-app-conditional from 2026-05-15).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memu_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON space_connections TO memu_app';
  END IF;
END $$;

COMMENT ON TABLE space_connections IS
  'Phase 6 of Build Spec 1. Persisted edges between Spaces within a single collective. Canonical-ordered pair (a < b) — undirected by design. Replaces per-request wikilink derivation in the graph view; carries manual links + the future "proposed" semantic edges (sub-phase 6.5, deferred). The hard invariant: a connection never crosses a collective_id boundary — RLS makes the cross-collective case unreachable by construction.';

COMMENT ON COLUMN space_connections.source_mechanism IS
  'How the edge was found. wikilink = deterministic [[target]] extraction at upsertSpace time. manual = user-created via /api/spaces/connections. proposed = semantic similarity (sub-phase 6.5, deferred — schema accepts it so 6.5 does not need to re-migrate).';

COMMENT ON COLUMN space_connections.status IS
  'active = edge is live. dismissed = user rejected this edge (only meaningful for proposed); the UNIQUE constraint on (collective, pair, mechanism) means a re-proposal collides on the dismissed row and is suppressed, so the user is never asked twice.';

COMMIT;
