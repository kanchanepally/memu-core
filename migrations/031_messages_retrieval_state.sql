-- 031_messages_retrieval_state.sql
--
-- BUG-15 / FEAT-02 — retrieval-state column on messages.
--
-- Each interactive_query turn now derives a `retrievalState` from what
-- retrieval found (sourced / fallback / empty — see RetrievalState in
-- src/spaces/retrieval.ts). We persist it on the message row so:
--   (a) the chat UI can render an "Unsourced" caption on the user-facing
--       turn when the answer came from training rather than Spaces, and
--   (b) refresh (or opening the conversation later) shows the same
--       caption — not just whatever the SSE event happened to carry.
--
-- Constrained to the three RetrievalState values + null. Null = legacy
-- (pre-031 message, can't tell). The UI treats null as "unknown" and
-- renders nothing — same UX as before, just no honesty badge.
--
-- No backfill. We never knew the retrieval state of historical turns;
-- pretending is worse than honest unknown.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS retrieval_state TEXT;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_retrieval_state_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_retrieval_state_check
  CHECK (retrieval_state IS NULL OR retrieval_state IN ('sourced', 'fallback', 'empty'));
