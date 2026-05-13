/**
 * Card action → UI handler mapping.
 *
 * Source of truth for "given a stream_card's action descriptor, what does
 * tapping it actually do". Today screen and chat surface (inline action
 * nudges) both consume this so the action behaviour can't drift between
 * surfaces.
 *
 * Action shapes coexist (see `src/canvas/timeline.ts` server-side type):
 *
 *   - Legacy reflection / standards shape:
 *       { type: 'dismiss' | 'standard_complete' | 'open_space', label, ... }
 *   - Briefing-action shape:
 *       { kind: 'reply_draft' | 'add_to_list' | 'add_calendar_event' |
 *               'update_space', label, payload }
 *
 * Each handler talks to an existing /api/stream/* endpoint. On success the
 * caller's `onResolve` fires so the host UI can transition the card out
 * (filter from feed, mark message as resolved, etc).
 */

import {
  dismissCard,
  resolveCard,
  completeCareStandard,
  executeAddToListAction,
  executeAddCalendarEventAction,
  executeUpdateSpaceAction,
  ackReplyDraftAction,
} from './api';
import type { Ionicons } from '@expo/vector-icons';

export type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface CardActionDescriptor {
  label: string;
  icon?: IoniconName;
  variant: 'primary' | 'secondary' | 'ghost';
  onPress: () => Promise<void> | void;
}

export interface CardActionDeps {
  /** Called when an action completes and the card has been resolved /
   *  dismissed server-side. Host filters the card from its list (today
   *  feed) or marks the message resolved (chat surface). */
  onResolve: (outcome: 'resolved' | 'dismissed', message?: string) => void;
  /** Surfaces a non-fatal failure to the user (toast or inline error). */
  onError: (message: string) => void;
  /** Reply-draft actions need somewhere to put the draft for the user to
   *  preview + copy. Today screen opens a modal; chat could inline an
   *  expander. Caller chooses. Omit and reply_draft buttons collapse to
   *  no-ops so they don't render. */
  onReplyDraftRequested?: (preview: {
    cardId: string;
    actionIndex: number;
    draftText: string;
    recipient?: string;
  }) => void;
  /** Open-space actions need navigation. Caller injects a router push.
   *  Omit and open_space buttons collapse to no-ops. */
  onOpenSpace?: () => void;
}

export interface RawCardAction {
  label?: string;
  type?: string;
  kind?: string;
  standardId?: string;
  standard_id?: string;
  payload?: {
    draft_text?: string;
    to_anonymous_label?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * Default actions for a card with no explicit `actions` payload. Backfilled
 * cards (migration 034) and any producer that forgot to attach actions
 * fall back to this — every nudge needs at least one way to resolve so
 * the bubble doesn't dead-end. The defaults vary by card type: things
 * Memu extracted that mirror an existing surface (shopping → Lists tab,
 * documents → Spaces) offer an Open action; everything else gets a
 * straight Mark done + Dismiss pair.
 */
export function defaultActionsForCardType(cardType?: string | null): RawCardAction[] {
  // 'resolve' marks the card done via /api/stream/resolve (no
  // standard-complete coupling). 'dismiss' hides it without completion.
  // Every card gets these two as a minimum so the bubble doesn't
  // dead-end on backfilled rows (migration 034) or producers that
  // forgot to attach explicit actions.
  return [
    { type: 'resolve', label: 'Mark done' },
    { type: 'dismiss', label: 'Dismiss' },
  ];
}

export function mapCardActionsToHandlers(
  cardId: string,
  actions: RawCardAction[],
  deps: CardActionDeps,
): CardActionDescriptor[] {
  const handlers: CardActionDescriptor[] = [];

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];

    // Briefing-action shape — { kind, label, payload }
    if (typeof action.kind === 'string') {
      const handler = buildBriefingActionHandler(cardId, index, action, deps);
      if (handler) handlers.push(handler);
      continue;
    }

    // Legacy shape — { type, label, ... }
    if (typeof action.type === 'string') {
      const handler = buildLegacyActionHandler(cardId, action, deps);
      if (handler) handlers.push(handler);
      continue;
    }
  }

  return handlers;
}

function buildBriefingActionHandler(
  cardId: string,
  index: number,
  action: RawCardAction,
  deps: CardActionDeps,
): CardActionDescriptor | null {
  switch (action.kind) {
    case 'add_to_list':
      return {
        label: action.label || 'Add to list',
        icon: 'basket-outline',
        variant: 'primary',
        onPress: async () => {
          const { data, error } = await executeAddToListAction(cardId, index);
          if (error) return deps.onError(error);
          const count = data?.added ?? 0;
          deps.onResolve('resolved', `Added ${count} item${count === 1 ? '' : 's'}`);
        },
      };
    case 'add_calendar_event':
      return {
        label: action.label || 'Add to calendar',
        icon: 'calendar-outline',
        variant: 'primary',
        onPress: async () => {
          const { error } = await executeAddCalendarEventAction(cardId, index);
          if (error) return deps.onError(error);
          deps.onResolve('resolved', 'Event added to calendar');
        },
      };
    case 'update_space':
      return {
        label: action.label || 'Update Space',
        icon: 'document-text-outline',
        variant: 'primary',
        onPress: async () => {
          const { error } = await executeUpdateSpaceAction(cardId, index);
          if (error) return deps.onError(error);
          deps.onResolve('resolved', 'Space updated');
        },
      };
    case 'reply_draft':
      if (!deps.onReplyDraftRequested) return null;
      return {
        label: action.label || 'Draft reply',
        icon: 'chatbubble-outline',
        variant: 'primary',
        onPress: () => {
          deps.onReplyDraftRequested?.({
            cardId,
            actionIndex: index,
            draftText: action.payload?.draft_text || '',
            recipient: action.payload?.to_anonymous_label,
          });
        },
      };
    default:
      return null;
  }
}

function buildLegacyActionHandler(
  cardId: string,
  action: RawCardAction,
  deps: CardActionDeps,
): CardActionDescriptor | null {
  switch (action.type) {
    case 'dismiss':
      return {
        label: action.label || 'Dismiss',
        variant: 'ghost',
        onPress: async () => {
          await dismissCard(cardId);
          deps.onResolve('dismissed');
        },
      };
    case 'resolve':
      // Generic mark-done for cards without an attached care-standard.
      // Default for backfilled cards (migration 034) and any producer
      // that didn't attach explicit actions.
      return {
        label: action.label || 'Mark done',
        icon: 'checkmark',
        variant: 'primary',
        onPress: async () => {
          const { error } = await resolveCard(cardId);
          if (error) return deps.onError(error);
          deps.onResolve('resolved', 'Marked done');
        },
      };
    case 'standard_complete': {
      const standardId = (action.standard_id || action.standardId) as string | undefined;
      if (!standardId) return null;
      return {
        label: action.label || 'Mark done',
        icon: 'checkmark',
        variant: 'primary',
        onPress: async () => {
          const { error } = await completeCareStandard(standardId);
          if (error) return deps.onError(error);
          await resolveCard(cardId);
          deps.onResolve('resolved', 'Marked complete');
        },
      };
    }
    case 'open_space':
      if (!deps.onOpenSpace) return null;
      return {
        label: action.label || 'Open Space',
        icon: 'arrow-forward',
        variant: 'secondary',
        onPress: () => deps.onOpenSpace?.(),
      };
    default:
      return null;
  }
}

/**
 * Helper finalisers for callers that need to clean up after the user
 * completes a reply-draft preview (e.g. copies the draft to clipboard).
 * Encapsulates the ack call so callers don't need to know the endpoint.
 */
export async function ackReplyDraftCopied(cardId: string, actionIndex: number): Promise<void> {
  await ackReplyDraftAction(cardId, actionIndex);
}
