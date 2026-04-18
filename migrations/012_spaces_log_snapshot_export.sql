-- Story 3.1 / 3.2 — extend spaces_log event vocabulary so the snapshot
-- and full-export operations can be audited there alongside synthesis
-- writes. Same idempotent CHECK-replacement pattern as 009 used.

ALTER TABLE spaces_log DROP CONSTRAINT IF EXISTS spaces_log_event_check;

ALTER TABLE spaces_log ADD CONSTRAINT spaces_log_event_check
  CHECK (event IN (
    'created', 'updated', 'renamed', 'split', 'merged', 'deleted',
    'query_served', 'snapshot', 'exported'
  ));

-- Story 3.2 — proof-of-export ledger. Append-only; one row per /api/export
-- invocation. The hash is over data.json content; the user can later prove
-- what they exported and when.
CREATE TABLE IF NOT EXISTS export_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  family_id TEXT NOT NULL,
  actor_profile_id TEXT,
  data_hash TEXT NOT NULL,
  byte_count BIGINT NOT NULL,
  category_counts JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_log_family ON export_log(family_id, created_at DESC);
