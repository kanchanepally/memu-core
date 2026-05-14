-- migrations/037_eval_recall_card_type.sql
--
-- Phase 0 of Build Spec 1 — extend stream_cards.card_type to include
-- 'eval_recall' so the nightly retrieval-eval card can land on the
-- Today surface using the existing card pattern (per the spec:
-- "a card on the Today surface is the natural home — reuse the
-- existing card pattern").
--
-- Pattern matches migration 019 (briefing card type) exactly: drop
-- the old CHECK if present, re-add with the full list including the
-- new value. Idempotent.

ALTER TABLE stream_cards DROP CONSTRAINT IF EXISTS stream_cards_card_type_check;
ALTER TABLE stream_cards
  ADD CONSTRAINT stream_cards_card_type_check
  CHECK (card_type IN (
    'collision', 'extraction', 'unfinished_business',
    'reminder', 'document_extracted', 'calendar_added',
    'proactive_nudge', 'weekly_digest',
    'contradiction', 'stale_fact', 'pattern', 'care_standard_lapsed',
    'shopping', 'briefing',
    'eval_recall'
  ));
