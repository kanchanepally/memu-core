-- Story 2.3 — Minimum Standards of Care.
--
-- Every family has a set of implicit obligations — dentist, MOT, boiler
-- service, partner time, friendship contact — that should be happening
-- even when nobody mentions them. This table represents those standards
-- as first-class data so the reflection engine can surface lapses.
--
-- Schema follows the backlog spec but uses TEXT ids (consistent with the
-- rest of the memu-core schema) rather than UUID columns.

CREATE TABLE IF NOT EXISTS care_standards (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  family_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  description TEXT NOT NULL,
  frequency_days INT NOT NULL CHECK (frequency_days > 0),
  applies_to TEXT[] NOT NULL DEFAULT '{}',
  last_completed TIMESTAMPTZ,
  next_due TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'on_track'
    CHECK (status IN ('on_track', 'approaching', 'overdue')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  custom BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_care_standards_family ON care_standards(family_id, enabled, status);
CREATE INDEX IF NOT EXISTS idx_care_standards_next_due ON care_standards(next_due) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_care_standards_domain ON care_standards(family_id, domain);

-- Unique key on the default standards so re-seeding a family doesn't
-- duplicate rows. Custom (family-added) standards are not unique; a
-- family may legitimately have two "call grandma" standards if they
-- want to.
CREATE UNIQUE INDEX IF NOT EXISTS idx_care_standards_default_unique
  ON care_standards(family_id, domain, description)
  WHERE custom = FALSE;
