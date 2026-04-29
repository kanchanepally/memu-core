-- 023_list_items_due_at.sql
--
-- Add due_at to list_items so the user can mark a deadline on tasks
-- ("call HMRC by Friday"). Surfaces as a date chip in the UI; sorts
-- pending items by due_at within each list group; overdue items get a
-- subtle treatment (sanctuary-muted, not alarm-red).
--
-- Nullable — most items don't have a deadline. Indexed so the Lists tab
-- can sort efficiently. Partial index excludes 'done' rows since a
-- completed item's due_at is not interesting for sorting.
ALTER TABLE list_items
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_list_items_due
  ON list_items (family_id, list_type, due_at ASC NULLS LAST)
  WHERE status = 'pending';
