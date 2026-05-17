-- migrations/051_workbench.sql
--
-- Build Spec 3 Phase W1 — Workbench foundations.
--
-- Two changes:
--
-- 1. Extend space_connections with `relationship_type` so a typed
--    Connection (the 5th first-class artefact type from BS3 §2.5) can
--    name HOW two Spaces relate, not just THAT they relate. Wikilink
--    edges keep NULL (they're untyped references); manual + proposed
--    edges from connection_suggester gain a relationship_type from the
--    BS3-defined set: supports / contradicts / extends / exemplifies /
--    motivates / answers / references.
--
-- 2. New `agent_dismissals` table so the team-lead orchestration layer
--    (BS3 §2.8) can avoid re-surfacing proposals the user already
--    dismissed. Tenant-scoped — dismissals stay inside the workspace
--    they were created in. Includes a `reactivate_after` field so a
--    dismissal can be set to "don't show for 30 days then try again"
--    (the BS3-default for dismissed connection suggestions). NULL =
--    forever.
--
-- ## What this migration deliberately doesn't add
--
-- The `space_connections.created_by_agent` field named in BS3 §2.5 is
-- already covered by the existing `source_skill` column (migration
-- 042) — same shape, same semantics. Adding a parallel column would
-- be a regression in disguise. The existing `confidence` column on
-- space_connections already covers BS3's "confidence on the typed
-- relationship", so no addition there either.
--
-- The artefact_uses + code_cooccurrence + working_sets tables from
-- BS3 §5 are for later phases (W2 / enrichment loop) and are NOT in
-- this migration — Phase W1 ships the Workbench and corpus_query
-- alone.

BEGIN;

SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- 1. space_connections.relationship_type
-- ---------------------------------------------------------------------------

ALTER TABLE space_connections
  ADD COLUMN IF NOT EXISTS relationship_type TEXT;

-- NULL is allowed (wikilink edges don't carry a relationship type;
-- they're "this body mentions that body" untyped references). A typed
-- value must come from the BS3 vocabulary.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'space_connections_relationship_type_check'
  ) THEN
    ALTER TABLE space_connections
      ADD CONSTRAINT space_connections_relationship_type_check
      CHECK (
        relationship_type IS NULL
        OR relationship_type IN (
          'supports',
          'contradicts',
          'extends',
          'exemplifies',
          'motivates',
          'answers',
          'references'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN space_connections.relationship_type IS
  'BS3 §2.5 typed-connection vocabulary. NULL = untyped (wikilink edges); otherwise one of supports / contradicts / extends / exemplifies / motivates / answers / references. Manual connections may set it; the connection_suggester agent (W1) sets it on every proposal it surfaces.';

-- ---------------------------------------------------------------------------
-- 2. agent_dismissals
-- ---------------------------------------------------------------------------
--
-- A dismissal records "the user said no to this proposal from this
-- agent involving these artefacts". The team-lead orchestrator (W1
-- ships a minimal version; W5 ships the full one) checks this table
-- before re-running an agent so dismissed proposals don't return.
--
-- Schema notes:
--
-- - `artefact_refs` is a stable identifier set for the proposal — for
--   connection_suggester this is the [space_uri_a, space_uri_b] pair;
--   for future agents (contradiction_finder, theme_finder) it's the
--   ordered list of artefacts the proposal involved. Stored as text[]
--   for set-equality matching at lookup time.
-- - `dismissal_reason` is optional free-text (UI rarely collects it
--   today; reserved for "tell me why" affordances in future slices).
-- - `reactivate_after` lets a dismissal expire — null = forever.
--   Default behaviour is set by the agent at dismissal time, not by
--   schema (e.g. connection_suggester defaults to 30 days; tension
--   finder defaults to forever).

CREATE TABLE IF NOT EXISTS agent_dismissals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collective_id TEXT NOT NULL
    REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), ''),
  agent_name TEXT NOT NULL,
  artefact_refs TEXT[] NOT NULL,
  dismissal_reason TEXT,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reactivate_after TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_dismissals_collective_agent_idx
  ON agent_dismissals (collective_id, agent_name);

-- Lookup by the artefact_refs array — for a given agent + workspace,
-- "is this proposal already dismissed?" runs as an array overlap
-- against rows where reactivate_after is null OR in the future.
CREATE INDEX IF NOT EXISTS agent_dismissals_refs_gin_idx
  ON agent_dismissals USING GIN (artefact_refs);

-- ---------------------------------------------------------------------------
-- RLS for agent_dismissals
-- ---------------------------------------------------------------------------

ALTER TABLE agent_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_dismissals FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_dismissals'
      AND policyname = 'agent_dismissals_collective_isolation'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY agent_dismissals_collective_isolation ON agent_dismissals
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $sql$;
  END IF;
END $$;

-- Conditional GRANT — memu_app only exists on Hosted-tier deploys
-- (per feedback memory grant-memu-app-conditional from 2026-05-15).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memu_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON agent_dismissals TO memu_app';
  END IF;
END $$;

COMMENT ON TABLE agent_dismissals IS
  'BS3 §2.8 — agent_dismissals records user-rejected proposals so the team-lead orchestrator does not re-surface them. Tenant-scoped via collective_id. Optional reactivate_after lets dismissals expire (e.g. connection_suggester defaults to 30 days). The artefact_refs array is a set-equality key for the proposal — match against current candidate artefacts to decide "have we already proposed this?".';

COMMIT;
