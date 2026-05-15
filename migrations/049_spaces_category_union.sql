-- migrations/049_spaces_category_union.sql
--
-- Build Spec 2 Phase R1 Story R1.2 — relax the synthesis_pages
-- category CHECK constraint to the UNION of all category sets.
--
-- Pre-R1, the constraint was the family set: person / routine /
-- household / commitment / document. R1 adds the research set
-- (memo / theme / participant / source / question / quote — `document`
-- overlaps), so the CHECK needs to be relaxed to the union.
--
-- ## Why relaxed, not dropped
--
-- A bare TEXT column without a CHECK invites typos — a Space written
-- with `category: 'paragraph'` (e.g. from a buggy migration script
-- or a stray test) would persist and quietly break the chip filter
-- + categoryLabel rendering. The CHECK is a typo guard.
--
-- The REAL rule — "is this category valid for THIS workspace's type?"
-- — can't live in the schema (the schema doesn't know workspace type
-- without a join, and JOINs in CHECK constraints aren't portable).
-- It lives in code, in upsertSpace, via isCategoryAllowedForType()
-- from src/spaces/model.ts. The CHECK and the code rule are two
-- different guards layered: schema catches typos that bypass code
-- (raw INSERTs, future migrations), code catches type mismatches the
-- schema can't see.
--
-- ## Idempotency
--
-- DROP CONSTRAINT IF EXISTS, then ADD with the new shape. Safe to
-- re-run.

BEGIN;

SET LOCAL search_path TO public;

ALTER TABLE synthesis_pages DROP CONSTRAINT IF EXISTS synthesis_pages_category_check;

ALTER TABLE synthesis_pages
  ADD CONSTRAINT synthesis_pages_category_check
  CHECK (category IN (
    -- Family set (preserved verbatim — every existing row passes).
    'person', 'routine', 'household', 'commitment', 'document',
    -- Research set additions. `document` not repeated — it's already
    -- in the family set and the CHECK uses IN ()'s deduped semantics
    -- regardless, but listing it once keeps the intent clear.
    'memo', 'theme', 'participant', 'source', 'question', 'quote'
  ));

COMMENT ON CONSTRAINT synthesis_pages_category_check ON synthesis_pages IS
  'Build Spec 2 Phase R1 — typo guard for the category column. The real type-aware rule (research-only categories rejected in family workspaces, and vice-versa) lives in upsertSpace via isCategoryAllowedForType() in src/spaces/model.ts. Two guards layered: schema catches typos that bypass code; code catches type mismatches the schema can''t see.';

COMMIT;
