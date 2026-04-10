import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTodayBrief, getGoogleAuthUrl, type BriefEvent } from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';

function formatTime(isoString: string | null): string {
  if (!isoString) return 'All day';
  try {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return 'All day';
  const s = formatTime(start);
  const e = end ? formatTime(end) : '';
  return e ? `${s} – ${e}` : s;
}

export default function CalendarScreen() {
  const [events, setEvents] = useState<BriefEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const loadEvents = useCallback(async () => {
    const { data } = await getTodayBrief();
    if (data) {
      setEvents(data.events);
      setConnected(data.isCalendarConnected);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  }, [loadEvents]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    const { data, error } = await getGoogleAuthUrl();
    setConnecting(false);
    if (data?.url) {
      Linking.openURL(data.url);
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading calendar...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {!connected ? (
        <View style={styles.connectCard}>
          <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
          <Text style={styles.connectTitle}>Connect your calendar</Text>
          <Text style={styles.connectSubtitle}>
            Link Google Calendar so Memu can show your schedule and spot conflicts.
          </Text>
          <Pressable
            style={[styles.connectButton, connecting && { opacity: 0.6 }]}
            onPress={handleConnect}
            disabled={connecting}
          >
            <Ionicons name="logo-google" size={18} color="#fff" />
            <Text style={styles.connectButtonText}>
              {connecting ? 'Connecting...' : 'Connect Google Calendar'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.dayLabel}>Today</Text>
          {events.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="sunny-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyText}>Nothing scheduled today.</Text>
            </View>
          ) : (
            events.map((event, i) => (
              <View key={i} style={styles.eventCard}>
                <View style={styles.eventTimeBlock}>
                  <Text style={styles.eventTime}>{formatTimeRange(event.startTime, event.endTime)}</Text>
                </View>
                <Text style={styles.eventTitle}>{event.title}</Text>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  loadingText: { color: colors.textMuted, fontSize: typography.sizes.body },

  connectCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  connectTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  connectSubtitle: {
    fontSize: typography.sizes.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  connectButtonText: {
    color: '#fff',
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },

  dayLabel: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyText: { color: colors.textSecondary, fontSize: typography.sizes.body },

  eventCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.sourceCalendar,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  eventTimeBlock: {
    marginBottom: spacing.xs,
  },
  eventTime: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.accent,
  },
  eventTitle: {
    fontSize: typography.sizes.body,
    color: colors.text,
  },
});
