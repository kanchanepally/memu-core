/**
 * Pure-logic tests for the deterministic list-command fast path.
 * Only detectListCommand is tested here — handleListCommand touches the DB.
 */

import { describe, it, expect } from 'vitest';
import { detectListCommand } from './listCommands';

describe('detectListCommand — shopping patterns', () => {
  it('matches "add X to the shopping list"', () => {
    const r = detectListCommand('add milk to the shopping list');
    expect(r).toEqual({ kind: 'shopping', items: ['Milk'] });
  });

  it('matches "please add X to my shopping list"', () => {
    const r = detectListCommand('please add bread to my shopping list');
    expect(r).toEqual({ kind: 'shopping', items: ['Bread'] });
  });

  it('matches "can you add X to our grocery list"', () => {
    const r = detectListCommand('can you add eggs to our grocery list');
    expect(r).toEqual({ kind: 'shopping', items: ['Eggs'] });
  });

  it('matches "put X on the shopping list"', () => {
    const r = detectListCommand('put onions on the shopping list');
    expect(r).toEqual({ kind: 'shopping', items: ['Onions'] });
  });

  it('splits a list of items on "and"', () => {
    const r = detectListCommand('add milk and bread and eggs to the shopping list');
    expect(r).toEqual({ kind: 'shopping', items: ['Milk', 'Bread', 'Eggs'] });
  });

  it('splits a list of items on commas', () => {
    const r = detectListCommand('add milk, bread, eggs to the shopping list');
    expect(r).toEqual({ kind: 'shopping', items: ['Milk', 'Bread', 'Eggs'] });
  });

  it('mixes commas and "and"', () => {
    const r = detectListCommand('add milk, bread and eggs to the shopping list');
    expect(r).toEqual({ kind: 'shopping', items: ['Milk', 'Bread', 'Eggs'] });
  });

  it('strips leading articles from each item', () => {
    const r = detectListCommand('add some milk and a loaf of bread to the shopping list');
    expect(r).toEqual({ kind: 'shopping', items: ['Milk', 'Loaf of bread'] });
  });

  it('accepts "grocery" / "groceries" / "market" as synonyms', () => {
    expect(detectListCommand('add milk to the grocery list')?.kind).toBe('shopping');
    expect(detectListCommand('add milk to the groceries list')?.kind).toBe('shopping');
    expect(detectListCommand('add milk to the market list')?.kind).toBe('shopping');
  });

  it('matches "need X from the shop" form', () => {
    const r = detectListCommand('need milk from the shop');
    expect(r).toEqual({ kind: 'shopping', items: ['Milk'] });
  });

  it('matches "I need to buy X from the store" form', () => {
    const r = detectListCommand('I need to buy eggs from the store');
    expect(r).toEqual({ kind: 'shopping', items: ['Eggs'] });
  });

  it('is case-insensitive', () => {
    const r = detectListCommand('ADD MILK TO THE SHOPPING LIST');
    expect(r).toEqual({ kind: 'shopping', items: ['Milk'] });
  });

  it('tolerates a trailing period', () => {
    const r = detectListCommand('add milk to the shopping list.');
    expect(r).toEqual({ kind: 'shopping', items: ['Milk'] });
  });
});

describe('detectListCommand — task patterns', () => {
  it('matches "add X to the task list"', () => {
    const r = detectListCommand('add call the plumber to the task list');
    expect(r).toEqual({ kind: 'task', items: ['Call the plumber'] });
  });

  it('matches "add X to my todo list"', () => {
    const r = detectListCommand('add book dentist to my todo list');
    expect(r).toEqual({ kind: 'task', items: ['Book dentist'] });
  });

  it('matches "add X to the to-do list"', () => {
    const r = detectListCommand('add file taxes to the to-do list');
    expect(r).toEqual({ kind: 'task', items: ['File taxes'] });
  });

  it('matches "add X to the to do list" (two words)', () => {
    const r = detectListCommand('add email school to the to do list');
    expect(r).toEqual({ kind: 'task', items: ['Email school'] });
  });

  it('matches "add X to the jobs list"', () => {
    const r = detectListCommand('add mow the lawn to the jobs list');
    expect(r).toEqual({ kind: 'task', items: ['Mow the lawn'] });
  });

  it('matches "remind me to X"', () => {
    const r = detectListCommand('remind me to renew the MOT');
    expect(r).toEqual({ kind: 'task', items: ['Renew the MOT'] });
  });

  it('matches "please remind me to X"', () => {
    const r = detectListCommand('please remind me to pay the council tax');
    expect(r).toEqual({ kind: 'task', items: ['Pay the council tax'] });
  });
});

describe('detectListCommand — non-matches', () => {
  it('returns null for plain chat', () => {
    expect(detectListCommand('how are you today?')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(detectListCommand('')).toBeNull();
    expect(detectListCommand('   ')).toBeNull();
  });

  it('returns null for overly long input', () => {
    expect(detectListCommand('a'.repeat(401))).toBeNull();
  });

  it('returns null when no items are present after the verb', () => {
    expect(detectListCommand('add to the shopping list')).toBeNull();
  });

  it('does not match arbitrary sentences that mention "shopping list"', () => {
    expect(detectListCommand('the shopping list is on the fridge')).toBeNull();
    expect(detectListCommand('what is on the shopping list?')).toBeNull();
  });

  it('does not match conversational mentions of "todo"', () => {
    expect(detectListCommand('I have so much to do today')).toBeNull();
  });
});
