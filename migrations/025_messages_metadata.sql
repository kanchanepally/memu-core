-- Messages metadata JSONB — for tagging assistant turns that aren't a
-- direct response to a user prompt. Specifically, the morning briefing is
-- now stored as a message in the user's chat thread (role='assistant',
-- content_original NULL) tagged metadata->>'type' = 'briefing' so the
-- chat renderer can apply elevated styling inline.
--
-- Existing turns (user message + assistant response on a single row) carry
-- metadata = NULL and are unaffected. The schema constraint is permissive —
-- arbitrary JSON for future tags (e.g. 'reflection', 'system_note').

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Drop the NOT NULL on content_original so server-generated assistant
-- messages (briefings, future system notes) can sit on the timeline
-- without a paired user prompt. Audit pattern: real turns still carry
-- both columns; briefings carry only content_response_translated +
-- metadata->>'type' = 'briefing'.
ALTER TABLE messages
  ALTER COLUMN content_original DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_metadata_type
  ON messages ((metadata->>'type'))
  WHERE metadata IS NOT NULL;
