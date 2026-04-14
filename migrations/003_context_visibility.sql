-- Per-person context isolation
-- Adds explicit visibility + owner columns so context entries can be
-- scoped to a single profile ("personal") or shared across the family.

ALTER TABLE context_entries
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'family'
    CHECK (visibility IN ('personal', 'family')),
  ADD COLUMN IF NOT EXISTS owner_profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_context_visibility
  ON context_entries(visibility, owner_profile_id);

-- Backfill owner_profile_id from existing metadata for any rows that had it
UPDATE context_entries
   SET owner_profile_id = metadata->>'profile_id'
 WHERE owner_profile_id IS NULL
   AND metadata->>'profile_id' IS NOT NULL;
