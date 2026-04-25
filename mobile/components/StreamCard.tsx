import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import GradientButton from './GradientButton';

import Markdown from 'react-native-markdown-display';

export interface StreamCardAction {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}

interface Props {
  id: string;
  cardType: string;           // 'task' | 'event' | 'shopping' | etc
  title: string;
  body?: string;
  source?: string;            // 'chat' | 'calendar' | 'document' | ...
  createdAt?: string;
  actions?: StreamCardAction[];
  onDismiss?: () => void;
  onEdit?: () => void;
}

const typeIcons: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  task: 'checkmark-circle-outline',
  event: 'calendar-outline',
  shopping: 'basket-outline',
  reminder: 'alarm-outline',
  note: 'document-text-outline',
  fact: 'bulb-outline',
  briefing: 'newspaper-outline',
};

const sourceColor = (src?: string) => {
  switch (src) {
    case 'chat': return colors.sourceChat;
    case 'calendar': return colors.sourceCalendar;
    case 'email': return colors.sourceEmail;
    case 'document': return colors.sourceDocument;
    case 'chief_of_staff': return colors.primary;
    default: return colors.sourceManual;
  }
};

export default function StreamCard({
  cardType,
  title,
  body,
  source,
  actions = [],
  onDismiss,
  onEdit,
}: Props) {
  const icon = typeIcons[cardType] || 'ellipse-outline';
  const isBriefing = cardType === 'briefing';

  return (
    <View style={[styles.card, isBriefing && styles.briefingCard]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconChip, isBriefing && styles.briefingIconChip]}>
          <Ionicons name={icon} size={18} color={isBriefing ? '#fff' : colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.type, isBriefing && styles.briefingType]}>{cardType}</Text>
          <Text style={[styles.title, isBriefing && styles.briefingTitle]}>{title}</Text>
        </View>
        {onDismiss ? (
          <Pressable onPress={onDismiss} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
            <Ionicons name="close" size={20} color={colors.outline} />
          </Pressable>
        ) : null}
      </View>

      {body ? (
        isBriefing ? (
          <View style={styles.markdownContainer}>
            <Markdown style={markdownStyles}>{body}</Markdown>
          </View>
        ) : (
          <Text style={styles.body}>{body}</Text>
        )
      ) : null}

      <View style={styles.footer}>
        {source ? (
          <View style={styles.sourcePill}>
            <View style={[styles.sourceDot, { backgroundColor: sourceColor(source) }]} />
            <Text style={styles.sourceLabel}>{source}</Text>
          </View>
        ) : <View />}

        <View style={styles.actions}>
          {onEdit && !isBriefing ? (
            <Pressable onPress={onEdit} hitSlop={8} style={styles.ghostAction}>
              <Ionicons name="create-outline" size={16} color={colors.onSurfaceVariant} />
              <Text style={styles.ghostActionLabel}>Edit</Text>
            </Pressable>
          ) : null}
          {actions.map((a) => (
            <GradientButton
              key={a.label}
              label={a.label}
              icon={a.icon}
              onPress={a.onPress}
              variant={a.variant || 'primary'}
              size="sm"
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const markdownStyles = StyleSheet.create({
  body: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
  heading1: { fontFamily: typography.families.bodyBold, color: colors.onSurface, marginTop: 12, marginBottom: 8 },
  heading2: { fontFamily: typography.families.bodyBold, color: colors.onSurface, marginTop: 12, marginBottom: 8 },
  heading3: { fontFamily: typography.families.bodyBold, color: colors.onSurface, marginTop: 12, marginBottom: 8 },
  strong: { fontFamily: typography.families.bodyBold, color: colors.onSurface },
  bullet_list: { marginTop: 4, marginBottom: 12 },
  list_item: { marginBottom: 4 },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.low,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  type: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: 2,
  },
  title: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.bodyBold,
    color: colors.onSurface,
    lineHeight: 24,
  },
  body: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
    marginBottom: spacing.md,
    marginLeft: 36 + spacing.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.pill,
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sourceLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ghostAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  ghostActionLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
  },
  briefingCard: {
    backgroundColor: '#FAF5FF', // Subtle purple tint to match web PWA
    borderColor: colors.primary,
    borderWidth: 2,
    paddingTop: spacing.xl,
  },
  briefingIconChip: {
    backgroundColor: colors.primary,
  },
  briefingType: {
    color: colors.primary,
    fontWeight: '700',
  },
  briefingTitle: {
    fontSize: typography.sizes.xl,
    marginBottom: spacing.md,
  },
  markdownContainer: {
    marginLeft: 36 + spacing.md,
    marginBottom: spacing.md,
  },
});
