-- Bug 3 — committed list items (tasks, shopping, custom).
--
-- Before this table: `handleListCommand` wrote tasks and shopping to
-- `stream_cards` with card_type='extraction' / 'shopping'. That conflated
-- two things the user experiences differently: AI-extracted proposals
-- ("I noticed 'buy milk' in a group message — accept?") live in
-- stream_cards; items the user committed to a list ("add milk to shopping")
-- live here. The Lists tab reads from here exclusively; stream_cards'
-- /api/stream/to-shopping action moves a proposal into list_items.
--
-- list_type values:
--   shopping — grocery list. Today-tab sidebar + Lists/Shopping render this.
--   task     — todos. Lists/Tasks renders this.
--   custom   — user-named lists (later). Not surfaced in UI yet.
--
-- status values:
--   pending — open
--   done    — completed; kept for "recently done" and audit
--
-- source_stream_card_id: when an item came from a proposal that was
-- accepted via /api/stream/to-shopping, we keep the origin for provenance.

CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  family_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  list_type TEXT NOT NULL CHECK (list_type IN ('shopping', 'task', 'custom')),
  list_name TEXT,  -- NULL for shopping/task, required for custom
  item_text TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  source TEXT,  -- 'chat' | 'manual' | 'mobile' | 'pwa' | 'extraction' | 'whatsapp' | 'telegram'
  source_message_id TEXT,
  source_stream_card_id TEXT REFERENCES stream_cards(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_list_items_family_type_status
  ON list_items(family_id, list_type, status);

CREATE INDEX IF NOT EXISTS idx_list_items_created
  ON list_items(created_at DESC);

-- One-time migration: move existing shopping stream_cards into list_items.
-- Preserves id linkage via source_stream_card_id so the origin is auditable.
-- Uses WHERE NOT EXISTS so re-running is a no-op.
INSERT INTO list_items (family_id, list_type, item_text, note, status, source, source_message_id, source_stream_card_id, created_at)
SELECT
  sc.family_id,
  'shopping',
  sc.title,
  NULLIF(sc.body, ''),
  CASE WHEN sc.status = 'active' THEN 'pending' ELSE 'done' END,
  COALESCE(sc.source, 'manual'),
  sc.source_message_id,
  sc.id,
  sc.created_at
FROM stream_cards sc
WHERE sc.card_type = 'shopping'
  AND NOT EXISTS (
    SELECT 1 FROM list_items li WHERE li.source_stream_card_id = sc.id
  );

-- Retire the migrated shopping rows so they don't double-render on Today.
-- Kept as 'resolved' (not deleted) for audit trail.
UPDATE stream_cards
SET status = 'resolved'
WHERE card_type = 'shopping'
  AND status = 'active';

COMMENT ON TABLE list_items IS
  'Committed list items (shopping, tasks, custom). Bug 3.';
