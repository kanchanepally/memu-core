import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getLedger, type LedgerEntry } from '../lib/api';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import ScreenHeader from '../components/ScreenHeader';
import ScreenContainer from '../components/ScreenContainer';
import Masthead from '../components/Masthead';

function formatTimestamp(iso: string): string {
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

function LedgerCard({ entry }: { entry: LedgerEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable style={styles.card} onPress={() => setExpanded(!expanded)}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.channelDot} />
          <Text style={styles.cardChannel}>{entry.channel}</Text>
        </View>
        <Text style={styles.cardTime}>{formatTimestamp(entry.created_at)}</Text>
      </View>

      {/* Original */}
      <View style={styles.block}>
        <Text style={styles.blockLabel}>You said</Text>
        <Text style={styles.blockText}>{entry.content_original}</Text>
      </View>

      {/* Translated — AI-touched, tertiary */}
      <View style={styles.blockAI}>
        <View style={styles.blockAILabelRow}>
          <Ionicons name="eye-outline" size={11} color={colors.tertiary} />
          <Text style={styles.blockAILabel}>Memu sent to cloud AI</Text>
        </View>
        <Text style={styles.blockAIText}>{entry.content_translated}</Text>
      </View>

      {expanded ? (
        <>
          {entry.entity_translations && entry.entity_translations.length > 0 ? (
            <View style={styles.translationMap}>
              <Text style={styles.mapTitle}>Names anonymised</Text>
              {entry.entity_translations.map((t, i) => (
                <View key={i} style={styles.mapRow}>
                  <Text style={styles.mapReal}>{t.real}</Text>
                  <Ionicons name="arrow-forward" size={12} color={colors.outline} />
                  <Text style={styles.mapAnon}>{t.anonymous}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.blockAI}>
            <View style={styles.blockAILabelRow}>
              <Ionicons name="cloud-outline" size={11} color={colors.tertiary} />
              <Text style={styles.blockAILabel}>Cloud AI replied (anonymous)</Text>
            </View>
            <Text style={styles.blockAIText}>{entry.content_response_raw}</Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.blockLabel}>You saw</Text>
            <Text style={styles.blockText}>{entry.content_response_translated}</Text>
          </View>

          {(entry.cloud_tokens_in || entry.cloud_tokens_out) ? (
            <View style={styles.tokenRow}>
              <Text style={styles.tokenText}>
                {entry.cloud_tokens_in || 0} tokens in · {entry.cloud_tokens_out || 0} out
              </Text>
            </View>
          ) : null}
        </>
      ) : null}

      <View style={styles.expandHint}>
        <Text style={styles.expandText}>
          {expanded ? 'Collapse' : 'See full translation'}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={12}
          color={colors.primary}
        />
      </View>
    </Pressable>
  );
}

function SanctuaryKey({ entries }: { entries: LedgerEntry[] }) {
  const uniqueNames = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (!e.entity_translations) continue;
      for (const t of e.entity_translations) set.add(t.real);
    }
    return set.size;
  }, [entries]);

  const totalTokens = useMemo(() => {
    return entries.reduce((sum, e) => sum + (e.cloud_tokens_in || 0) + (e.cloud_tokens_out || 0), 0);
  }, [entries]);

  const breathe = useMemo(() => new Animated.Value(0.4), []);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0.4, duration: 1500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  return (
    <View style={styles.sanctuary}>
      <Animated.View style={[styles.sanctuaryGlow, { opacity: breathe }]} />
      <View style={styles.sanctuaryHeader}>
        <View style={styles.sanctuaryIcon}>
          <Ionicons name="shield-checkmark" size={20} color={colors.tertiary} />
        </View>
        <Text style={styles.sanctuaryLabel}>Sanctuary Key</Text>
      </View>
      <Text style={styles.sanctuaryTitle}>
        Names stay with you. Only anonymous labels travel.
      </Text>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{entries.length}</Text>
          <Text style={styles.statLabel}>queries</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{uniqueNames}</Text>
          <Text style={styles.statLabel}>names shielded</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{Math.round(totalTokens / 1000)}K</Text>
          <Text style={styles.statLabel}>tokens</Text>
        </View>
      </View>
    </View>
  );
}

export default function LedgerScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await getLedger();
    if (data) setEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Reading the ledger…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Ledger"
        statusLabel="Private"
        statusPulse={false}
        onRightPress={() => router.back()}
        rightIcon="close"
      />
      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        <Masthead
          eyebrow="Privacy Ledger"
          headline="Every query, seen."
          accent="seen"
        />

        <View style={styles.introNote}>
          <Text style={styles.introText}>
            Real names and places are replaced with anonymous labels before any query reaches
            the cloud. This page shows you exactly what was sent, what came back, and the key
            used to put it all together again.
          </Text>
        </View>

        <SanctuaryKey entries={entries} />

        {entries.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <View style={styles.emptyGlow} />
              <Ionicons name="leaf-outline" size={26} color={colors.tertiary} />
            </View>
            <Text style={styles.emptyTitle}>Nothing has left yet.</Text>
            <Text style={styles.emptyHint}>
              As soon as you chat with Memu, you'll see every query — before and after
              anonymisation — here.
            </Text>
          </View>
        ) : (
          <View style={styles.entriesSection}>
            <Text style={styles.entriesLabel}>Recent queries</Text>
            {entries.map(entry => <LedgerCard key={entry.id} entry={entry} />)}
          </View>
        )}
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  loadingText: {
    color: colors.onSurfaceVariant,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
  },

  introNote: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  introText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 21,
  },

  // Sanctuary Key
  sanctuary: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.high,
  },
  sanctuaryGlow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.tertiaryContainer,
  },
  sanctuaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sanctuaryIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sanctuaryLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  sanctuaryTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
    lineHeight: 26,
    marginBottom: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.outlineVariant,
    opacity: 0.4,
  },
  statValue: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  statLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
    marginTop: 2,
  },

  // Entries
  entriesSection: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
  },
  entriesLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.low,
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
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  cardTime: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.outline,
    letterSpacing: typography.tracking.wide,
  },

  block: {
    paddingVertical: spacing.sm,
  },
  blockLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: 4,
  },
  blockText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurface,
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
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  blockAIText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onTertiaryContainer,
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
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
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
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
  },
  mapAnon: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.tertiary,
  },

  tokenRow: {
    paddingTop: spacing.sm,
  },
  tokenText: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.outline,
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
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },

  // Empty
  empty: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.sm + 2,
  },
  emptyIconWrap: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyGlow: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.tertiaryContainer,
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  emptyHint: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
});
