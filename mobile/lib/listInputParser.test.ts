import { describe, it, expect } from 'vitest';
import { parseDuePhrase, parseQuickInput } from './listInputParser';

const REF_NOW = new Date('2026-04-29T10:00:00Z'); // Wednesday

describe('parseDuePhrase', () => {
  it('returns null for plain text', () => {
    expect(parseDuePhrase('buy milk', REF_NOW)).toBeNull();
    expect(parseDuePhrase('book a holiday', REF_NOW)).toBeNull();
  });

  it('matches today / by today', () => {
    expect(parseDuePhrase('finish report today', REF_NOW)).not.toBeNull();
    expect(parseDuePhrase('finish by today', REF_NOW)).not.toBeNull();
  });

  it('matches tomorrow', () => {
    const r = parseDuePhrase('call mum tomorrow', REF_NOW);
    expect(r).not.toBeNull();
    expect(r!.matched).toBe('tomorrow');
  });

  it('matches "in N days"', () => {
    const r = parseDuePhrase('renew permit in 3 days', REF_NOW);
    expect(r).not.toBeNull();
    expect(r!.matched).toBe('in 3 days');
  });

  it('matches "next week"', () => {
    const r = parseDuePhrase('plan trip next week', REF_NOW);
    expect(r).not.toBeNull();
    expect(r!.matched).toMatch(/next week/);
  });

  it('matches "by Friday" with a lead-in word', () => {
    const r = parseDuePhrase('email Sarah by Friday', REF_NOW);
    expect(r).not.toBeNull();
    expect(r!.matched).toBe('by friday');
  });

  it('does NOT match a bare day-name (avoids "buy a Friday paper" hijacking)', () => {
    expect(parseDuePhrase('buy a Friday paper', REF_NOW)).toBeNull();
  });

  it('"by Friday" on a Wednesday resolves to two days later', () => {
    const r = parseDuePhrase('by Friday', REF_NOW);
    expect(r).not.toBeNull();
    const target = new Date(r!.iso);
    expect(target.getUTCDay()).toBe(5); // Friday in UTC
  });

  it('"by Friday" on a Friday resolves to the next Friday (a week later)', () => {
    const friday = new Date('2026-05-01T10:00:00Z'); // Friday
    const r = parseDuePhrase('by Friday', friday);
    expect(r).not.toBeNull();
    const target = new Date(r!.iso);
    // Should be 7 days later
    expect(target.getTime() - friday.getTime()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
  });

  it('"next Friday" always pushes a week beyond the literal next occurrence', () => {
    const r = parseDuePhrase('next Friday', REF_NOW);
    expect(r).not.toBeNull();
    const target = new Date(r!.iso);
    // From Wed 29 April: next-week Friday = 8 May (9 days away)
    expect(target.getTime() - REF_NOW.getTime()).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
  });
});

describe('parseQuickInput', () => {
  it('passes plain item through unchanged', () => {
    const r = parseQuickInput('buy gravel boards', REF_NOW);
    expect(r.itemText).toBe('buy gravel boards');
    expect(r.listName).toBeNull();
    expect(r.dueAt).toBeNull();
  });

  it('strips #category from anywhere', () => {
    const a = parseQuickInput('buy gravel boards #garden', REF_NOW);
    expect(a.itemText).toBe('buy gravel boards');
    expect(a.listName).toBe('garden');

    const b = parseQuickInput('#garden buy gravel boards', REF_NOW);
    expect(b.itemText).toBe('buy gravel boards');
    expect(b.listName).toBe('garden');

    const c = parseQuickInput('buy #garden gravel boards', REF_NOW);
    expect(c.itemText).toBe('buy gravel boards');
    expect(c.listName).toBe('garden');
  });

  it('lowercases category', () => {
    expect(parseQuickInput('item #Garden', REF_NOW).listName).toBe('garden');
    expect(parseQuickInput('item #DIY', REF_NOW).listName).toBe('diy');
  });

  it('strips a recognised due-date phrase', () => {
    const r = parseQuickInput('email Sarah by Friday', REF_NOW);
    expect(r.itemText).toBe('email Sarah');
    expect(r.dueAt).not.toBeNull();
  });

  it('strips both #category and due phrase', () => {
    const r = parseQuickInput('email Sarah by Friday #work', REF_NOW);
    expect(r.itemText).toBe('email Sarah');
    expect(r.listName).toBe('work');
    expect(r.dueAt).not.toBeNull();
  });

  it('falls back to raw input when stripping leaves nothing', () => {
    const r = parseQuickInput('tomorrow', REF_NOW);
    // The item is just "tomorrow" — we shouldn't end up with an empty item.
    expect(r.itemText).toBe('tomorrow');
    expect(r.dueAt).not.toBeNull();
  });

  it('does not match "Friday" without a lead-in', () => {
    const r = parseQuickInput('buy a Friday Times', REF_NOW);
    expect(r.itemText).toBe('buy a Friday Times');
    expect(r.dueAt).toBeNull();
  });

  it('does not treat #1 (numeric) as a category', () => {
    // The regex requires a leading letter so "#1 priority" is left alone.
    const r = parseQuickInput('top #1 priority', REF_NOW);
    expect(r.itemText).toBe('top #1 priority');
    expect(r.listName).toBeNull();
  });

  it('cleans up trailing punctuation around stripped phrases', () => {
    const r = parseQuickInput('finish report, by Friday.', REF_NOW);
    expect(r.itemText).toMatch(/^finish report\.?$|^finish report$/);
    expect(r.dueAt).not.toBeNull();
  });
});
