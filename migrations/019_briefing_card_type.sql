ALTER TABLE stream_cards DROP CONSTRAINT IF EXISTS stream_cards_card_type_check;
ALTER TABLE stream_cards
  ADD CONSTRAINT stream_cards_card_type_check
  CHECK (card_type IN (
    'collision', 'extraction', 'unfinished_business',
    'reminder', 'document_extracted', 'calendar_added',
    'proactive_nudge', 'weekly_digest',
    'contradiction', 'stale_fact', 'pattern', 'care_standard_lapsed',
    'shopping', 'briefing'
  ));
