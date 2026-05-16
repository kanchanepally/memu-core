import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import { Logo as MemuLogo } from './Marks';

interface Props {
  /** Memu's spoken text. Renders as the primary line of the bubble. */
  text: string;
  /** Optional helper line under the main text — used for the "why we're asking"
   *  privacy framing. Italicised, smaller, tertiary text colour. */
  helper?: string;
  /** Variant: "speaking" (default — soft tertiary surface) or "ack" (confirmation
   *  after a successful answer — slightly different chip to feel like a beat). */
  variant?: 'speaking' | 'ack';
}

/**
 * MemuBubble — a chat-bubble for Memu's voice during conversational
 * onboarding. Pinned to the left with a small Memu mark, soft tertiary
 * surface (the "AI element" colour from Indigo Sanctuary). Differs from
 * AIInsightCard which is a Today-tab card; this is dialog-shaped.
 */
export default function MemuBubble({ text, helper, variant = 'speaking' }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <MemuLogo size={20} color={colors.primary} color2={colors.primaryContainer} showRing={false} />
      </View>
      <View style={[styles.bubble, variant === 'ack' && styles.bubbleAck]}>
        {variant === 'ack' ? (
          <View style={styles.ackHeader}>
            <Ionicons name="sparkles" size={12} color={colors.tertiary} />
            <Text style={styles.ackLabel}>Memu</Text>
          </View>
        ) : null}
        <Text style={styles.text}>{text}</Text>
        {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tertiaryFixed,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  bubble: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: 6,
    borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.low,
  },
  bubbleAck: {
    backgroundColor: colors.tertiaryContainer,
  },
  ackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  ackLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  text: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    lineHeight: 24,
  },
  helper: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
    marginTop: spacing.sm,
    lineHeight: 18,
  },
});
