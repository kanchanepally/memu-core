-- Story 3.4b — external Space cache.
--
-- When a household member grants this household read access to a Space on
-- their external Pod (per pod_grants), we fetch and cache the parsed body
-- here so synthesis / briefings / chat don't have to round-trip the network
-- on every query. Cache hints (etag, last_modified_header) live on
-- pod_grants and feed the next conditional request.
--
-- Keyed by (member_id, space_url) so revoking a grant lets us drop the
-- cache deterministically. Cascades on member delete (which only happens
-- when the household_admin profile is removed) — for the normal "leave"
-- flow the cache is cleared by external_sync.dropCacheForRevokedGrants
-- when revokeGrant fires.

CREATE TABLE IF NOT EXISTS external_space_cache (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  member_id TEXT NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  space_url TEXT NOT NULL,
  -- Parsed Space fields. We store the projection rather than the raw body
  -- so callers don't re-parse on every read. The raw body lives in
  -- body_markdown (or, for JSON-LD-only Pods, in extracted form).
  source_url TEXT NOT NULL,
  uri TEXT NOT NULL,
  category TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  people JSONB NOT NULL DEFAULT '[]'::jsonb,
  visibility JSONB NOT NULL DEFAULT '"private"'::jsonb,
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  body_markdown TEXT NOT NULL DEFAULT '',
  remote_last_updated TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_external_space_cache_member_url
  ON external_space_cache(member_id, space_url);

CREATE INDEX IF NOT EXISTS idx_external_space_cache_member
  ON external_space_cache(member_id);

COMMENT ON TABLE external_space_cache IS
  'Parsed Spaces fetched from external Pods via pod_grants. Story 3.4b.';
