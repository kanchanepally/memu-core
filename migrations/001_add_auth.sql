-- Migration 001: Add API key authentication to profiles
-- Run against memu_core database

-- Add api_key and email to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Create index for fast auth lookups
CREATE INDEX IF NOT EXISTS idx_profiles_api_key ON profiles(api_key) WHERE api_key IS NOT NULL;

-- Add shopping card_type if missing (was used in code but not in original schema check constraint)
-- Re-add the check constraint to include 'shopping'
ALTER TABLE stream_cards DROP CONSTRAINT IF EXISTS stream_cards_card_type_check;
ALTER TABLE stream_cards ADD CONSTRAINT stream_cards_card_type_check CHECK (card_type IN (
  'collision', 'extraction', 'unfinished_business',
  'reminder', 'document_extracted', 'calendar_added',
  'proactive_nudge', 'weekly_digest', 'shopping'
));
