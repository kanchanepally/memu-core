import { describe, it, expect } from 'vitest';
import { renderRecallCard } from './card';
import { summariseReplay } from './replay';
import type { ReplayDiff } from './types';

function diff(over: Partial<ReplayDiff>): ReplayDiff {
  return {
    id: 'q', query: 'q', passed: true,
    expectedSpaceUris: [], actualSpaceUris: [],
    expectedRetrievalState: 'sourced',
    actualRetrievalPath: 'catalogue', actualRetrievalState: 'sourced',
    missingUris: [], extraUris: [], stateMismatch: false,
    ...over,
  };
}

describe('renderRecallCard', () => {
  it('renders an all-passing run', () => {
    const summary = summariseReplay('c1', new Date('2026-05-15T05:00:00Z'), [
      diff({ id: 'a', passed: true }),
      diff({ id: 'b', passed: true }),
    ]);
    const card = renderRecallCard(summary, null);
    expect(card.title).toMatch(/Retrieval recall · 100%/);
    expect(card.body).toContain('2/2 passing');
    expect(card.body).not.toMatch(/drift/i);
  });

  it('renders a partial run with by-state breakdown', () => {
    const summary = summariseReplay('c1', new Date(), [
      diff({ id: 'a', passed: true, actualRetrievalState: 'sourced' }),
      diff({ id: 'b', passed: false, actualRetrievalState: 'fallback' }),
      diff({ id: 'c', passed: false, actualRetrievalState: 'empty' }),
    ]);
    const card = renderRecallCard(summary, null);
    expect(card.title).toContain('33.3%');
    expect(card.body).toContain('sourced 1/1');
    expect(card.body).toContain('fallback 0/1');
    expect(card.body).toContain('empty 0/1');
  });

  it('flags drift when previous recall was higher', () => {
    const summary = summariseReplay('c1', new Date(), [
      diff({ id: 'a', passed: true }),
      diff({ id: 'b', passed: false }),
    ]);
    const card = renderRecallCard(summary, 80);
    expect(card.body).toMatch(/Drift: down 30/); // 80 → 50
  });

  it('flags improvement when previous was lower', () => {
    const summary = summariseReplay('c1', new Date(), [
      diff({ id: 'a', passed: true }),
      diff({ id: 'b', passed: true }),
    ]);
    const card = renderRecallCard(summary, 50);
    expect(card.body).toMatch(/Drift: up 50/);
  });

  it('omits drift when previous is null', () => {
    const summary = summariseReplay('c1', new Date(), [diff({ id: 'a' })]);
    const card = renderRecallCard(summary, null);
    expect(card.body).not.toMatch(/drift/i);
  });
});
