import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export default function MemoryScreen() {
  const [entries, setEntries] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Basic fetch matching api.ts structure
    const res = await fetch('http://localhost:3100/api/memory/recent', {
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      }
    });
    if (res.ok) {
      const data = await res.json();
      setEntries(data || []);
    }
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
        <Text style={styles.loadingText}>Loading memory...</Text>
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
        <Ionicons name="library-outline" size={32} color={colors.accent} />
        <Text style={styles.introTitle}>Family Memory</Text>
        <Text style={styles.introBody}>
          This is the compounding knowledge graph. It shows factual context extracted over time, allowing the AI to be deeply helpful without requiring you to repeatedly explain your family rules or preferences.
        </Text>
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No knowledge context captured yet.</Text>
        </View>
      ) : (
        entries.map(entry => (
          <View key={entry.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardSource}>{entry.source}</Text>
              <Text style={styles.cardTime}>{formatTimestamp(entry.created_at)}</Text>
            </View>
            <Text style={styles.cardContent}>{entry.content}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  loadingText: { color: colors.textMuted },

  intro: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  introTitle: { fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold, color: colors.text, fontFamily: 'Outfit_700Bold' },
  introBody: { fontSize: typography.sizes.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 22, paddingHorizontal: spacing.md },

  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { color: colors.textMuted, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface, 
    borderRadius: radius.md, 
    padding: spacing.md,
    borderWidth: 1, 
    borderColor: colors.border, 
    marginBottom: spacing.md, 
    ...shadows.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  cardSource: { fontSize: typography.sizes.xs, color: colors.accent, fontWeight: typography.weights.semibold, textTransform: 'uppercase' },
  cardTime: { fontSize: typography.sizes.xs, color: colors.textMuted },
  cardContent: { fontSize: typography.sizes.body, color: colors.text, lineHeight: 22 },
});
