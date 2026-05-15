-- migrations/050_workspace_templates.sql
--
-- Build Spec 2 Phase R1 Story R1.5 — workspace templates.
-- A template seeds the SHAPE of a new workspace (type + display
-- metadata), not its content. A researcher creating a new workspace
-- picks "Research project" and lands in a type=research workspace
-- with the research category set + the research reading surface
-- without having to know what 'research' means as a workspace type.
--
-- ## Why a table, not a TS const
--
-- A const would be enough for today's single template (research_blank)
-- but the table opens the door to: (a) per-user / per-Collective
-- templates a household could share, (b) the deferred "starter
-- Spaces" question (spec §4.R1.5 — "the starter-content question is
-- a Phase R7 question and explicitly deferred"), (c) admin-curated
-- templates on Hosted-tier. Migrating from a const to a table later
-- would be the same shape this migration ships; doing it once now
-- avoids the cutover.
--
-- ## Scope (thin slice)
--
-- - Single system template seeded: `research_blank`. Type=research,
--   no starter Spaces.
-- - Read-only from app code today (no admin UI). Operator can INSERT
--   manually for a custom template until the admin path lands.
-- - NOT tenant-scoped — templates are global system records. RLS off.
--   The GRANT-to-memu_app guard from the feedback memory still
--   applies so memu_app can SELECT.
--
-- ## Idempotency
--
-- IF NOT EXISTS on the table, ON CONFLICT (id) DO NOTHING on the
-- seed. Safe to re-run on a populated schema.

BEGIN;

SET LOCAL search_path TO public;

CREATE TABLE IF NOT EXISTS workspace_templates (
  -- Stable identifier used as the API's `template` parameter value.
  -- snake_case so the wire shape reads naturally.
  id TEXT PRIMARY KEY,
  -- Human-readable name for the template picker.
  display_name TEXT NOT NULL,
  -- Short explanation rendered as a subtitle under the picker chip.
  description TEXT NOT NULL DEFAULT '',
  -- The workspace type a new workspace gets when created from this
  -- template. Must be one of the values in collectives_type_check
  -- (see migration 039 / src/api/workspaces.ts WORKSPACE_TYPES).
  workspace_type TEXT NOT NULL,
  -- Optional name pattern — pre-fill for the workspace-name input
  -- in the create modal. {} as token placeholders for future
  -- interpolation (today: nothing is interpolated, the string is
  -- just shown).
  name_pattern TEXT NOT NULL DEFAULT '',
  -- Icon (single character / emoji) for the template chip. Matches
  -- the workspace-type chip icon convention in the PWA.
  icon TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Templates are read-mostly; the type index covers the common
-- "what templates exist for type X" query.
CREATE INDEX IF NOT EXISTS workspace_templates_type_idx
  ON workspace_templates (workspace_type);

-- Conditional GRANT — memu_app exists only on Hosted-tier deploys
-- per the feedback memory grant-memu-app-conditional.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memu_app') THEN
    EXECUTE 'GRANT SELECT ON workspace_templates TO memu_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Seed: the single template that ships in this slice.
-- ---------------------------------------------------------------------------

INSERT INTO workspace_templates (id, display_name, description, workspace_type, name_pattern, icon)
VALUES (
  'research_blank',
  'Research project',
  'A workspace for reading, coding, and writing — memo your own observations, code passages from interview transcripts and papers, surface themes.',
  'research',
  'Research workspace',
  '🔬'
)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE workspace_templates IS
  'Build Spec 2 Phase R1 Story R1.5 — system templates that seed the SHAPE of a new workspace (type + display metadata), not its content. A user picks a template, lands in a workspace with the right category set and reading surface, without needing to know what the underlying workspace type does. Read-mostly today; the deferred starter-content question (spec §4.R1.5) will extend this table when/if it lands.';

COMMIT;
