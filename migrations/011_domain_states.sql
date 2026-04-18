-- Story 2.4 — Domain health states.
--
-- Each of the 13 life domains gets a health row per family. Computed
-- nightly by the reflection daily pass. The morning briefing prepends
-- a domain-health header derived from this table.
--
-- Schema follows the backlog spec but uses TEXT ids (consistent with
-- the rest of memu-core) rather than UUID, and adds a unique key on
-- (family_id, domain) so the daily recompute can UPSERT cleanly.

CREATE TABLE IF NOT EXISTS domain_states (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  family_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  health TEXT NOT NULL DEFAULT 'green'
    CHECK (health IN ('green', 'amber', 'red')),
  last_activity TIMESTAMPTZ,
  open_items INT NOT NULL DEFAULT 0,
  overdue_standards INT NOT NULL DEFAULT 0,
  approaching_standards INT NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_states_family_domain
  ON domain_states(family_id, domain);

CREATE INDEX IF NOT EXISTS idx_domain_states_health
  ON domain_states(family_id, health);
