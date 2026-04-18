-- Story 3.3c — external Solid Pod pointer per profile.
--
-- A family member who already has a Solid Pod (PodSpaces, NSS, another
-- Memu deployment, etc.) can store its base URL here. The Solid client
-- (src/spaces/solid_client.ts) uses this to fetch their personal Spaces
-- from the external Pod instead of (or in addition to) the local store.
--
-- Tier-2 wizard step "Do you already have a Solid Pod?" writes here.
-- Empty/null = no external Pod, Memu is the source of truth for this
-- profile's Spaces. Set = external Pod is treated as authoritative for
-- Spaces fetched from it; Memu caches but never overwrites.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS external_pod_url TEXT;
COMMENT ON COLUMN profiles.external_pod_url IS
  'Base URL of an external Solid Pod owned by this profile. NULL = none. Story 3.3c.';
