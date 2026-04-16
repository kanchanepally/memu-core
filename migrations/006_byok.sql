-- BYOK — bring-your-own-key. Per-profile encrypted LLM provider keys.
-- Separate from profiles.api_key (which is Memu's own auth token).
-- Structured so additional providers (gemini, openai) can be added without schema changes.

CREATE TABLE IF NOT EXISTS profile_provider_keys (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'gemini', 'openai')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_hint TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_profile_provider_keys_profile
  ON profile_provider_keys(profile_id);
