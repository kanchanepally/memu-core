/**
 * Card-type display metadata.
 *
 * stream_cards.card_type is an opaque enum on the server (see the SQL CHECK
 * in migration 019_briefing_card_type.sql). The user doesn't want to read
 * "care_standard_lapsed" — they want "OVERDUE". This module maps each
 * enum value to:
 *   - a short ALL-CAPS eyebrow shown above the title
 *   - an Ionicon name for the leading accent
 *   - a visual tone: 'neutral' (indigo accent, the default — informational
 *     extractions / shopping / nudges) or 'attention' (amber accent — things
 *     the family should look at: contradictions, lapses, stale facts)
 *
 * Mirrored in the PWA via the same mapping inline (no shared bundle yet);
 * keep the two in sync when extending. The chat renderer also uses 'tone'
 * to switch a subtle left-border colour so action nudges visually distinct
 * from regular Memu replies at a glance.
 */

import type { Ionicons } from '@expo/vector-icons';

export type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type NudgeTone = 'neutral' | 'attention';

export interface CardTypeDisplay {
  label: string;
  icon: IoniconName;
  tone: NudgeTone;
}

const DISPLAY: Record<string, CardTypeDisplay> = {
  shopping: { label: 'Shopping', icon: 'basket-outline', tone: 'neutral' },
  extraction: { label: 'Task', icon: 'checkbox-outline', tone: 'neutral' },
  reminder: { label: 'Reminder', icon: 'alarm-outline', tone: 'neutral' },
  document_extracted: { label: 'From document', icon: 'document-text-outline', tone: 'neutral' },
  calendar_added: { label: 'Calendar', icon: 'calendar-outline', tone: 'neutral' },
  proactive_nudge: { label: 'Nudge', icon: 'sparkles-outline', tone: 'neutral' },
  weekly_digest: { label: 'Digest', icon: 'newspaper-outline', tone: 'neutral' },
  pattern: { label: 'Pattern', icon: 'trending-up-outline', tone: 'neutral' },
  briefing: { label: 'Briefing', icon: 'sunny-outline', tone: 'neutral' },
  // Attention-tone — things the family should look at.
  contradiction: { label: 'Check this', icon: 'warning-outline', tone: 'attention' },
  stale_fact: { label: 'Stale info', icon: 'time-outline', tone: 'attention' },
  unfinished_business: { label: 'Unfinished', icon: 'hourglass-outline', tone: 'attention' },
  collision: { label: 'Collision', icon: 'git-compare-outline', tone: 'attention' },
  care_standard_lapsed: { label: 'Overdue', icon: 'alert-circle-outline', tone: 'attention' },
};

const FALLBACK: CardTypeDisplay = {
  label: 'Note',
  icon: 'chatbubble-ellipses-outline',
  tone: 'neutral',
};

export function getCardTypeDisplay(cardType?: string | null): CardTypeDisplay {
  if (!cardType) return FALLBACK;
  return DISPLAY[cardType] ?? FALLBACK;
}
