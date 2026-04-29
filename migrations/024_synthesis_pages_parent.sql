-- Spaces Canvas v2 — sub-Spaces.
-- A Space can live under another Space (its parent). Two-level constraint
-- (a parent cannot itself have a parent) is enforced in app code, not in
-- SQL — the column permits N-level chains so the data model can flex
-- later without a migration. validateParentRelationship() in
-- src/spaces/store.ts rejects any write that would nest a Space under
-- another sub-Space.
--
-- ON DELETE: when a parent Space is deleted, its children are NOT
-- cascade-deleted — their content is independent, the relationship was
-- contextual. deleteSpace() in src/spaces/store.ts runs an UPDATE to
-- orphan children (set parent_space_uri = NULL) inside the same
-- transaction as the row delete.

ALTER TABLE synthesis_pages
  ADD COLUMN IF NOT EXISTS parent_space_uri TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_synthesis_pages_parent
  ON synthesis_pages(parent_space_uri)
  WHERE parent_space_uri IS NOT NULL;
