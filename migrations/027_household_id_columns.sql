-- 027_household_id_columns.sql
--
-- Pre-Beta Stream 1 — add collective_id to every tenant-scoped table and
-- backfill from the existing scoping convention.
--
-- This migration is zero-behaviour-change: the new columns are added,
-- backfilled, and constrained NOT NULL, but no query in the application
-- yet reads them. RLS enablement (migration 028) is what activates them
-- as the enforced tenant boundary.
--
-- The "collective" naming follows ARCH-01 / ADR-002 (see header in 026).
-- This file name retains the legacy "household_id_columns" stem so the
-- migration ordering in the runner stays stable; the column name is
-- collective_id.
--
-- Backfill strategy per source:
--   Tables with profile_id        → collective_id from profiles.collective_id
--   Tables with owner_profile_id  → collective_id from profiles.collective_id
--   Tables with actor_profile_id  → collective_id from profiles.collective_id
--   Tables with family_id (= primary admin profile_id by old convention)
--                                 → collective_id from collectives where primary_admin = family_id
--   Tables that are currently global (no tenant column)
--                                 → collective_id of the single existing collective
--                                   (safe because pre-026 deployments are single-tenant)
--   Tables FK'd to household_members (renamed to collective_members in 029)
--                                 → inherit from the parent member's inviter collective
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, UPDATE … WHERE collective_id IS NULL.
--
-- The legacy `household_members` table is referenced under its legacy
-- name throughout this file because 029 (which renames it to
-- `collective_members`) runs strictly after 027.

-- ---------------------------------------------------------------------------
-- Helper: fail fast if there are zero or multiple collectives at backfill time
-- ---------------------------------------------------------------------------
-- For currently-global tables (entity_registry, content_rules, allowed_groups)
-- we backfill to "the collective". If a deployment somehow has 0 or >1
-- collectives when this migration runs, those tables can't be backfilled
-- automatically and a human has to make the call. Raise an exception so
-- the migration aborts loudly rather than guessing.

DO $$
DECLARE
  collective_count INT;
BEGIN
  SELECT COUNT(*) INTO collective_count FROM collectives WHERE status = 'active';
  -- Allow 0 (fresh install — global tables are empty too) or 1 (existing
  -- single-tenant deployment). >1 is the case where global tables can't
  -- be safely backfilled and a human decision is needed.
  IF collective_count > 1 THEN
    RAISE EXCEPTION 'Cannot auto-backfill currently-global tables (entity_registry, content_rules, allowed_groups) when % collectives exist. Add collective_id manually before re-running this migration.', collective_count;
  END IF;
END $$;

-- ===========================================================================
-- TIER-A: tables scoped via profile_id
-- ===========================================================================

-- personas
ALTER TABLE personas ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE personas pe
SET collective_id = pr.collective_id
FROM profiles pr
WHERE pe.profile_id = pr.id AND pe.collective_id IS NULL;

-- profile_channels
ALTER TABLE profile_channels ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE profile_channels pc
SET collective_id = pr.collective_id
FROM profiles pr
WHERE pc.profile_id = pr.id AND pc.collective_id IS NULL;

-- entity_relationships — has no profile_id; backfilled in the
-- currently-global section below.

-- conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE conversations c
SET collective_id = pr.collective_id
FROM profiles pr
WHERE c.profile_id = pr.id AND c.collective_id IS NULL;

-- messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE messages m
SET collective_id = pr.collective_id
FROM profiles pr
WHERE m.profile_id = pr.id AND m.collective_id IS NULL;

-- context_entries (uses owner_profile_id, nullable)
ALTER TABLE context_entries ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE context_entries ce
SET collective_id = pr.collective_id
FROM profiles pr
WHERE ce.owner_profile_id = pr.id AND ce.collective_id IS NULL;
-- For rows with NULL owner_profile_id (legacy), assign to the single collective.
UPDATE context_entries
SET collective_id = (SELECT id FROM collectives WHERE status = 'active' LIMIT 1)
WHERE collective_id IS NULL;

-- synthesis_pages (Spaces)
ALTER TABLE synthesis_pages ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE synthesis_pages sp
SET collective_id = pr.collective_id
FROM profiles pr
WHERE sp.profile_id = pr.id AND sp.collective_id IS NULL;

-- actions
ALTER TABLE actions ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE actions a
SET collective_id = pr.collective_id
FROM profiles pr
WHERE a.profile_id = pr.id AND a.collective_id IS NULL;

-- alerts
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE alerts al
SET collective_id = pr.collective_id
FROM profiles pr
WHERE al.profile_id = pr.id AND al.collective_id IS NULL;

-- inbox_messages
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE inbox_messages im
SET collective_id = pr.collective_id
FROM profiles pr
WHERE im.profile_id = pr.id AND im.collective_id IS NULL;

-- profile_provider_keys (BYOK)
ALTER TABLE profile_provider_keys ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE profile_provider_keys ppk
SET collective_id = pr.collective_id
FROM profiles pr
WHERE ppk.profile_id = pr.id AND ppk.collective_id IS NULL;

-- push_tokens
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE push_tokens pt
SET collective_id = pr.collective_id
FROM profiles pr
WHERE pt.profile_id = pr.id AND pt.collective_id IS NULL;

-- ===========================================================================
-- TIER-A: tables scoped via actor_profile_id
-- ===========================================================================

-- audit_log
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE audit_log al
SET collective_id = pr.collective_id
FROM profiles pr
WHERE al.actor_profile_id = pr.id AND al.collective_id IS NULL;

-- observer_config — has no tenant column; backfilled in the
-- currently-global section below.

-- ===========================================================================
-- TIER-A: tables scoped via family_id (= primary admin profile_id)
-- ===========================================================================

-- settings — dropped (see currently-global section below). Vestigial
-- single-tenant key/value table whose 10 seeded rows duplicate config
-- now living in env vars (anthropic_api_key, calendar/email/photo
-- providers, MEMU_WEATHER_PLACE), per-collective family_settings, and
-- per-profile profile_provider_keys. No code reads from it.

-- family_settings (family_id is the PK)
ALTER TABLE family_settings ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE family_settings fs
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = fs.family_id
  AND c.status = 'active'
  AND fs.collective_id IS NULL;

-- stream_cards
ALTER TABLE stream_cards ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE stream_cards sc
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = sc.family_id
  AND c.status = 'active'
  AND sc.collective_id IS NULL;

-- privacy_ledger (family_id is nullable here; rows without a family_id
-- predate the convention or are global system events. Assign to the
-- single collective.)
ALTER TABLE privacy_ledger ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE privacy_ledger pl
SET collective_id = c.id
FROM collectives c
WHERE pl.family_id IS NOT NULL
  AND c.primary_admin_profile_id = pl.family_id
  AND c.status = 'active'
  AND pl.collective_id IS NULL;
-- Catch-all for NULL or unmatched family_id rows (legacy).
UPDATE privacy_ledger
SET collective_id = (SELECT id FROM collectives WHERE status = 'active' LIMIT 1)
WHERE collective_id IS NULL;

-- reflection_findings
ALTER TABLE reflection_findings ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE reflection_findings rf
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = rf.family_id
  AND c.status = 'active'
  AND rf.collective_id IS NULL;

-- spaces_log
ALTER TABLE spaces_log ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE spaces_log sl
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = sl.family_id
  AND c.status = 'active'
  AND sl.collective_id IS NULL;

-- export_log
ALTER TABLE export_log ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE export_log el
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = el.family_id
  AND c.status = 'active'
  AND el.collective_id IS NULL;

-- care_standards
ALTER TABLE care_standards ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE care_standards cs
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = cs.family_id
  AND c.status = 'active'
  AND cs.collective_id IS NULL;

-- domain_states
ALTER TABLE domain_states ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE domain_states ds
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = ds.family_id
  AND c.status = 'active'
  AND ds.collective_id IS NULL;

-- list_items
ALTER TABLE list_items ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE list_items li
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = li.family_id
  AND c.status = 'active'
  AND li.collective_id IS NULL;

-- whatsapp_connected_chats (FK'd to family_settings.family_id)
ALTER TABLE whatsapp_connected_chats ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE whatsapp_connected_chats wcc
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = wcc.family_id
  AND c.status = 'active'
  AND wcc.collective_id IS NULL;

-- ===========================================================================
-- TIER-A: cross-collective federation tables (Story 3.4)
-- ===========================================================================
--
-- household_members records cross-collective memberships. The "collective"
-- is the inviter's — household_admin_profile_id is the inviter; the
-- invited member may be an external WebID with no internal profile.
-- Migration 029 renames this table to collective_members and the
-- column to collective_admin_profile_id; here we still address them
-- under their legacy names because 029 runs after 027.

-- household_members
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE household_members hm
SET collective_id = c.id
FROM collectives c
WHERE c.primary_admin_profile_id = hm.household_admin_profile_id
  AND c.status = 'active'
  AND hm.collective_id IS NULL;

-- pod_grants (FK to household_members → inherit)
ALTER TABLE pod_grants ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE pod_grants pg
SET collective_id = hm.collective_id
FROM household_members hm
WHERE pg.member_id = hm.id AND pg.collective_id IS NULL;

-- external_space_cache (FK to household_members → inherit)
ALTER TABLE external_space_cache ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE external_space_cache esc
SET collective_id = hm.collective_id
FROM household_members hm
WHERE esc.member_id = hm.id AND esc.collective_id IS NULL;

-- ===========================================================================
-- TIER-A: currently-global tables (no existing tenant column)
-- ===========================================================================
--
-- These tables predate the family_id convention and have no tenant column
-- today. Multi-tenant safety has, until 028 lands, depended on each
-- deployment hosting exactly one tenant. The DO $$ block at the top of
-- this file aborts if there's a deployment with >1 collectives at
-- backfill time, so this catch-all is safe in the only scenarios that
-- pre-026 production ever shipped.

-- entity_registry
ALTER TABLE entity_registry ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE entity_registry
SET collective_id = (SELECT id FROM collectives WHERE status = 'active' LIMIT 1)
WHERE collective_id IS NULL;

-- entity_relationships — currently global (only has entity_id, no
-- profile/family scoping). Pre-026 single-tenant assumption: every
-- row belongs to the single collective. Future invariant: should equal
-- entity_id's collective_id, but that's enforced in application code.
ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE entity_relationships
SET collective_id = (SELECT id FROM collectives WHERE status = 'active' LIMIT 1)
WHERE collective_id IS NULL;

-- observer_config — currently global, no tenant column.
ALTER TABLE observer_config ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE observer_config
SET collective_id = (SELECT id FROM collectives WHERE status = 'active' LIMIT 1)
WHERE collective_id IS NULL;

-- settings — DROPPED. Vestigial single-tenant key/value table; nothing
-- in src/ reads from it (verified via grep 2026-05-10). The 10 seeded
-- rows are duplicated by config that lives in the right scopes:
--   - Per-deployment infra (anthropic_api_key, gemini_api_key, calendar
--     /email/photo providers, MEMU_WEATHER_PLACE) → env vars
--   - Per-collective preferences (reflection cron) → family_settings
--   - Per-profile preferences (BYOK) → profile_provider_keys
-- Aligned with the individual-first principle: future per-profile
-- preferences (briefing time, timezone) will land in a properly-scoped
-- profile_preferences table, not retrofitted onto a flat key/value bag.
DROP TABLE IF EXISTS settings;

-- content_rules
ALTER TABLE content_rules ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE content_rules
SET collective_id = (SELECT id FROM collectives WHERE status = 'active' LIMIT 1)
WHERE collective_id IS NULL;

-- allowed_groups
ALTER TABLE allowed_groups ADD COLUMN IF NOT EXISTS collective_id TEXT REFERENCES collectives(id)
    DEFAULT NULLIF(current_setting('memu.collective_id', true), '');
UPDATE allowed_groups
SET collective_id = (SELECT id FROM collectives WHERE status = 'active' LIMIT 1)
WHERE collective_id IS NULL;

-- ===========================================================================
-- SET NOT NULL on every collective_id we just added
-- ===========================================================================
--
-- Done at the end so partial-application of this migration doesn't
-- leave a NOT NULL constraint hanging over a partially-backfilled table.
--
-- `household_members` appears in the list under its legacy name; 029
-- renames both the table and downstream FKs after this migration
-- completes. The column we just added on it (collective_id) keeps
-- its name through the rename.

DO $$
DECLARE
  t TEXT;
  table_list TEXT[] := ARRAY[
    'personas', 'profile_channels', 'entity_relationships',
    'conversations', 'messages', 'context_entries', 'synthesis_pages',
    'actions', 'alerts', 'inbox_messages',
    'profile_provider_keys', 'push_tokens',
    'audit_log', 'observer_config',
    'family_settings', 'stream_cards', 'privacy_ledger',
    'reflection_findings', 'spaces_log', 'export_log', 'care_standards',
    'domain_states', 'list_items', 'whatsapp_connected_chats',
    'household_members', 'pod_grants', 'external_space_cache',
    'entity_registry', 'content_rules', 'allowed_groups'
  ];
  null_count INT;
BEGIN
  FOREACH t IN ARRAY table_list LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE collective_id IS NULL', t)
      INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'Table % has % rows with NULL collective_id after backfill — aborting before SET NOT NULL', t, null_count;
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN collective_id SET NOT NULL', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Indexes — collective_id is the leading filter for every tenant-scoped query
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS personas_collective_id_idx ON personas(collective_id);
CREATE INDEX IF NOT EXISTS profile_channels_collective_id_idx ON profile_channels(collective_id);
CREATE INDEX IF NOT EXISTS entity_relationships_collective_id_idx ON entity_relationships(collective_id);
CREATE INDEX IF NOT EXISTS conversations_collective_id_idx ON conversations(collective_id);
CREATE INDEX IF NOT EXISTS messages_collective_id_idx ON messages(collective_id);
CREATE INDEX IF NOT EXISTS context_entries_collective_id_idx ON context_entries(collective_id);
CREATE INDEX IF NOT EXISTS synthesis_pages_collective_id_idx ON synthesis_pages(collective_id);
CREATE INDEX IF NOT EXISTS actions_collective_id_idx ON actions(collective_id);
CREATE INDEX IF NOT EXISTS alerts_collective_id_idx ON alerts(collective_id);
CREATE INDEX IF NOT EXISTS inbox_messages_collective_id_idx ON inbox_messages(collective_id);
CREATE INDEX IF NOT EXISTS profile_provider_keys_collective_id_idx ON profile_provider_keys(collective_id);
CREATE INDEX IF NOT EXISTS push_tokens_collective_id_idx ON push_tokens(collective_id);
CREATE INDEX IF NOT EXISTS audit_log_collective_id_idx ON audit_log(collective_id);
CREATE INDEX IF NOT EXISTS observer_config_collective_id_idx ON observer_config(collective_id);
CREATE INDEX IF NOT EXISTS family_settings_collective_id_idx ON family_settings(collective_id);
CREATE INDEX IF NOT EXISTS stream_cards_collective_id_idx ON stream_cards(collective_id);
CREATE INDEX IF NOT EXISTS privacy_ledger_collective_id_idx ON privacy_ledger(collective_id);
CREATE INDEX IF NOT EXISTS reflection_findings_collective_id_idx ON reflection_findings(collective_id);
CREATE INDEX IF NOT EXISTS spaces_log_collective_id_idx ON spaces_log(collective_id);
CREATE INDEX IF NOT EXISTS export_log_collective_id_idx ON export_log(collective_id);
CREATE INDEX IF NOT EXISTS care_standards_collective_id_idx ON care_standards(collective_id);
CREATE INDEX IF NOT EXISTS domain_states_collective_id_idx ON domain_states(collective_id);
CREATE INDEX IF NOT EXISTS list_items_collective_id_idx ON list_items(collective_id);
CREATE INDEX IF NOT EXISTS whatsapp_connected_chats_collective_id_idx ON whatsapp_connected_chats(collective_id);
CREATE INDEX IF NOT EXISTS household_members_collective_id_idx ON household_members(collective_id);
CREATE INDEX IF NOT EXISTS pod_grants_collective_id_idx ON pod_grants(collective_id);
CREATE INDEX IF NOT EXISTS external_space_cache_collective_id_idx ON external_space_cache(collective_id);
CREATE INDEX IF NOT EXISTS entity_registry_collective_id_idx ON entity_registry(collective_id);
CREATE INDEX IF NOT EXISTS content_rules_collective_id_idx ON content_rules(collective_id);
CREATE INDEX IF NOT EXISTS allowed_groups_collective_id_idx ON allowed_groups(collective_id);
