import { describe, it, expect } from 'vitest';
import { pickPrompt, getPromptById, listPromptCatalogue } from './captureNudges';

describe('captureNudges.pickPrompt', () => {
  const PROFILE_A = 'profile-aaaaaaaa';
  const PROFILE_B = 'profile-bbbbbbbb';

  it('returns a valid prompt for any profile + datetime', () => {
    const prompt = pickPrompt(PROFILE_A, new Date('2026-05-12T11:00:00Z'));
    expect(prompt).toBeTruthy();
    expect(typeof prompt.id).toBe('string');
    expect(typeof prompt.notification).toBe('string');
    expect(typeof prompt.question).toBe('string');
    expect(typeof prompt.hint).toBe('string');
  });

  it('is deterministic for the same profile + slot + day', () => {
    const t = new Date('2026-05-12T11:00:00Z');
    const a = pickPrompt(PROFILE_A, t);
    const b = pickPrompt(PROFILE_A, t);
    expect(a.id).toBe(b.id);
  });

  it('picks different prompts for morning vs afternoon slot same day', () => {
    // Construct in local time so the slot boundary (hour 14) is unambiguous
    // regardless of test-machine timezone.
    const morning = pickPrompt(PROFILE_A, new Date(2026, 4, 12, 11, 0));
    const afternoon = pickPrompt(PROFILE_A, new Date(2026, 4, 12, 16, 0));
    expect(morning.id).not.toBe(afternoon.id);
  });

  it('profile-salted: at least one of 8 profiles gets a different prompt in the same slot', () => {
    // Two specific profileIds may hash to the same prompt mod-catalogue
    // (12.5% collision chance for any pair). The aggregate guarantee is
    // that the catalogue spread is non-degenerate — across 8 profiles we
    // should see at least 2 distinct prompts in the same slot.
    const t = new Date(2026, 4, 12, 11, 0);
    const ids = new Set<string>();
    for (let i = 0; i < 8; i++) {
      ids.add(pickPrompt(`profile-${i}xyz`, t).id);
    }
    expect(ids.size).toBeGreaterThanOrEqual(2);
  });

  it('returns a prompt from the catalogue', () => {
    const catalogue = listPromptCatalogue();
    const prompt = pickPrompt(PROFILE_A, new Date());
    expect(catalogue.some(c => c.id === prompt.id)).toBe(true);
  });

  it('cycles over the week without picking the same prompt twice in a single day for one profile', () => {
    // Walk 7 days × 2 slots = 14 slots; verify same-day pair is never identical.
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const d = new Date(2026, 4, 12 + dayOffset);
      const morning = pickPrompt(PROFILE_A, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 11));
      const afternoon = pickPrompt(PROFILE_A, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 16));
      expect(morning.id).not.toBe(afternoon.id);
    }
  });
});

describe('captureNudges.getPromptById', () => {
  it('returns the prompt for a known id', () => {
    const prompt = getPromptById('today-residue');
    expect(prompt).not.toBeNull();
    expect(prompt?.id).toBe('today-residue');
  });

  it('returns null for an unknown id', () => {
    expect(getPromptById('does-not-exist')).toBeNull();
  });
});

describe('captureNudges.listPromptCatalogue', () => {
  it('returns at least 8 prompts', () => {
    expect(listPromptCatalogue().length).toBeGreaterThanOrEqual(8);
  });

  it('returns prompts with unique ids', () => {
    const catalogue = listPromptCatalogue();
    const ids = new Set(catalogue.map(p => p.id));
    expect(ids.size).toBe(catalogue.length);
  });

  it('returns a copy — mutating the result does not affect future calls', () => {
    const first = listPromptCatalogue();
    first.pop();
    const second = listPromptCatalogue();
    expect(second.length).toBe(first.length + 1);
  });

  it('every prompt has non-empty notification, question, and hint', () => {
    for (const p of listPromptCatalogue()) {
      expect(p.notification.length).toBeGreaterThan(0);
      expect(p.question.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
      // Notification body short enough for a lock-screen line.
      expect(p.notification.length).toBeLessThanOrEqual(100);
    }
  });
});
