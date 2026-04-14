-- Expo push tokens per profile. One profile can have multiple devices.
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_profile ON push_tokens(profile_id);
