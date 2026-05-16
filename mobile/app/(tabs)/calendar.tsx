import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Linking,
  Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTodayBrief, getGoogleAuthUrl, type BriefEvent } from '../../lib/api';
import { spacing, radius } from '../../lib/tokens';
import { useTokens } from '../../lib/theme';
import type { Tokens } from '../../lib/tokens';
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
  const t = useTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
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

  // Refresh whenever the tab is focused
  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents])
  );

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
    const { data } = await getGoogleAuthUrl('mobile');
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
                <Ionicons name="calendar-outline" size={22} color={t.brand} />
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
                  <Ionicons name="sunny-outline" size={22} color={t.brand} />
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
                            <Ionicons name="alert-circle" size={12} color={t.red} />
                            <Text style={styles.conflictLabel}>Overlap</Text>
                          </View>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={t.text3} />
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
                <Ionicons name="calendar" size={20} color={t.brand} />
              </View>
              <Pressable onPress={() => setSelectedEvent(null)} hitSlop={12}>
                <Ionicons name="close" size={22} color={t.text3} />
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

function makeStyles(t: Tokens) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  loadingText: {
    color: t.text2,
    fontSize: 15,
    fontFamily: t.uiRegular,
  },

  // Connect CTA
  connectWrap: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.xl,
  },
  connectCard: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.border,
  },
  connectGlow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: t.brandSoft,
    opacity: 0.35,
  },
  connectIconChip: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: t.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectTitle: {
    fontSize: 22,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  connectSubtitle: {
    fontSize: 15,
    fontFamily: t.serifItalic,
    color: t.text2,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  privacyNote: {
    fontSize: 11,
    fontFamily: t.uiRegular,
    color: t.text3,
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
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    gap: 4,
  },
  dayChipActive: {
    backgroundColor: t.brand,
    borderColor: t.brand,
  },
  dayWeek: {
    fontSize: 9,
    fontFamily: t.mono,
    color: t.text3,
    letterSpacing: 1.5,
  },
  dayWeekActive: {
    color: '#FFFFFF',
    opacity: 0.8,
  },
  dayNum: {
    fontSize: 20,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
  },
  dayNumActive: {
    color: '#FFFFFF',
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
    backgroundColor: t.text3,
  },
  dayDotToday: {
    backgroundColor: t.brand,
  },
  dayDotActive: {
    backgroundColor: '#FFFFFF',
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
    fontFamily: t.mono,
    color: t.brand,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  dayHeaderTitle: {
    fontSize: 22,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
  },
  dayHeaderMeta: {
    fontSize: 11,
    fontFamily: t.serifItalic,
    color: t.text2,
    marginTop: 2,
  },

  // Events
  eventsSection: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
  },
  emptyCard: {
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: t.border,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: t.serifItalic,
    color: t.text2,
  },

  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: t.border,
  },
  eventCardConflict: {
    borderColor: t.amber,
    borderLeftWidth: 3,
  },
  eventTimeChip: {
    backgroundColor: t.brandSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 8,
    minWidth: 68,
    alignItems: 'center',
    gap: 2,
  },
  eventTimeChipConflict: {
    backgroundColor: t.amberBg,
  },
  eventTimeText: {
    fontSize: 13,
    fontFamily: t.mono,
    color: t.brand,
  },
  eventTimeTextConflict: {
    color: t.amber,
  },
  eventTimeDuration: {
    fontSize: 9,
    fontFamily: t.mono,
    color: t.brand,
    opacity: 0.7,
    letterSpacing: 0.5,
  },
  eventBody: {
    flex: 1,
    gap: 4,
  },
  eventTitle: {
    fontSize: 15,
    fontFamily: t.serif,
    color: t.text,
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  conflictLabel: {
    fontSize: 10,
    fontFamily: t.uiBold,
    color: t.red,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: t.scrim,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: t.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing['2xl'],
    borderWidth: 1,
    borderColor: t.border,
  },
  modalHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.text3,
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
    backgroundColor: t.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEventTitle: {
    fontSize: 28,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
    lineHeight: 34,
  },
  modalEventTime: {
    fontSize: 18,
    fontFamily: t.mono,
    color: t.brand,
    marginBottom: 4,
  },
  modalEventDate: {
    fontSize: 13,
    fontFamily: t.serifItalic,
    color: t.text2,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
  });
}
