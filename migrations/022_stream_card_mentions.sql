-- 022_stream_card_mentions.sql
--
-- Track briefing-skill mentions of stream cards so the same item doesn't
-- resurface in three consecutive morning briefings. Pairs with the daily
-- auto-expire pass that ages out cards older than 14 days.
--
-- Symptom (2026-04-29): Hareesh saw "your AWBS basket is still sitting
-- open" briefed on three mornings running because the underlying stream
-- card was `status='active'` and the briefing skill picks 1-2 items
-- ordered by created_at — so the same oldest items came up every day.
--
-- mentioned_count    — incremented each time the briefing skill includes
--                      this card in its `mentioned_card_indexes` output.
-- last_mentioned_at  — timestamp of the last mention. Briefing pulls
--                      preferentially from cards with NULL or older
--                      timestamps, so rotation happens naturally.
ALTER TABLE stream_cards
  ADD COLUMN IF NOT EXISTS mentioned_count INT NOT NULL DEFAULT 0;

ALTER TABLE stream_cards
  ADD COLUMN IF NOT EXISTS last_mentioned_at TIMESTAMPTZ;

-- Index supporting the briefing's "pick least-recently-mentioned" query.
-- Partial index on active rows only (resolved/dismissed/expired cards are
-- never mentioned, so we don't need them here).
CREATE INDEX IF NOT EXISTS idx_stream_cards_active_mention
  ON stream_cards (family_id, mentioned_count ASC, last_mentioned_at ASC NULLS FIRST, created_at ASC)
  WHERE status = 'active';
