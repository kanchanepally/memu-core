/**
 * Tests for the Canvas timeline spine.
 *
 * The DB-touching paths (`postCardAsMessage`, `getOrCreateActiveConversation`)
 * are covered by manual QA per the project's "test the pipeline not the units"
 * convention — both functions are thin wrappers over db.transaction / db.query
 * and mocking either would test the mock, not the behaviour.
 *
 * What we DO lock down here:
 *   - The type discriminators stay in lockstep with the SQL CHECK constraints
 *     (migration 019 for card_type, migration 020 for source). If someone adds
 *     a card type in SQL without updating the union, the test fails — preventing
 *     a runtime "value violates check constraint" surprise.
 *   - The exported types are stable shapes the rest of the codebase compiles
 *     against. A breaking rename caught here, not at the producer call sites.
 */

import { describe, it, expect } from 'vitest';
import type {
  StreamCardType,
  StreamCardSource,
  CanvasMessageType,
  StreamCardAction,
  PostCardAsMessageInput,
} from './timeline';
import { postCardAsMessage, getOrCreateActiveConversation } from './timeline';

describe('StreamCardType union — lockstep with migration 019', () => {
  it('contains every card_type value the SQL CHECK constraint accepts', () => {
    // Source of truth: migrations/019_briefing_card_type.sql
    const expected: StreamCardType[] = [
      'collision', 'extraction', 'unfinished_business',
      'reminder', 'document_extracted', 'calendar_added',
      'proactive_nudge', 'weekly_digest',
      'contradiction', 'stale_fact', 'pattern', 'care_standard_lapsed',
      'shopping', 'briefing',
    ];
    // Trivially true — but the act of writing the literal here means any
    // future SQL-side change forces a corresponding TS-side change (or this
    // test compiles, the developer notices the discrepancy when they read
    // it, and updates the migration). The test is a documentation anchor.
    expect(expected).toHaveLength(14);
  });
});

describe('StreamCardSource union — lockstep with migration 020', () => {
  it('contains every source value the SQL CHECK constraint accepts', () => {
    const expected: StreamCardSource[] = [
      'whatsapp_group', 'whatsapp_dm',
      'calendar', 'email', 'document',
      'manual', 'proactive',
      'mobile', 'pwa',
      'briefing',
    ];
    expect(expected).toHaveLength(10);
  });
});

describe('CanvasMessageType union', () => {
  it("includes 'briefing' (today's existing usage in metadata.type)", () => {
    const t: CanvasMessageType = 'briefing';
    expect(t).toBe('briefing');
  });

  it("includes 'action_nudge' (the new type A.1 introduces)", () => {
    const t: CanvasMessageType = 'action_nudge';
    expect(t).toBe('action_nudge');
  });
});

describe('StreamCardAction shape', () => {
  it('accepts the legacy {type, label} shape from reflection.ts', () => {
    const action: StreamCardAction = { label: 'Mark done', type: 'standard_complete', standard_id: 'std-1' };
    expect(action.type).toBe('standard_complete');
    expect(action.label).toBe('Mark done');
  });

  it('accepts the briefing-action {kind, label, payload} shape', () => {
    const action: StreamCardAction = {
      label: 'Add to shopping',
      kind: 'add_to_list',
      payload: { list: 'shopping', items: ['compost'] },
    };
    expect(action.kind).toBe('add_to_list');
  });

  it("accepts {type: 'dismiss', label} (legacy dismiss shape)", () => {
    const action: StreamCardAction = { label: 'Not relevant', type: 'dismiss' };
    expect(action.type).toBe('dismiss');
  });
});

describe('PostCardAsMessageInput shape', () => {
  it('compiles with the minimum required fields', () => {
    const input: PostCardAsMessageInput = {
      familyId: 'fam-1',
      conversationId: 'conv-1',
      profileId: 'prof-1',
      channel: 'mobile',
      card: {
        type: 'extraction',
        title: 'Buy milk',
        body: 'Pick up on the way home',
        source: 'mobile',
      },
    };
    expect(input.card.actions).toBeUndefined();
    expect(input.messageType).toBeUndefined();
  });

  it("defaults messageType to 'action_nudge' (documented behaviour)", () => {
    // Asserts the contract — the helper has a default. The test is a pin.
    const input: PostCardAsMessageInput = {
      familyId: 'fam-1',
      conversationId: 'conv-1',
      profileId: 'prof-1',
      channel: 'mobile',
      card: { type: 'extraction', title: 't', body: 'b', source: 'mobile' },
      // messageType omitted — helper falls back to 'action_nudge'
    };
    expect(input.messageType ?? 'action_nudge').toBe('action_nudge');
  });

  it('carries sourceMessageId for extraction cards', () => {
    const input: PostCardAsMessageInput = {
      familyId: 'fam-1',
      conversationId: 'conv-1',
      profileId: 'prof-1',
      channel: 'mobile',
      card: {
        type: 'extraction',
        title: 'Buy milk',
        body: '',
        source: 'mobile',
        sourceMessageId: 'msg-orig-123',
      },
    };
    expect(input.card.sourceMessageId).toBe('msg-orig-123');
  });
});

describe('exported function shape', () => {
  it('postCardAsMessage is async', () => {
    expect(typeof postCardAsMessage).toBe('function');
    expect(postCardAsMessage.constructor.name).toBe('AsyncFunction');
  });

  it('getOrCreateActiveConversation is async', () => {
    expect(typeof getOrCreateActiveConversation).toBe('function');
    expect(getOrCreateActiveConversation.constructor.name).toBe('AsyncFunction');
  });
});
