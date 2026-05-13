-- 034_backfill_stream_card_messages.sql
--
-- Phase A follow-up — one-time backfill of message rows for stream_cards
-- that pre-date A.2's producer migration.
--
-- After A.1 (schema spine) and A.2 (producers dual-writing), new cards
-- land as both a stream_cards row AND a linked messages row, so the chat
-- surface shows them inline. Cards created BEFORE the deploy have no
-- linked message — they only show on the Today/Dashboard feed. That
-- left Hareesh staring at a chat surface with no inline nudges
-- immediately after pulling the deploy on 2026-05-13.
--
-- This migration creates linked message rows for active stream_cards
-- from the last 14 days that don't already have one. Cards older than
-- 14 days, or already resolved/dismissed, stay legacy on Dashboard.
-- 'briefing' + 'shopping' card types are excluded — same reason as
-- the /api/dashboard/brief filter (briefings live in chat already via
-- a different mechanism; shopping has its own pill).
--
-- Idempotent on re-run: the join against messages.stream_card_id
-- ensures we don't double-insert.
--
-- Three sequential steps (not one CTE chain — data-modifying CTEs run
-- concurrently in Postgres, which breaks the conversation-then-message
-- ordering this needs).

-- Step 1 — make sure every profile that has eligible cards has at
-- least one conversation. Profiles that already have a conversation
-- are filtered out by the LEFT JOIN.
INSERT INTO conversations (profile_id)
SELECT DISTINCT sc.family_id
  FROM stream_cards sc
  LEFT JOIN messages m ON m.stream_card_id = sc.id
  LEFT JOIN conversations c ON c.profile_id = sc.family_id
 WHERE sc.status = 'active'
   AND sc.created_at > NOW() - INTERVAL '14 days'
   AND sc.card_type NOT IN ('briefing', 'shopping')
   AND m.id IS NULL
   AND c.id IS NULL;

-- Step 2 — insert one message per eligible card, linked to the most
-- recent conversation for that profile (which after Step 1 is
-- guaranteed to exist for every eligible card).
INSERT INTO messages (
  id,
  conversation_id,
  profile_id,
  role,
  content_response_translated,
  channel,
  metadata,
  stream_card_id,
  created_at
)
SELECT
  'card-' || sc.id,
  conv.id,
  sc.family_id,
  'assistant',
  -- Same renderBody shape postCardAsMessage uses for action nudges:
  -- title + blank line + body, trimmed. The chat renderer reads from
  -- metadata.cardTitle / cardBody separately for the bubble, so this
  -- field acts as the back-compat fallback.
  trim(both E'\n' from sc.title || E'\n\n' || COALESCE(sc.body, '')),
  -- channel='backfill' is informational; the renderer doesn't branch
  -- on it. Keeps the row's provenance legible in the ledger.
  'backfill',
  jsonb_build_object(
    'type', 'action_nudge',
    'cardTitle', sc.title,
    'cardBody', COALESCE(sc.body, ''),
    'cardActions', COALESCE(sc.actions, '[]'::jsonb),
    'backfilled', true
  ),
  sc.id,
  -- Preserve the card's original timestamp so the message sorts where
  -- the card was created, not at the migration moment. Otherwise every
  -- backfilled card would land simultaneously at "now", flattening
  -- the chat's chronological order.
  sc.created_at
FROM stream_cards sc
LEFT JOIN messages existing ON existing.stream_card_id = sc.id
JOIN LATERAL (
  SELECT id FROM conversations
   WHERE profile_id = sc.family_id
   ORDER BY started_at DESC LIMIT 1
) conv ON true
WHERE sc.status = 'active'
  AND sc.created_at > NOW() - INTERVAL '14 days'
  AND sc.card_type NOT IN ('briefing', 'shopping')
  AND existing.id IS NULL;

-- Step 3 — rebuild the denormalised message_count on every affected
-- conversation. Cheap recompute from the source of truth; matches
-- what postCardAsMessage's UPDATE conversations SET message_count +=
-- 1 would have produced if the cards had landed via the helper
-- originally.
UPDATE conversations c
   SET message_count = (
     SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
   )
 WHERE c.id IN (
   SELECT DISTINCT m.conversation_id
     FROM messages m
    WHERE m.metadata->>'backfilled' = 'true'
 );
