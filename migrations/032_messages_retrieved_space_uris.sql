-- 032_messages_retrieved_space_uris.sql
--
-- BUG-15 / FEAT-03 — persist which Spaces fed each chat reply.
--
-- The `actions_executed` JSONB column already tracks Spaces that the LLM
-- *touched* mid-turn via tool calls (createSpace / updateSpace / findSpaces).
-- This column captures the complementary case: Spaces that retrieval pulled
-- to ground the answer, where no tool was called.
--
-- Why a separate column rather than overloading actions_executed:
--   - actions_executed is a log of tool _calls_; retrieved Spaces are
--     not calls, they're an input to the call. Keeping them apart keeps
--     the audit story clean.
--   - URI arrays are cheaper to query/index than JSONB scanning if a
--     future "what's been read most often" surface wants it.
--
-- Stored as TEXT[] because Space URIs are stable strings and we don't
-- need JSON shape. Null/empty = no Spaces fed this turn (either the
-- pipeline didn't run retrieval, or retrieval was empty — distinguished
-- by retrieval_state from migration 031).

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS retrieved_space_uris TEXT[];
