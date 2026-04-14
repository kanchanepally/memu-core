import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Linking,
  Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTodayBrief, getGoogleAuthUrl, type BriefEvent } from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import Masthead from '../../components/Masthead';
import GradientButton from '../../components/GradientButton';

const DAYS_TO_SHOW = 14;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatTime(iso: string | null): string {
  if (!iso) return 'All day';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return 'All day';
  const s = formatTime(start);
  const e = end ? formatTime(end) : '';
  return e ? `${s} – ${e}` : s;
}

function formatDayHeading(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function relativeDayLabel(d: Date): string | null {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return null;
}

function detectConflicts(events: BriefEvent[]): Set<number> {
  const conflicts = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (!a.startTime || !a.endTime) continue;
    const aStart = new Date(a.startTime).getTime();
    const aEnd = new Date(a.endTime).getTime();
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (!b.startTime || !b.endTime) continue;
      const bStart = new Date(b.startTime).getTime();
      const bEnd = new Date(b.endTime).getTime();
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.add(i);
        conflicts.add(j);
      }
    }
  }
  return conflicts;
}

export default function CalendarScreen() {
  const [todayEvents, setTodayEvents] = useState<BriefEvent[]>([]);
  const [futureEvents, setFutureEvents] = useState<BriefEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date>(startOfDay(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<BriefEvent | null>(null);

  const loadEvents = useCallback(async () => {
    const { data } = await getTodayBrief();
    if (data) {
      setTodayEvents(data.todayEvents || data.events || []);
      setFutureEvents(data.futureEvents || []);
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
    const { data } = await getGoogleAuthUrl();
    setConnecting(false);
    if (data?.url) {
      await Linking.openURL(data.url);
    }
  }, []);

  const allEvents = useMemo(() => [...todayEvents, ...futureEvents], [todayEvents, futureEvents]);

  const days = useMemo(() => {
    const base = startOfDay(new Date());
    return Array.from({ length: DAYS_TO_SHOW }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
  }, []);

  const eventsForSelectedDay = useMemo(() => {
    return allEvents
      .filter(e => {
        if (!e.startTime) return false;
        return sameDay(new Date(e.startTime), selectedDay);
      })
      .sort((a, b) => {
        const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
        const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
        return ta - tb;
      });
  }, [allEvents, selectedDay]);

  const conflicts = useMemo(
    () => detectConflicts(eventsForSelectedDay),
    [eventsForSelectedDay],
  );

  const eventCountByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of allEvents) {
      if (!e.startTime) continue;
      const key = startOfDay(new Date(e.startTime)).toISOString();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [allEvents]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Reading your month…</Text>
      </View>
    );
  }

  const selectedRelative = relativeDayLabel(selectedDay);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Calendar" statusLabel={connected ? 'Synced' : 'Offline'} statusPulse={connected} />

      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        <Masthead
          eyebrow="The shape of your week"
          headline="Time, gently held."
          accent="gently"
        />

        {!connected ? (
          <View style={styles.connectWrap}>
            <View style={styles.connectCard}>
              <View style={styles.connectGlow} />
              <View style={styles.connectIconChip}>
                <Ionicons name="calendar-outline" size={22} color={colors.tertiary} />
              </View>
              <Text style={styles.connectTitle}>Connect Google Calendar</Text>
              <Text style={styles.connectSubtitle}>
                Memu will show your schedule here — and spot the quiet conflicts before they bite.
              </Text>
              <GradientButton
                label={connecting ? 'Opening…' : 'Connect calendar'}
                onPress={handleConnect}
                icon="logo-google"
                loading={connecting}
              />
              <Text style={styles.privacyNote}>
                Your events stay on your server. Memu never shares them.
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/* Day strip */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayStrip}
              style={styles.dayStripScroll}
            >
              {days.map(day => {
                const key = day.toISOString();
                const active = sameDay(day, selectedDay);
                const count = eventCountByDay.get(key) || 0;
                const isToday = sameDay(day, new Date());
                return (
                  <Pressable
                    key={key}
                    style={[styles.dayChip, active && styles.dayChipActive]}
                    onPress={() => setSelectedDay(day)}
                  >
                    <Text style={[styles.dayWeek, active && styles.dayWeekActive]}>
                      {day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}
                    </Text>
                    <Text style={[styles.dayNum, active && styles.dayNumActive]}>
                      {day.getDate()}
                    </Text>
                    <View style={styles.dayDotRow}>
                      {count > 0 ? (
                        <View style={[
                          styles.dayDot,
                          active && styles.dayDotActive,
                          isToday && !active && styles.dayDotToday,
                        ]} />
                      ) : (
                        <View style={styles.dayDotPlaceholder} />
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Selected day heading */}
            <View style={styles.dayHeader}>
              {selectedRelative ? (
                <Text style={styles.dayHeaderEyebrow}>{selectedRelative}</Text>
              ) : null}
              <Text style={styles.dayHeaderTitle}>{formatDayHeading(selectedDay)}</Text>
              <Text style={styles.dayHeaderMeta}>
                {eventsForSelectedDay.length === 0
                  ? 'No events.'
                  : `${eventsForSelectedDay.length} event${eventsForSelectedDay.length === 1 ? '' : 's'}${conflicts.size > 0 ? ` · ${conflicts.size / 2} conflict${conflicts.size / 2 === 1 ? '' : 's'}` : ''}.`}
              </Text>
            </View>

            {/* Events */}
            <View style={styles.eventsSection}>
              {eventsForSelectedDay.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="sunny-outline" size={22} color={colors.tertiary} />
                  <Text style={styles.emptyText}>
                    {selectedRelative === 'Today'
                      ? 'A wide open day.'
                      : 'Nothing scheduled.'}
                  </Text>
                </View>
              ) : (
                eventsForSelectedDay.map((event, i) => {
                  const conflicted = conflicts.has(i);
                  return (
                    <Pressable
                      key={`${event.title}-${i}`}
                      style={[styles.eventCard, conflicted && styles.eventCardConflict]}
                      onPress={() => setSelectedEvent(event)}
                    >
                      <View style={[styles.eventTimeChip, conflicted && styles.eventTimeChipConflict]}>
                        <Text style={[styles.eventTimeText, conflicted && styles.eventTimeTextConflict]}>
                          {formatTime(event.startTime)}
                        </Text>
                        {event.endTime ? (
                          <Text style={styles.eventTimeDuration}>
                            {formatTime(event.endTime)}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.eventBody}>
                        <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
                        {conflicted ? (
                          <View style={styles.conflictRow}>
                            <Ionicons name="alert-circle" size={12} color={colors.error} />
                            <Text style={styles.conflictLabel}>Overlap</Text>
                          </View>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.outline} />
                    </Pressable>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScreenContainer>

      {/* Event detail modal */}
      <Modal visible={!!selectedEvent} animationType="slide" transparent onRequestClose={() => setSelectedEvent(null)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalIconChip}>
                <Ionicons name="calendar" size={20} color={colors.primary} />
              </View>
              <Pressable onPress={() => setSelectedEvent(null)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.outline} />
              </Pressable>
            </View>
            <Text style={styles.modalEventTitle}>{selectedEvent?.title}</Text>
            <Text style={styles.modalEventTime}>
              {selectedEvent ? formatTimeRange(selectedEvent.startTime, selectedEvent.endTime) : ''}
            </Text>
            {selectedEvent?.startTime ? (
              <Text style={styles.modalEventDate}>
                {formatDayHeading(new Date(selectedEvent.startTime))}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <GradientButton
                label="Close"
                variant="ghost"
                onPress={() => setSelectedEvent(null)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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

  // Connect CTA
  connectWrap: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.xl,
  },
  connectCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.medium,
  },
  connectGlow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.tertiaryContainer,
    opacity: 0.35,
  },
  connectIconChip: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
    textAlign: 'center',
  },
  connectSubtitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  privacyNote: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  // Day strip
  dayStripScroll: {
    marginTop: spacing.xl,
  },
  dayStrip: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  dayChip: {
    width: 56,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    gap: 4,
    ...shadows.low,
  },
  dayChipActive: {
    backgroundColor: colors.primary,
  },
  dayWeek: {
    fontSize: 9,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    letterSpacing: typography.tracking.widest,
  },
  dayWeekActive: {
    color: colors.onPrimary,
    opacity: 0.8,
  },
  dayNum: {
    fontSize: 20,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  dayNumActive: {
    color: colors.onPrimary,
  },
  dayDotRow: {
    height: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.tertiary,
  },
  dayDotToday: {
    backgroundColor: colors.primary,
  },
  dayDotActive: {
    backgroundColor: colors.onPrimary,
  },
  dayDotPlaceholder: {
    width: 5,
    height: 5,
  },

  // Day heading
  dayHeader: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    gap: 4,
  },
  dayHeaderEyebrow: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  dayHeaderTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  dayHeaderMeta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },

  // Events
  eventsSection: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
  },
  emptyCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyText: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },

  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.low,
  },
  eventCardConflict: {
    backgroundColor: colors.errorContainer,
    opacity: 0.95,
  },
  eventTimeChip: {
    backgroundColor: colors.secondaryContainer,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 8,
    minWidth: 68,
    alignItems: 'center',
    gap: 2,
  },
  eventTimeChipConflict: {
    backgroundColor: colors.surfaceContainerLowest,
  },
  eventTimeText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.bodyBold,
    color: colors.onSecondaryContainer,
  },
  eventTimeTextConflict: {
    color: colors.error,
  },
  eventTimeDuration: {
    fontSize: 9,
    fontFamily: typography.families.label,
    color: colors.onSecondaryContainer,
    opacity: 0.7,
    letterSpacing: typography.tracking.wide,
  },
  eventBody: {
    flex: 1,
    gap: 4,
  },
  eventTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    lineHeight: 20,
  },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  conflictLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.error,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(12,14,16,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing['2xl'],
    ...shadows.high,
  },
  modalHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
    alignSelf: 'center',
    marginBottom: spacing.md,
    opacity: 0.5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalIconChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEventTitle: {
    fontSize: typography.sizes['2xl'],
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
    marginBottom: spacing.sm,
    lineHeight: 34,
  },
  modalEventTime: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
    marginBottom: 4,
  },
  modalEventDate: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
});
