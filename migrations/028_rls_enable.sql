-- 028_rls_enable.sql
--
-- Pre-Beta Stream 1 — enable Row Level Security on every tenant-scoped
-- table and install the collective-isolation policy.
--
-- IMPORTANT: this migration must ship in the same PR as the
-- `withTenantContext` application-code refactor. Once RLS is FORCEd,
-- any query against a tenant-scoped table that doesn't first set
-- `memu.collective_id` returns zero rows. Without the application
-- changes, every authenticated route breaks.
--
-- "Collective" is the ARCH-01 / ADR-002 rename of "household". The
-- session variable, policy names, and CREATE TABLE in 026 all use
-- the new name. The legacy `household_members` table is referenced
-- in the table list below under its legacy name because migration
-- 029 (which renames it to `collective_members`) runs after 028.
--
-- Pattern (per Crunchy Data, Jan 2026):
--   - ENABLE ROW LEVEL SECURITY: policies apply to non-superusers
--   - FORCE ROW LEVEL SECURITY: policies apply to the table OWNER too
--     (the application connects as the table owner; without FORCE the
--     policies are silently bypassed)
--   - Policy USING + WITH CHECK: read and write are gated by the same
--     collective-id match
--   - current_setting('memu.collective_id', true): missing-ok read of
--     the session variable. Returns empty string when unset.
--   - NULLIF(..., '')::TEXT cast: '' compared to a TEXT column would
--     return false (no row's collective_id is empty string), but the
--     intent is "no context set ⇒ no rows visible", so we coerce to
--     NULL which then fails the equality check unambiguously.
--
-- Wrapped in BEGIN/COMMIT so SET LOCAL applies for the whole file
-- (search_path pinning + DDL atomicity) and so a failure rolls back
-- cleanly rather than leaving a half-enabled RLS state.

BEGIN;

-- Pin search_path defensively. Without this, a poisoned search_path
-- (e.g., a malicious schema preceding 'public' in the resolution order)
-- would let unqualified table references in policies and DDL resolve
-- to attacker-controlled tables. SET LOCAL is transaction-scoped —
-- discarded on COMMIT, so the pooled connection isn't carrying it
-- forward to the next caller.
SET LOCAL search_path TO public;

-- ---------------------------------------------------------------------------
-- Tier-A — strict policy (current collective only)
-- ---------------------------------------------------------------------------
--
-- Generated via DO $$ block to avoid copy-paste drift across 31 tables.
-- Each table gets:
--   1. ENABLE ROW LEVEL SECURITY
--   2. FORCE ROW LEVEL SECURITY
--   3. CREATE POLICY <table>_collective_isolation
--        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
--        WITH CHECK (same)

DO $$
DECLARE
  t TEXT;
  policy_name TEXT;
  tier_a_tables TEXT[] := ARRAY[
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
BEGIN
  FOREACH t IN ARRAY tier_a_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    policy_name := t || '_collective_isolation';

    -- Drop-and-recreate so the migration is idempotent against partial
    -- prior application.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, t);

    EXECUTE format($pol$
      CREATE POLICY %I ON %I
        USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
        WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
    $pol$, policy_name, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Tier-B — profiles (split read / write policy with explicit bootstrap)
-- ---------------------------------------------------------------------------
--
-- profiles needs a policy that lets the auth chain look up profile by
-- api_key BEFORE collective context is set, while still gating cross-
-- collective reads from any other code path.
--
-- Earlier draft of this policy used "no context set ⇒ all profiles
-- visible". That gave any code path that happens to forget context the
-- ability to read every profile in the deployment — convention-only
-- enforcement, not mechanical. Replaced by an explicit `memu.bootstrap`
-- session flag the auth chain and cron enumeration paths set
-- deliberately. Anywhere else, profile reads without context return
-- zero rows.
--
--   profiles_read (FOR SELECT, permissive):
--     Allowed if EITHER (a) the row's collective_id matches the active
--     collective context, OR (b) the explicit bootstrap flag is set.
--
--   profiles_write (FOR ALL, permissive):
--     USING + WITH CHECK both require collective_id = active context.
--     Bootstrap mode does NOT enable cross-collective writes — even
--     auth bootstrap creates new profiles inside an explicit collective
--     context (see registerProfile in src/auth.ts).
--
-- Postgres semantics for two permissive policies on the same table:
-- multiple permissive policies for the same command are OR'd together.
--   - SELECT against profiles: profiles_read.USING OR profiles_write.USING
--     (both apply to SELECT — FOR ALL covers SELECT too). The OR collapses
--     to "collective match OR bootstrap flag set", which is what we want.
--   - INSERT/UPDATE/DELETE: only profiles_write applies (FOR SELECT
--     policies don't apply to writes). Gate is strict: must match.
-- See https://www.postgresql.org/docs/current/sql-createpolicy.html
-- "Multiple Policies".
--
-- Bootstrap-flag callers in the codebase:
--   - src/auth.ts: getProfileByApiKey, requireCollective's join with collectives
--   - src/channels/auth/google-signin.ts: signInWithGoogle steps 1 + 2
--   - src/intelligence/orchestrator.ts: lookupPrimaryProfile (WhatsApp ingest)
--   - src/index.ts: morning briefing cron's recipient enumeration
-- All go through `db.queryAsBootstrap` in src/db/tenant.ts.

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_read ON profiles;
CREATE POLICY profiles_read ON profiles
  FOR SELECT
  USING (
    collective_id = NULLIF(current_setting('memu.collective_id', true), '')
    OR NULLIF(current_setting('memu.bootstrap', true), '') = 'true'
  );

DROP POLICY IF EXISTS profiles_write ON profiles;
CREATE POLICY profiles_write ON profiles
  FOR ALL
  USING (collective_id = NULLIF(current_setting('memu.collective_id', true), ''))
  WITH CHECK (collective_id = NULLIF(current_setting('memu.collective_id', true), ''));

-- ---------------------------------------------------------------------------
-- Tier-C — explicitly NOT enabling RLS
-- ---------------------------------------------------------------------------
--
-- collectives           — the parent table; the auth flow needs to look
--                         up collective by primary_admin without context
-- oidc_payload          — Solid-OIDC global IdP state, intentionally
--                         shared across all tenants
-- oidc_jwks             — signing keys for the IdP; global
-- schema_migrations     — migration tracking; global
--
-- This block is documentation only. Re-enabling RLS on these tables
-- without rewriting the auth + IdP code paths would break login.

-- ---------------------------------------------------------------------------
-- Sanity check
-- ---------------------------------------------------------------------------
--
-- After this migration runs, every Tier-A and Tier-B table should have
-- rowsecurity = true and forcerowsecurity = true. Fail loudly if any
-- table missed the loop above.

DO $$
DECLARE
  t TEXT;
  is_enabled BOOL;
  is_forced BOOL;
  expected_tables TEXT[] := ARRAY[
    'personas', 'profile_channels', 'entity_relationships',
    'conversations', 'messages', 'context_entries', 'synthesis_pages',
    'actions', 'alerts', 'inbox_messages',
    'profile_provider_keys', 'push_tokens',
    'audit_log', 'observer_config',
    'family_settings', 'stream_cards', 'privacy_ledger',
    'reflection_findings', 'spaces_log', 'export_log', 'care_standards',
    'domain_states', 'list_items', 'whatsapp_connected_chats',
    'household_members', 'pod_grants', 'external_space_cache',
    'entity_registry', 'content_rules', 'allowed_groups',
    'profiles'
  ];
BEGIN
  FOREACH t IN ARRAY expected_tables LOOP
    SELECT relrowsecurity, relforcerowsecurity
    INTO is_enabled, is_forced
    FROM pg_class
    WHERE relname = t AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema());

    IF NOT is_enabled OR NOT is_forced THEN
      RAISE EXCEPTION 'RLS not fully enabled on %: enabled=%, forced=%', t, is_enabled, is_forced;
    END IF;
  END LOOP;
END $$;

COMMIT;
