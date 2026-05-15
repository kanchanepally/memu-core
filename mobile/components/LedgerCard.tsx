import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type LedgerEntry } from '../lib/api';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import { Text } from './ui/Text';
import { Card } from './ui/Card';

export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function LedgerCard({ entry }: { entry: LedgerEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable onPress={() => setExpanded(!expanded)}>
      <Card padding="md" style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.channelDot} />
            <Text variant="ui" size="sm" weight="medium" color="primary" style={styles.cardChannel}>{entry.channel}</Text>
          </View>
          <Text variant="ui" size="xs" color="outline" style={styles.cardTime}>{formatTimestamp(entry.created_at)}</Text>
        </View>

        <View style={styles.block}>
          <Text variant="ui" size="xs" color="outline" style={styles.blockLabel}>You said</Text>
          <Text variant="reading" size="body" color="onSurface" style={styles.blockText}>{entry.content_original}</Text>
        </View>

        <View style={styles.blockAI}>
          <View style={styles.blockAILabelRow}>
            <Ionicons name="eye-outline" size={11} color={colors.tertiary} />
            <Text variant="ui" size="xs" color="tertiary" style={styles.blockAILabel}>Memu sent to cloud AI</Text>
          </View>
          <Text variant="reading" size="body" color="onTertiaryContainer" style={styles.blockAIText}>{entry.content_translated}</Text>
        </View>

        {expanded ? (
          <>
            {entry.entity_translations && entry.entity_translations.length > 0 ? (
              <View style={styles.translationMap}>
                <Text variant="ui" size="xs" color="outline" style={styles.mapTitle}>Names anonymised</Text>
                {entry.entity_translations.map((t, i) => (
                  <View key={i} style={styles.mapRow}>
                    <Text variant="ui" size="sm" color="onSurface" style={styles.mapReal}>{t.real}</Text>
                    <Ionicons name="arrow-forward" size={12} color={colors.outline} />
                    <Text variant="ui" size="sm" color="onSurfaceVariant" style={styles.mapAnon}>{t.anonymous}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.blockAI}>
              <View style={styles.blockAILabelRow}>
                <Ionicons name="cloud-outline" size={11} color={colors.tertiary} />
                <Text variant="ui" size="xs" color="tertiary" style={styles.blockAILabel}>Cloud AI replied (anonymous)</Text>
              </View>
              <Text variant="reading" size="body" color="onTertiaryContainer" style={styles.blockAIText}>{entry.content_response_raw}</Text>
            </View>

            <View style={styles.block}>
              <Text variant="ui" size="xs" color="outline" style={styles.blockLabel}>You saw</Text>
              <Text variant="reading" size="body" color="onSurface" style={styles.blockText}>{entry.content_response_translated}</Text>
            </View>

            {(entry.cloud_tokens_in || entry.cloud_tokens_out) ? (
              <View style={styles.tokenRow}>
                <Text variant="ui" size="xs" color="outline" style={styles.tokenText}>
                  {entry.cloud_tokens_in || 0} tokens in · {entry.cloud_tokens_out || 0} out
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={styles.expandHint}>
          <Text variant="ui" size="xs" color="primary" style={styles.expandText}>
            {expanded ? 'Collapse' : 'See full translation'}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={colors.primary}
          />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  channelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.sourceChat,
  },
  cardChannel: {
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  cardTime: {
    letterSpacing: typography.tracking.wide,
  },

  block: {
    paddingVertical: spacing.sm,
  },
  blockLabel: {
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: 4,
  },
  blockText: {
    lineHeight: 20,
  },
  blockAI: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginVertical: spacing.xs,
  },
  blockAILabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  blockAILabel: {
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  blockAIText: {
    lineHeight: 20,
  },

  translationMap: {
    marginTop: spacing.sm,
    padding: spacing.sm + 2,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    gap: 4,
  },
  mapTitle: {
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: spacing.xs,
  },
  mapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 3,
  },
  mapReal: {
  },
  mapAnon: {
  },

  tokenRow: {
    paddingTop: spacing.sm,
  },
  tokenText: {
    letterSpacing: typography.tracking.wide,
  },

  expandHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  expandText: {
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
});
