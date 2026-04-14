import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  getTodayBrief, getSynthesis, resolveCard, dismissCard, editCard, addToCalendar, cardToShopping,
  type BriefEvent, type StreamCard as StreamCardData,
} from '../../lib/api';
import { loadAuthState } from '../../lib/auth';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import Masthead from '../../components/Masthead';
import AIInsightCard from '../../components/AIInsightCard';
import StreamCard from '../../components/StreamCard';
import GradientButton from '../../components/GradientButton';

function formatTime(isoString: string | null): string {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function useMasthead(displayName: string) {
  return useMemo(() => {
    const hour = new Date().getHours();
    const date = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    if (hour < 12) {
      return {
        eyebrow: `Morning, ${displayName || 'friend'} — ${date}`,
        headline: 'The morning is yours to shape.',
        accent: 'yours',
      };
    }
    if (hour < 17) {
      return {
        eyebrow: `Afternoon — ${date}`,
        headline: 'Your day is in full bloom.',
        accent: 'full bloom',
      };
    }
    return {
      eyebrow: `Evening — ${date}`,
      headline: 'Quiet hours await your reflection.',
      accent: 'reflection',
    };
  }, [displayName]);
}

export default function TodayScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<BriefEvent[]>([]);
  const [cards, setCards] = useState<StreamCardData[]>([]);
  const [shoppingCount, setShoppingCount] = useState(0);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [synthesis, setSynthesis] = useState<string | null>(null);

  const masthead = useMasthead(displayName);

  const loadBrief = useCallback(async () => {
    const { data, error: err } = await getTodayBrief();
    if (err) {
      setError(err);
    } else if (data) {
      setEvents(data.todayEvents || data.events || []);
      setCards(data.streamCards || []);
      setShoppingCount((data.shoppingItems || []).length);
      setCalendarConnected(data.isCalendarConnected);
      setError(null);
    }
    setLoading(false);
  }, []);

  const loadSynthesis = useCallback(async () => {
    const { data } = await getSynthesis();
    if (data?.synthesis) setSynthesis(data.synthesis);
  }, []);

  useEffect(() => {
    loadBrief();
    loadSynthesis();
    loadAuthState().then(auth => {
      if (auth.displayName) setDisplayName(auth.displayName);
    });
  }, [loadBrief, loadSynthesis]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadBrief(), loadSynthesis()]);
    setRefreshing(false);
  }, [loadBrief, loadSynthesis]);

  // Edit modal state
  const [editingCard, setEditingCard] = useState<StreamCardData | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);

  const handleResolve = useCallback(async (cardId: string) => {
    await resolveCard(cardId);
    setCards(prev => prev.filter(c => c.id !== cardId));
  }, []);

  const handleDismiss = useCallback(async (cardId: string) => {
    await dismissCard(cardId);
    setCards(prev => prev.filter(c => c.id !== cardId));
  }, []);

  const handleAddToCalendar = useCallback(async (cardId: string) => {
    const { error: err } = await addToCalendar(cardId);
    if (!err) setCards(prev => prev.filter(c => c.id !== cardId));
  }, []);

  const handleAddToShopping = useCallback(async (cardId: string) => {
    const { error: err } = await cardToShopping(cardId);
    if (!err) setCards(prev => prev.filter(c => c.id !== cardId));
  }, []);

  const openEdit = useCallback((card: StreamCardData) => {
    setEditingCard(card);
    setEditTitle(card.title);
    setEditBody(card.body);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingCard) return;
    setSaving(true);
    const { data } = await editCard(editingCard.id, editTitle.trim(), editBody.trim());
    setSaving(false);
    if (data?.card) {
      setCards(prev => prev.map(c => c.id === editingCard.id
        ? { ...c, title: editTitle.trim(), body: editBody.trim() }
        : c));
    }
    setEditingCard(null);
  }, [editingCard, editTitle, editBody]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading your day…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader
        showWordmark
        statusLabel={error ? 'Offline' : 'Node Syncing'}
        statusPulse={!error}
      />
      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        <Masthead
          eyebrow={masthead.eyebrow}
          headline={masthead.headline}
          accent={masthead.accent}
        />

        {/* Hero: AI synthesis */}
        <View style={styles.heroSlot}>
          <AIInsightCard
            label="Memu Insight"
            icon="sparkles"
            title={synthesis || "You're all caught up for today."}
            body={
              error
                ? "Can't reach your home server. Pull to retry."
                : cards.length > 0
                  ? `${cards.length} item${cards.length === 1 ? '' : 's'} await your attention below.`
                  : 'Your stream is quiet. Memu is listening in the background.'
            }
            ctaLabel={cards.length > 0 ? 'Review stream' : undefined}
            onCta={cards.length > 0 ? undefined : undefined}
          />
        </View>

        {/* Calendar strip */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Today's schedule</Text>
          {!calendarConnected ? (
            <Pressable style={styles.tonalCard} onPress={() => router.push('/(tabs)/calendar')}>
              <Ionicons name="calendar-outline" size={18} color={colors.tertiary} />
              <Text style={styles.tonalCardText}>Connect Google Calendar to see your day.</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.outline} />
            </Pressable>
          ) : events.length === 0 ? (
            <View style={styles.tonalCard}>
              <Ionicons name="sunny-outline" size={18} color={colors.tertiary} />
              <Text style={styles.tonalCardText}>No events today — your day is wide open.</Text>
            </View>
          ) : (
            <View style={styles.eventStack}>
              {events.slice(0, 4).map((event, i) => (
                <View key={i} style={styles.eventRow}>
                  <View style={styles.eventTimeChip}>
                    <Text style={styles.eventTimeText}>{formatTime(event.startTime) || '—'}</Text>
                  </View>
                  <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
                </View>
              ))}
              {events.length > 4 ? (
                <Pressable onPress={() => router.push('/(tabs)/calendar')} style={styles.eventMore}>
                  <Text style={styles.eventMoreText}>+{events.length - 4} more · see calendar</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {/* Stream */}
        {cards.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Stream</Text>
            {cards.map(card => (
              <StreamCard
                key={card.id}
                id={card.id}
                cardType={card.card_type}
                title={card.title}
                body={card.body}
                source={card.source}
                onDismiss={() => handleDismiss(card.id)}
                onEdit={() => openEdit(card)}
                actions={[
                  card.card_type !== 'shopping' ? {
                    label: 'Calendar',
                    icon: 'calendar-outline' as const,
                    variant: 'secondary' as const,
                    onPress: () => handleAddToCalendar(card.id),
                  } : null,
                  card.card_type !== 'shopping' ? {
                    label: 'List',
                    icon: 'basket-outline' as const,
                    variant: 'secondary' as const,
                    onPress: () => handleAddToShopping(card.id),
                  } : null,
                  {
                    label: 'Done',
                    icon: 'checkmark' as const,
                    variant: 'primary' as const,
                    onPress: () => handleResolve(card.id),
                  },
                ].filter(Boolean) as NonNullable<React.ComponentProps<typeof StreamCard>['actions']>}
              />
            ))}
          </View>
        ) : null}

        {/* Shopping footer */}
        {shoppingCount > 0 ? (
          <Pressable style={styles.listSummary} onPress={() => router.push('/(tabs)/lists')}>
            <Ionicons name="basket-outline" size={18} color={colors.primary} />
            <Text style={styles.listSummaryText}>
              {shoppingCount} item{shoppingCount === 1 ? '' : 's'} on the shopping list
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.outline} />
          </Pressable>
        ) : null}

        {/* Privacy footer */}
        <Pressable style={styles.privacyFooter} onPress={() => router.push('/ledger')}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.tertiary} />
          <Text style={styles.privacyText}>Every query anonymised via Digital Twin.</Text>
          <Text style={styles.privacyLink}>See the ledger →</Text>
        </Pressable>
      </ScreenContainer>

      {/* Edit Modal */}
      <Modal visible={!!editingCard} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit card</Text>
            <Text style={styles.modalLabel}>Title</Text>
            <TextInput
              style={styles.modalInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Card title"
              placeholderTextColor={colors.outline}
            />
            <Text style={styles.modalLabel}>Details</Text>
            <TextInput
              style={[styles.modalInput, styles.modalInputMultiline]}
              value={editBody}
              onChangeText={setEditBody}
              placeholder="Card details"
              placeholderTextColor={colors.outline}
              multiline
              numberOfLines={4}
            />
            <View style={styles.modalActions}>
              <GradientButton
                label="Cancel"
                onPress={() => setEditingCard(null)}
                variant="ghost"
              />
              <GradientButton
                label={saving ? 'Saving…' : 'Save'}
                onPress={handleSaveEdit}
                loading={saving}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.surface,
  },
  loadingText: {
    color: colors.onSurfaceVariant, fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
  },

  heroSlot: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },

  section: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: spacing.md,
  },

  tonalCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.low,
  },
  tonalCardText: {
    flex: 1,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },

  eventStack: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.low,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  eventTimeChip: {
    backgroundColor: colors.secondaryContainer,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    minWidth: 60,
    alignItems: 'center',
  },
  eventTimeText: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.onSecondaryContainer,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  eventTitle: {
    flex: 1,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  eventMore: {
    paddingTop: spacing.sm,
    paddingLeft: spacing.sm,
  },
  eventMoreText: {
    fontSize: 11,
    color: colors.tertiary,
    fontFamily: typography.families.label,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },

  listSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.low,
  },
  listSummaryText: {
    flex: 1,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },

  privacyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  privacyText: {
    fontSize: 11,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  privacyLink: {
    fontSize: 11,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
  },

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
  modalTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    marginBottom: spacing.lg,
    letterSpacing: typography.tracking.tight,
  },
  modalLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  modalInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  modalInputMultiline: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
