/**
 * Inline action nudge for the chat Canvas.
 *
 * When extraction / reflection / document-ingestion produces a stream
 * card, the canonical surface for it is a message in the user's
 * conversation (Phase A.1/A.2). This component renders that message:
 *
 *   ┌──────────────────────────────────────┐
 *   │ [📋] Buy compost                    │
 *   │      Pick up on the way home tomorrow│
 *   │                                      │
 *   │ [Add to shopping]  [Dismiss]        │
 *   └──────────────────────────────────────┘
 *
 * Distinct from the Today screen's `StreamCard` (heavier, feed-style).
 * This sits inside a chat bubble — same visual register as a normal
 * Memu reply — with action affordances appended below.
 *
 * Resolution states:
 *   - 'open'      → buttons are tappable
 *   - 'busy'      → button shows spinner while the action runs
 *   - 'resolved'  → buttons fade out; "✓ {outcome}" caption appears
 *   - 'dismissed' → buttons fade out; "Dismissed" caption appears
 *
 * The resolved/dismissed state persists in the bubble (the message stays
 * in chat history as a record of "Memu nudged me about X, I acted"),
 * matching the principle from the Layer Zero brief: the chat IS the
 * audit trail.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../lib/tokens';
import {
  mapCardActionsToHandlers,
  type CardActionDeps,
  type CardActionDescriptor,
  type RawCardAction,
} from '../lib/cardActions';

export type NudgeResolutionState =
  | { kind: 'open' }
  | { kind: 'busy'; actionLabel: string }
  | { kind: 'resolved'; outcome?: string }
  | { kind: 'dismissed' };

interface Props {
  cardId: string;
  title: string;
  body: string;
  actions: RawCardAction[];
  /** Resolved state controlled by parent. Persists across re-render so
   *  closing/reopening a conversation preserves the resolution. */
  state: NudgeResolutionState;
  /** Parent receives action outcomes and updates state. The component is
   *  controlled — never holds resolution state itself. */
  onState: (next: NudgeResolutionState) => void;
  onError: (message: string) => void;
  onReplyDraftRequested?: CardActionDeps['onReplyDraftRequested'];
  onOpenSpace?: CardActionDeps['onOpenSpace'];
}

export default function InlineActionNudge({
  cardId,
  title,
  body,
  actions,
  state,
  onState,
  onError,
  onReplyDraftRequested,
  onOpenSpace,
}: Props) {
  // Memoise handlers — actions array is per-message and stable. The
  // handlers close over a wrapped onResolve that transitions state via
  // the parent's onState callback.
  const handlers = useMemo<CardActionDescriptor[]>(() => {
    return mapCardActionsToHandlers(cardId, actions, {
      onResolve: (outcome, message) => {
        if (outcome === 'dismissed') {
          onState({ kind: 'dismissed' });
        } else {
          onState({ kind: 'resolved', outcome: message });
        }
      },
      onError: (message) => {
        // Restore to open so the user can retry. Surface the message via
        // the parent's error channel (toast).
        onState({ kind: 'open' });
        onError(message);
      },
      onReplyDraftRequested,
      onOpenSpace,
    });
    // cardId + actions identity is the stable key; the deps from the
    // parent are functions which may change identity but always call the
    // same `onState`/`onError`. We don't want to rebuild handlers on
    // every parent render — only when the underlying card changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, actions]);

  // Wrap each handler so the busy state shows the right label and the
  // button is disabled mid-flight.
  const wrappedHandlers = handlers.map((h) => ({
    ...h,
    onPress: async () => {
      onState({ kind: 'busy', actionLabel: h.label });
      try {
        await h.onPress();
      } catch (err) {
        onState({ kind: 'open' });
        onError(err instanceof Error ? err.message : 'Action failed');
      }
    },
  }));

  // Resolution-state render. The bubble persists in chat history; only
  // the action region transitions.
  if (state.kind === 'resolved') {
    return (
      <View style={styles.container}>
        <NudgeHeader title={title} body={body} resolved />
        <View style={styles.resolvedRow}>
          <Ionicons name="checkmark-circle" size={14} color={colors.tertiary} />
          <Text style={styles.resolvedText}>{state.outcome || 'Done'}</Text>
        </View>
      </View>
    );
  }

  if (state.kind === 'dismissed') {
    return (
      <View style={styles.container}>
        <NudgeHeader title={title} body={body} dismissed />
        <View style={styles.resolvedRow}>
          <Ionicons name="close-circle-outline" size={14} color={colors.onSurfaceVariant} />
          <Text style={[styles.resolvedText, { color: colors.onSurfaceVariant }]}>Dismissed</Text>
        </View>
      </View>
    );
  }

  const busy = state.kind === 'busy';

  return (
    <View style={styles.container}>
      <NudgeHeader title={title} body={body} />
      <View style={styles.actionRow}>
        {wrappedHandlers.map((handler) => (
          <ActionButton
            key={handler.label}
            handler={handler}
            disabled={busy}
            spinning={busy && state.kind === 'busy' && state.actionLabel === handler.label}
          />
        ))}
      </View>
    </View>
  );
}

interface HeaderProps {
  title: string;
  body: string;
  resolved?: boolean;
  dismissed?: boolean;
}

function NudgeHeader({ title, body, resolved, dismissed }: HeaderProps) {
  const muted = !!(resolved || dismissed);
  return (
    <View>
      {title.trim().length > 0 ? (
        <Text style={[styles.title, muted && styles.muted]}>{title}</Text>
      ) : null}
      {body.trim().length > 0 ? (
        <Text style={[styles.body, muted && styles.muted]}>{body}</Text>
      ) : null}
    </View>
  );
}

interface ActionButtonProps {
  handler: CardActionDescriptor;
  disabled: boolean;
  spinning: boolean;
}

function ActionButton({ handler, disabled, spinning }: ActionButtonProps) {
  const styleForVariant =
    handler.variant === 'primary'
      ? styles.btnPrimary
      : handler.variant === 'secondary'
        ? styles.btnSecondary
        : styles.btnGhost;
  const textStyleForVariant =
    handler.variant === 'primary'
      ? styles.btnPrimaryText
      : handler.variant === 'secondary'
        ? styles.btnSecondaryText
        : styles.btnGhostText;

  return (
    <Pressable
      onPress={handler.onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        styleForVariant,
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={handler.label}
    >
      {spinning ? (
        <ActivityIndicator
          size="small"
          color={handler.variant === 'primary' ? colors.onPrimary : colors.primary}
        />
      ) : (
        <>
          {handler.icon ? (
            <Ionicons
              name={handler.icon}
              size={14}
              color={handler.variant === 'primary' ? colors.onPrimary : colors.primary}
            />
          ) : null}
          <Text style={textStyleForVariant}>{handler.label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    lineHeight: 22,
  },
  body: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 21,
    marginTop: 2,
  },
  muted: {
    opacity: 0.55,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs + 2,
  },
  resolvedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
  resolvedText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.tertiary,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    minHeight: 32,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnSecondary: {
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnPrimaryText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onPrimary,
  },
  btnSecondaryText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
  },
  btnGhostText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
  },
});
