-- Privacy Ledger: records every LLM dispatch decision made by the model router.
-- This is distinct from audit_log (profile-level actions) and messages (chat content).
-- The ledger is append-only and the parent-facing "what did Memu send to which model"
-- surface depends on it. Never delete rows from this table.

CREATE TABLE IF NOT EXISTS privacy_ledger (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  family_id TEXT,
  profile_id TEXT,

  skill_name TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  dispatched_model TEXT NOT NULL,
  provider TEXT NOT NULL,
  cost_tier TEXT,
  requires_twin BOOLEAN,
  twin_verified BOOLEAN DEFAULT FALSE,

  key_identifier TEXT,

  estimated_tokens_in INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'dry_run', 'dummy')),
  error_message TEXT,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_ledger_family ON privacy_ledger(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_ledger_profile ON privacy_ledger(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_ledger_skill ON privacy_ledger(skill_name, created_at DESC);
