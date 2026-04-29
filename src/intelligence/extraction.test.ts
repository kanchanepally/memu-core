import { describe, it, expect } from 'vitest';
import { channelToSource } from './extraction';

describe('channelToSource', () => {
  it('maps WhatsApp group JIDs to whatsapp_group', () => {
    expect(channelToSource('447462616146-1234567890@g.us')).toBe('whatsapp_group');
    expect(channelToSource('120363041234567890@g.us')).toBe('whatsapp_group');
  });

  it('maps WhatsApp direct/self JIDs to whatsapp_dm', () => {
    // Self-chat (your own number) and any other DM both land here.
    expect(channelToSource('447462616146@s.whatsapp.net')).toBe('whatsapp_dm');
    expect(channelToSource('14155551234@s.whatsapp.net')).toBe('whatsapp_dm');
    // Legacy WhatsApp Web suffix.
    expect(channelToSource('447462616146@c.us')).toBe('whatsapp_dm');
  });

  it('maps mobile and pwa channel labels to themselves', () => {
    expect(channelToSource('mobile')).toBe('mobile');
    expect(channelToSource('pwa')).toBe('pwa');
  });

  it('maps manual_list_input to manual', () => {
    // The /api/lists?action=add path emits this channel; it falls back to
    // the manual source value rather than introducing a new one.
    expect(channelToSource('manual_list_input')).toBe('manual');
  });

  it('maps briefing to briefing', () => {
    // Briefing engine writes its own cards with channel='briefing'.
    expect(channelToSource('briefing')).toBe('briefing');
  });

  it('falls back to manual for unknown channels', () => {
    // Unknown channels default to a value the CHECK accepts so we never
    // reach the database with an invalid source — better to mis-categorise
    // than to silently drop the card with a CHECK violation.
    expect(channelToSource('unknown')).toBe('manual');
    expect(channelToSource('telegram')).toBe('manual');
    expect(channelToSource('')).toBe('manual');
  });

  it('every output value matches the schema CHECK whitelist', () => {
    // Locks the helper's range against the schema.sql CHECK. If you extend
    // either, extend the other.
    const allowed = new Set([
      'whatsapp_group', 'whatsapp_dm',
      'calendar', 'email', 'document',
      'manual', 'proactive',
      'mobile', 'pwa',
      'briefing',
    ]);
    const inputs = [
      '447@g.us',
      '447@s.whatsapp.net',
      '447@c.us',
      'mobile',
      'pwa',
      'manual_list_input',
      'briefing',
      'something-novel',
      '',
    ];
    for (const input of inputs) {
      expect(allowed.has(channelToSource(input))).toBe(true);
    }
  });
});
