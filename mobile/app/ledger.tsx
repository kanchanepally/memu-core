import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getLedger, type LedgerEntry } from '../lib/api';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function LedgerCard({ entry }: { entry: LedgerEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable style={styles.card} onPress={() => setExpanded(!expanded)}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTime}>{formatTimestamp(entry.created_at)}</Text>
        <Text style={styles.cardChannel}>{entry.channel}</Text>
      </View>

      {/* What you said */}
      <View style={styles.row}>
        <Text style={styles.label}>You said:</Text>
        <Text style={styles.value}>{entry.content_original}</Text>
      </View>

      {/* What Cloud AI received */}
      <View style={[styles.row, styles.anonymised]}>
        <Text style={styles.label}>Cloud AI received:</Text>
        <Text style={[styles.value, styles.anonymisedText]}>{entry.content_translated}</Text>
      </View>

      {expanded && (
        <>
          {/* Translation map */}
          {entry.entity_translations && entry.entity_translations.length > 0 && (
            <View style={styles.translationMap}>
              <Text style={styles.mapTitle}>Translation Map</Text>
              {entry.entity_translations.map((t, i) => (
                <View key={i} style={styles.mapRow}>
                  <Text style={styles.mapReal}>{t.real}</Text>
                  <Ionicons name="arrow-forward" size={12} color={colors.textMuted} />
                  <Text style={styles.mapAnon}>{t.anonymous}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Cloud AI's raw response */}
          <View style={[styles.row, styles.anonymised]}>
            <Text style={styles.label}>Cloud AI replied (raw):</Text>
            <Text style={[styles.value, styles.anonymisedText]}>{entry.content_response_raw}</Text>
          </View>

          {/* What you saw */}
          <View style={styles.row}>
            <Text style={styles.label}>You saw:</Text>
            <Text style={styles.value}>{entry.content_response_translated}</Text>
          </View>

          {/* Token usage */}
          {(entry.cloud_tokens_in || entry.cloud_tokens_out) && (
            <View style={styles.tokenRow}>
              <Text style={styles.tokenText}>
                Tokens: {entry.cloud_tokens_in || 0} in / {entry.cloud_tokens_out || 0} out
              </Text>
            </View>
          )}
        </>
      )}

      <View style={styles.expandHint}>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.textMuted}
        />
        <Text style={styles.expandText}>{expanded ? 'Less' : 'See full translation'}</Text>
      </View>
    </Pressable>
  );
}

export default function LedgerScreen() {
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
        <Text style={styles.loadingText}>Loading ledger...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      <View style={styles.intro}>
        <Ionicons name="eye-outline" size={24} color={colors.accent} />
        <Text style={styles.introTitle}>The Privacy Ledger</Text>
        <Text style={styles.introBody}>
          Every time Memu sends a query to the Cloud inference engine, real names and places are replaced with anonymous labels. This page shows you exactly what the Cloud AI received and what was translated back.
        </Text>
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No queries yet. Chat with Memu to see the ledger in action.</Text>
        </View>
      ) : (
        entries.map(entry => <LedgerCard key={entry.id} entry={entry} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  loadingText: { color: colors.textMuted },

  intro: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  introTitle: { fontSize: typography.sizes.lg, fontWeight: typography.weights.bold, color: colors.text },
  introBody: { fontSize: typography.sizes.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.md },

  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { color: colors.textMuted, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, ...shadows.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardTime: { fontSize: typography.sizes.xs, color: colors.textMuted },
  cardChannel: { fontSize: typography.sizes.xs, color: colors.textMuted, textTransform: 'capitalize' },

  row: { marginBottom: spacing.sm },
  label: { fontSize: typography.sizes.xs, fontWeight: typography.weights.semibold, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  value: { fontSize: typography.sizes.sm, color: colors.text, lineHeight: 20 },

  anonymised: {
    backgroundColor: '#f0f0ff', borderRadius: radius.sm, padding: spacing.sm,
  },
  anonymisedText: { color: colors.accent, fontFamily: 'monospace' },

  translationMap: { marginBottom: spacing.sm, padding: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.sm },
  mapTitle: { fontSize: typography.sizes.xs, fontWeight: typography.weights.semibold, color: colors.textMuted, marginBottom: spacing.xs },
  mapRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  mapReal: { fontSize: typography.sizes.sm, color: colors.text, fontWeight: typography.weights.medium },
  mapAnon: { fontSize: typography.sizes.sm, color: colors.accent, fontFamily: 'monospace' },

  tokenRow: { paddingTop: spacing.xs },
  tokenText: { fontSize: typography.sizes.xs, color: colors.textMuted },

  expandHint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', paddingTop: spacing.sm },
  expandText: { fontSize: typography.sizes.xs, color: colors.textMuted },
});
