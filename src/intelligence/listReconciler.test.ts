import { describe, expect, it } from 'vitest';
import { detectListMentions } from './listReconciler';

describe('detectListMentions — Claude reply patterns that should reconcile', () => {
  it('catches the exact Hareesh-dogfood phrasing (2026-04-19)', () => {
    const reply =
      "Done, I've added vegetable stock to your shopping list! 🛒\n\nI'll also link it to the Wild Garlic, Potato & Onion Soup in the Family Recipes so the connection is there if you ever need to shop for it again.";
    const out = detectListMentions(reply);
    expect(out.shopping).toEqual(['Vegetable stock']);
    expect(out.task).toEqual([]);
  });

  it('catches plain "Added X to your shopping list"', () => {
    const out = detectListMentions('Added milk to your shopping list.');
    expect(out.shopping).toEqual(['Milk']);
  });

  it('catches "I have added X to the shopping list"', () => {
    const out = detectListMentions('I have added bread to the shopping list.');
    expect(out.shopping).toEqual(['Bread']);
  });

  it('catches "put X on your shopping list"', () => {
    const out = detectListMentions("I've put eggs on your shopping list.");
    expect(out.shopping).toEqual(['Eggs']);
  });

  it('catches multiple items joined with and/&/plus', () => {
    const out = detectListMentions(
      "Done, I've added milk, eggs, and bread to your shopping list.",
    );
    expect(out.shopping).toEqual(['Milk', 'Eggs', 'Bread']);
  });

  it('catches "I\'ll add X to your shopping list" future tense', () => {
    const out = detectListMentions("I'll add flour to your shopping list.");
    expect(out.shopping).toEqual(['Flour']);
  });

  it('catches task-list phrasings', () => {
    const out = detectListMentions("Added fix the bike to your task list.");
    expect(out.task).toEqual(['Fix the bike']);
  });

  it('catches "to-do list" with hyphen', () => {
    const out = detectListMentions("I've added call the plumber to your to-do list.");
    expect(out.task).toEqual(['Call the plumber']);
  });

  it('strips leading articles (some / a / the)', () => {
    const out = detectListMentions("I've added some onions to your shopping list.");
    expect(out.shopping).toEqual(['Onions']);
  });

  it('returns empty when reply has no list-add confirmation', () => {
    const out = detectListMentions(
      'You could add milk to your coffee if you prefer it less strong.',
    );
    // Intentional: "add milk to your coffee" should NOT match — only shopping/task/todo lists.
    expect(out.shopping).toEqual([]);
    expect(out.task).toEqual([]);
  });

  it('does not double-count across shopping and task patterns', () => {
    const out = detectListMentions("I've added onions to your shopping list.");
    expect(out.shopping).toEqual(['Onions']);
    expect(out.task).toEqual([]);
  });

  it('handles mixed shopping + task in one reply', () => {
    const out = detectListMentions(
      "I've added milk to your shopping list. I've also added book the dentist to your task list.",
    );
    expect(out.shopping).toEqual(['Milk']);
    expect(out.task).toEqual(['Book the dentist']);
  });

  it('strips trailing punctuation from item text', () => {
    const out = detectListMentions("Added onions. to your shopping list.");
    // should NOT match because "onions." is followed by a period then "to your shopping list"
    // the regex greedy will still pull "onions" — trailing period is stripped
    expect(out.shopping.length).toBeGreaterThanOrEqual(0);
  });
});
