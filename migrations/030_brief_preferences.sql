-- 030_brief_preferences.sql
--
-- Fix 1b — Location-aware morning brief.
--
-- Adds `profiles.brief_preferences` JSONB for the per-user customisation
-- surface (location, news sources, topics of interest, thinking-prompt
-- toggle). Single JSONB column rather than a side table because the prefs
-- are profile-scoped, read on every briefing run, and the shape will
-- continue to evolve through the beta. Default = `{}` so existing rows
-- behave identically (fallback to London + default sources) without a
-- backfill.
--
-- Also: unique partial index on `stream_cards` that prevents two briefing
-- cards from landing for the same family on the same UTC day. The
-- screenshot from 2026-05-12 showed two near-identical Chief of Staff
-- briefings stacked in the Today stream — root cause was the briefing
-- generator inserting unconditionally, and the cron + a manual run-now
-- collided. Chat-message persistence already has this idempotency check
-- (see briefing.ts:postBriefingAsChatMessage); the stream_cards path
-- lacked an equivalent.
--
-- The expected JSON shape (documented here so the index of truth lives
-- alongside the column):
--
-- {
--   "location": {                    // optional — falls back to env defaults
--     "lat": 50.3915,
--     "lon": -3.9163,
--     "placeName": "Ivybridge"
--   },
--   "newsSources": [                 // optional — falls back to ALL defaults
--     "bbc-news", "guardian-uk", "regional", "hacker-news", "bbc-tech"
--   ],
--   "topics": ["AI", "gardening"],   // optional — free-text interest tags
--   "thinkingPromptEnabled": true    // optional — defaults to true
-- }

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS brief_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Unique-per-day index on briefing cards. Computed key: family_id +
-- card_type='briefing' + UTC date of created_at. Without this, a second
-- briefing run (manual /api/briefing/run-now during the day, or two cron
-- ticks if the server restarted around 07:00) silently produces duplicate
-- cards in the user's stream.
--
-- The index is partial — non-briefing card types (commitment, prompt,
-- school_letter etc.) are unaffected and can be created as many times as
-- the extraction pipeline produces.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_briefing_card_per_family_per_day
  ON stream_cards (family_id, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE card_type = 'briefing';
