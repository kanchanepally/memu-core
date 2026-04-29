-- 020_stream_cards_source_check.sql
--
-- Extend the stream_cards.source CHECK to cover the channels that actually
-- exist today. The original whitelist was written when extraction only fired
-- from WhatsApp groups; mobile chat, PWA chat, WhatsApp DMs, WhatsApp self-chat
-- and the briefing engine were all subsequently wired to write stream cards
-- but the schema enum was never extended.
--
-- Symptom (live as of 2026-04-27): mobile chat extractions and briefing card
-- INSERTs silently fail with `violates check constraint
-- "stream_cards_source_check"`. Logged as `[EXTRACTION ERROR]` and
-- `[BRIEFING ERROR]` in docker logs but invisible to users.
--
-- Fix: extend the whitelist. Source values are an internal taxonomy used for
-- filtering and analytics; new entries:
--   - 'whatsapp_dm'    — direct messages (incl. self-chat) on WhatsApp
--   - 'mobile'         — mobile-app chat surface
--   - 'pwa'            — PWA dashboard chat surface
--   - 'briefing'       — cards written by the morning briefing engine
ALTER TABLE stream_cards DROP CONSTRAINT IF EXISTS stream_cards_source_check;
ALTER TABLE stream_cards
  ADD CONSTRAINT stream_cards_source_check
  CHECK (source IN (
    'whatsapp_group', 'whatsapp_dm',
    'calendar', 'email', 'document',
    'manual', 'proactive',
    'mobile', 'pwa',
    'briefing'
  ));
