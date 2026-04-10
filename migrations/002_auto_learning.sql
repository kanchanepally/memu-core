-- Migration 002: Support auto_learning as a context_entries source
-- Also allow 'mobile' as a source (from in-app chat extraction)

ALTER TABLE context_entries DROP CONSTRAINT IF EXISTS context_entries_source_check;
ALTER TABLE context_entries ADD CONSTRAINT context_entries_source_check CHECK (source IN (
  'whatsapp_group', 'whatsapp_dm', 'matrix',
  'google_calendar', 'ical', 'baikal',
  'gmail', 'imap',
  'google_photos', 'immich',
  'document', 'manual',
  'summary_daily', 'summary_weekly',
  'auto_learning', 'mobile'
));
