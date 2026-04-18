-- Story 3.4a — cross-household membership + per-Space Pod grants.
--
-- The marriage / immigration / new-partner-joining flow. A person whose
-- primary Pod lives elsewhere (another Memu deployment, PodSpaces, NSS,
-- whatever) can be added as a member of THIS household. Their personal
-- Spaces stay in their Pod — the household references them by URL via
-- per-Space grants, never by copy.
--
-- Two tables:
--   household_members — who is in the household and the WebID we know them by
--   pod_grants        — which of their external Pod's Spaces they have
--                       granted this household read access to
--
-- "Household" continues to follow the single-family convention used since
-- Stories 2.1–2.3: household_admin_profile_id is the primary admin's
-- profile_id. When the proper households table arrives (likely alongside
-- the cross-repo review, see CLAUDE.md), swap the FK target.

CREATE TABLE IF NOT EXISTS household_members (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  household_admin_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- The WebID that identifies this member. Could point at a Memu-hosted
  -- profile on this deployment, on another Memu, or any external Solid Pod.
  member_webid TEXT NOT NULL,
  member_display_name TEXT NOT NULL,
  -- If the member also has a profile on THIS deployment, link it. NULL when
  -- the member is purely external (the common case for the joining adult).
  internal_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  invited_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'leaving', 'left'))
    DEFAULT 'invited',
  -- Leave-flow policy: what happens to family-emergent contributions
  -- (messages they sent, events they added) when they leave.
  --   retain_attributed — keep with their name attached (default)
  --   anonymise         — keep but strip identity
  --   remove            — delete
  leave_policy_for_emergent TEXT NOT NULL
    CHECK (leave_policy_for_emergent IN ('retain_attributed', 'anonymise', 'remove'))
    DEFAULT 'retain_attributed',
  grace_period_days INTEGER NOT NULL DEFAULT 30,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  leave_initiated_at TIMESTAMPTZ,
  leave_grace_until TIMESTAMPTZ,
  left_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_household_members_admin_webid
  ON household_members(household_admin_profile_id, member_webid);
CREATE INDEX IF NOT EXISTS idx_household_members_status
  ON household_members(household_admin_profile_id, status);

COMMENT ON TABLE household_members IS
  'Adults who are members of this household. Their primary Pod may be external. Story 3.4a.';

CREATE TABLE IF NOT EXISTS pod_grants (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  member_id TEXT NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  -- Full URL of the Space on the member's Pod. Granting an entire container
  -- is also expressed as a URL (with trailing slash) so the model is uniform.
  space_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  -- Cache hints from the most recent fetch (HTTP semantics; see 3.4b).
  last_synced_at TIMESTAMPTZ,
  last_etag TEXT,
  last_modified_header TEXT
);

-- One active grant per (member, space_url). Revoked grants accumulate as
-- audit trail and don't conflict (the partial index ignores them).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pod_grants_member_url_active
  ON pod_grants(member_id, space_url) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pod_grants_member ON pod_grants(member_id, status);

COMMENT ON TABLE pod_grants IS
  'Per-Space grants from a member''s external Pod to this household. Story 3.4a.';
