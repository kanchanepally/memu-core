-- 033_messages_stream_card_link.sql
--
-- Phase A.1 — Canvas data spine.
--
-- The single biggest source of UX confusion in Memu today is having two
-- timelines that surface overlapping content:
--   - stream_cards.feed (Today screen)
--   - messages.thread (Chat screen)
-- Each gets briefings, extraction-derived nudges, and reflection findings.
-- The user sees duplicate / conflicting state because the two surfaces are
-- written independently and reconciled only in the user's head.
--
-- The Canvas (per memu-platform/docs/memu-layer-zero-ux-brief.md) is one
-- adaptive surface. The conversation IS the canvas. Every user-facing
-- thing — a chat reply, a briefing, a "compost arrives Thursday — want it
-- on the calendar?" nudge — is a row in `messages`. Stream cards are no
-- longer a parallel feed; they're the action-state behind specific
-- inline-rendered messages.
--
-- This migration adds the link. It does NOT yet change behaviour:
--   - existing stream_cards remain orphaned (no linked message); the
--     Today/Dashboard view continues to query them as today.
--   - new card writes still won't auto-create a message — that's A.2.
--   - the message renderer continues to ignore stream_card_id — A.5
--     adds the inline-action-nudge component.
--
-- After A.1 the schema supports the unified Canvas timeline. After A.2
-- producers fill it. After A.5 the renderer dispatches on it. After A.4
-- the Today screen moves to Dashboard. The whole Phase A is mechanical
-- once the spine is here.
--
-- FK direction (message → card) rather than the reverse:
--   - the renderer iterates messages and dispatches on stream_card_id
--     (presence = "render as action nudge inline")
--   - card resolution flips message-surface state in place (no reverse
--     lookup needed when the user dismisses)
--   - ON DELETE SET NULL: we don't hard-delete cards (status flag
--     instead), so this is defensive. If a card row does get deleted
--     the message becomes a plain text turn — no broken FK.
--
-- UNIQUE constraint: 1:1. If a card needs to re-surface later (escalation
-- after N days), we'll model that as a *new* message that references the
-- *same* card, lifting this constraint. Right now 1:1 matches the UX:
-- each card has one canonical surface message in the conversation.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS stream_card_id TEXT
    REFERENCES stream_cards(id) ON DELETE SET NULL;

-- Partial unique index — only enforces 1:1 when stream_card_id is set.
-- Plain assistant messages (chat replies, briefings) leave the column
-- NULL and don't participate in the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_message_per_stream_card
  ON messages(stream_card_id)
  WHERE stream_card_id IS NOT NULL;

-- Index for the reverse direction too — if a card is updated/dismissed we
-- need to find its surface message to update render state. NULL-safe via
-- the partial WHERE.
CREATE INDEX IF NOT EXISTS idx_messages_stream_card
  ON messages(stream_card_id)
  WHERE stream_card_id IS NOT NULL;
