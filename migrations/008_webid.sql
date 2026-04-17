-- Story 1.6: Solid-compatible identity (WebID + Solid-OIDC).
--
-- Every person in Memu gets a stable WebID. The URI is built from
-- MEMU_WEBID_BASE_URL and webid_slug (human-readable, unique per family)
-- using the form <base>/people/<slug>#me. We keep the slug separate
-- from profiles.id so a display-name change can rename the slug without
-- breaking the stable internal primary key.
--
-- oidc_subject is the value returned in the `sub` claim when this profile
-- logs into the Solid-OIDC provider. We default it to the internal id so
-- existing profiles keep working, but it can be rotated if a profile's
-- identity has to be re-issued.
--
-- oidc_password_hash is the bcrypt of a password set by the user for the
-- Solid-OIDC login form. Separate from the API-key mechanism used by the
-- mobile app (which stays as-is) — OIDC login requires an interactive
-- credential the user can type into a browser.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS webid_slug TEXT,
  ADD COLUMN IF NOT EXISTS oidc_subject TEXT,
  ADD COLUMN IF NOT EXISTS oidc_password_hash TEXT;

-- Backfill slugs for existing rows: lowercase display_name with non-alnum
-- stripped, suffixed with a 6-char uniqueness tail from id. Idempotent
-- because we only touch rows where slug is still NULL.
UPDATE profiles
   SET webid_slug = LOWER(
         REGEXP_REPLACE(COALESCE(display_name, 'user'), '[^a-zA-Z0-9]+', '-', 'g')
       ) || '-' || SUBSTRING(id, 1, 6)
 WHERE webid_slug IS NULL;

UPDATE profiles
   SET oidc_subject = id
 WHERE oidc_subject IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_webid_slug
  ON profiles(webid_slug);

-- External WebIDs referenced from the Twin registry. NULL for entities
-- that don't have (or don't yet have) a resolvable WebID — e.g. a piano
-- teacher mentioned once in a message, or a school with no web identity.
-- When present, it's the canonical identifier used by Story 3.3 when
-- we expose Spaces' `people` field to Solid clients.
ALTER TABLE entity_registry
  ADD COLUMN IF NOT EXISTS webid TEXT;

CREATE INDEX IF NOT EXISTS idx_entity_registry_webid
  ON entity_registry(webid)
  WHERE webid IS NOT NULL;

-- Solid-OIDC provider persistence. oidc-provider ships with an in-memory
-- adapter that loses everything on restart; we persist the three record
-- types that matter — client registrations, authorization grants, and
-- the signing keys — so registered clients survive reboots.
--
-- Short-lived records (access tokens, authorization codes, sessions) are
-- left in-memory: their natural TTL is minutes, and forcing a re-login
-- after a server restart is acceptable.
CREATE TABLE IF NOT EXISTS oidc_payload (
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  grant_id TEXT,
  user_code TEXT,
  uid TEXT,
  expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  PRIMARY KEY (id, kind)
);

CREATE INDEX IF NOT EXISTS idx_oidc_payload_expires
  ON oidc_payload(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oidc_payload_grant
  ON oidc_payload(grant_id)
  WHERE grant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oidc_payload_uid
  ON oidc_payload(uid)
  WHERE uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oidc_payload_user_code
  ON oidc_payload(user_code)
  WHERE user_code IS NOT NULL;

-- JWKS rotation: we store the signing keyset so tokens remain verifiable
-- across restarts. One row, key 'current'. Keys are rotated manually for
-- now; Story 1.6's scope stops short of automatic rotation.
CREATE TABLE IF NOT EXISTS oidc_jwks (
  key TEXT PRIMARY KEY,
  jwks JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
