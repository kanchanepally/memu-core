import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import GradientButton from './GradientButton';

interface Props {
  title: string;             // the insight headline
  body?: string;             // supporting paragraph
  ctaLabel?: string;
  onCta?: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label?: string;            // small uppercase tag e.g. "Today's brief"
  greeting?: string;         // optional second line e.g. "Good evening, Hareesh"
  dateLabel?: string;        // optional third line e.g. "Wednesday 6 May 2026"
}

/**
 * The AI Insight card — the "alive" element in the system.
 * Tertiary colour iconography, soft radial glow in the top-right.
 * Optional greeting + dateLabel match the PWA's "Today's brief" header
 * stack so the mobile and PWA Today views read the same.
 */
export default function AIInsightCard({
  title,
  body,
  ctaLabel,
  onCta,
  icon = 'sparkles',
  label = 'Memu Insight',
  greeting,
  dateLabel,
}: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.glow} pointerEvents="none" />

      <View style={styles.headerRow}>
        <View style={styles.iconChip}>
          <Ionicons name={icon} size={18} color={colors.tertiary} />
        </View>
        <View style={styles.headerStack}>
          <Text style={styles.label}>{label}</Text>
          {greeting ? <Text style={styles.greeting}>{greeting}</Text> : null}
          {dateLabel ? <Text style={styles.dateLabel}>{dateLabel}</Text> : null}
        </View>
      </View>

      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}

      {ctaLabel && onCta ? (
        <View style={styles.ctaRow}>
          <GradientButton label={ctaLabel} onPress={onCta} size="sm" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.xl,
    overflow: 'hidden',
    position: 'relative',
    ...shadows.high,
  },
  glow: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.tertiaryContainer,
    opacity: 0.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.tertiaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerStack: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  greeting: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
  },
  dateLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  title: {
    fontSize: typography.sizes.lg,
    lineHeight: 26,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    marginBottom: spacing.sm,
    letterSpacing: typography.tracking.tight,
  },
  body: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  ctaRow: {
    flexDirection: 'row',
  },
});
