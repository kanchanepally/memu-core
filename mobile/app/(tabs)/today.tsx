import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, Pressable,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  getTodayBrief, getSynthesis, resolveCard, dismissCard, editCard, addToCalendar, cardToShopping,
  executeAddToListAction, executeAddCalendarEventAction, executeUpdateSpaceAction, ackReplyDraftAction,
  completeCareStandard,
  getOnboardingState,
  getPushDiagnostics,
  type BriefEvent, type StreamCard as StreamCardData, type StreamCardAction,
  type OnboardingStep,
  type PushTokenSummary,
} from '../../lib/api';
import { useToast } from '../../components/Toast';
import { loadAuthState } from '../../lib/auth';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import AIInsightCard from '../../components/AIInsightCard';
import PushStatusBanner from '../../components/PushStatusBanner';
import NewsFeed from '../../components/NewsFeed';
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

function useTodayHeader(displayName: string) {
  return useMemo(() => {
    const hour = new Date().getHours();
    const dateLabel = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const namePart = displayName ? `, ${displayName}` : '';
    let greeting: string;
    if (hour < 12) greeting = `Good morning${namePart}`;
    else if (hour < 17) greeting = `Good afternoon${namePart}`;
    else greeting = `Good evening${namePart}`;
    return { greeting, dateLabel };
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

  // Push status — surfaced as a banner above the hero so the user can verify
  // notification delivery in two taps rather than four-deep in Settings.
  const [pushTokens, setPushTokens] = useState<PushTokenSummary[]>([]);

  const todayHeader = useTodayHeader(displayName);

  const loadPushStatus = useCallback(async () => {
    const { data } = await getPushDiagnostics();
    if (data) setPushTokens(data.tokens);
  }, []);

  // Onboarding resume banner — shows when the user has not finished the
  // conversational seed flow. Tapping it sends them back to the next
  // pending step. They can keep using the app and the banner just sits.
  const [onboardingNextStep, setOnboardingNextStep] = useState<OnboardingStep | null>(null);
  const [onboardingProgress, setOnboardingProgress] = useState({ done: 0, total: 5 });

  const loadOnboardingBanner = useCallback(async () => {
    const { data } = await getOnboardingState();
    if (!data) return;
    if (data.complete) {
      setOnboardingNextStep(null);
      return;
    }
    setOnboardingNextStep(data.nextStep);
    const total = data.stepOrder.length;
    let done = 0;
    for (const step of data.stepOrder) {
      if (data.state[step] !== 'pending') done += 1;
    }
    setOnboardingProgress({ done, total });
  }, []);

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

  // Refresh whenever the tab is focused
  useFocusEffect(
    useCallback(() => {
      loadBrief();
      loadSynthesis();
      loadOnboardingBanner();
      loadPushStatus();
    }, [loadBrief, loadSynthesis, loadOnboardingBanner, loadPushStatus])
  );

  useEffect(() => {
    loadBrief();
    loadSynthesis();
    loadOnboardingBanner();
    loadPushStatus();
    loadAuthState().then(auth => {
      if (auth.displayName) setDisplayName(auth.displayName);
    });
  }, [loadBrief, loadSynthesis, loadOnboardingBanner, loadPushStatus]);

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

  // Reply-draft preview state — surfaced for any briefing action of kind reply_draft
  const [replyPreview, setReplyPreview] = useState<{ cardId: string; actionIndex: number; draftText: string; recipient?: string } | null>(null);
  const toast = useToast();

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

  // Maps the persisted action union to the UI-facing { label, icon, variant, onPress }
  // shape that StreamCard expects. Briefing actions go through their kind-specific
  // backend endpoint; reflection/standard actions use their own paths. Returns null
  // for entries we don't know how to handle (forward-compat: a future kind landing
  // server-side won't crash the mobile app).
  const mapCardActions = useCallback((card: StreamCardData): React.ComponentProps<typeof StreamCard>['actions'] => {
    const persisted = (card.actions || []) as StreamCardAction[];
    const onSuccess = (cardId: string, message?: string) => {
      setCards(prev => prev.filter(c => c.id !== cardId));
      if (message) toast.show(message);
    };

    return persisted
      .map((action, index): NonNullable<React.ComponentProps<typeof StreamCard>['actions']>[number] | null => {
        // Briefing actions carry { kind, label, payload }
        if ('kind' in action) {
          if (action.kind === 'add_to_list') {
            return {
              label: action.label || 'Add to list',
              icon: 'basket-outline',
              variant: 'primary',
              onPress: async () => {
                const { data, error: err } = await executeAddToListAction(card.id, index);
                if (err) toast.show(err, 'error');
                else onSuccess(card.id, `Added ${data?.added ?? 0} item${data?.added === 1 ? '' : 's'}`);
              },
            };
          }
          if (action.kind === 'add_calendar_event') {
            return {
              label: action.label || 'Add to calendar',
              icon: 'calendar-outline',
              variant: 'primary',
              onPress: async () => {
                const { error: err } = await executeAddCalendarEventAction(card.id, index);
                if (err) toast.show(err, 'error');
                else onSuccess(card.id, 'Event added to calendar');
              },
            };
          }
          if (action.kind === 'update_space') {
            return {
              label: action.label || 'Update Space',
              icon: 'document-text-outline',
              variant: 'primary',
              onPress: async () => {
                const { error: err } = await executeUpdateSpaceAction(card.id, index);
                if (err) toast.show(err, 'error');
                else onSuccess(card.id, 'Space updated');
              },
            };
          }
          if (action.kind === 'reply_draft') {
            return {
              label: action.label || 'Draft reply',
              icon: 'chatbubble-outline',
              variant: 'primary',
              onPress: () => {
                setReplyPreview({
                  cardId: card.id,
                  actionIndex: index,
                  draftText: action.payload?.draft_text || '',
                  recipient: action.payload?.to_anonymous_label,
                });
              },
            };
          }
          return null;
        }
        // Legacy actions: { type, label, ... }
        if (action.type === 'dismiss') {
          return {
            label: action.label || 'Dismiss',
            variant: 'ghost',
            onPress: async () => {
              await dismissCard(card.id);
              onSuccess(card.id);
            },
          };
        }
        if (action.type === 'standard_complete') {
          return {
            label: action.label || 'Mark done',
            icon: 'checkmark',
            variant: 'primary',
            onPress: async () => {
              const { error: err } = await completeCareStandard(action.standardId);
              if (err) toast.show(err, 'error');
              else {
                await resolveCard(card.id);
                onSuccess(card.id, 'Marked complete');
              }
            },
          };
        }
        if (action.type === 'open_space') {
          return {
            label: action.label || 'Open Space',
            icon: 'arrow-forward',
            variant: 'secondary',
            onPress: () => {
              router.push('/(tabs)/spaces');
            },
          };
        }
        return null;
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }, [router, toast]);

  const handleReplyDraftCopy = useCallback(async () => {
    if (!replyPreview) return;
    await Clipboard.setStringAsync(replyPreview.draftText);
    await ackReplyDraftAction(replyPreview.cardId, replyPreview.actionIndex);
    setCards(prev => prev.filter(c => c.id !== replyPreview.cardId));
    setReplyPreview(null);
    toast.show('Draft copied');
  }, [replyPreview, toast]);

  const handleReplyDraftSkip = useCallback(() => {
    setReplyPreview(null);
  }, []);

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
        {/* Onboarding resume banner — shows when the conversational seed
            flow isn't complete. Stays at the top so it nudges without
            dominating; the Today's-brief insight card carries the day. */}
        {onboardingNextStep ? (
          <Pressable
            style={styles.onboardingBanner}
            onPress={() => router.push(`/onboarding/${onboardingNextStep}` as any)}
          >
            <View style={styles.onboardingBannerIcon}>
              <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
            </View>
            <View style={styles.onboardingBannerText}>
              <Text style={styles.onboardingBannerTitle}>Pick up where we left off</Text>
              <Text style={styles.onboardingBannerSub}>
                {onboardingProgress.done} of {onboardingProgress.total} done — next: {onboardingNextStep}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.outline} />
          </Pressable>
        ) : null}

        {/* Push status banner — shown when notifications aren't set up yet
            (loud, CTA-shaped) and when they are (subtle, with a one-tap test).
            Sits just above the hero so the lock-screen brief gate is visible
            the moment Today opens. */}
        <PushStatusBanner tokens={pushTokens} onTokensChange={setPushTokens} />

        {/* Hero: AI synthesis. The backend gates Sonnet behind a data-availability
            check (briefing.ts isFullyEmpty), so `synthesis` arrives as null
            when there is nothing meaningful to synthesise. We render an honest
            empty-state in that case rather than a generic "all caught up"
            platitude — when Memu has no calendar, no cards, and no inbox, the
            truthful answer is "I don't know what to tell you yet." */}
        <View style={styles.heroSlot}>
          {(() => {
            const isFullyEmpty = !synthesis
              && events.length === 0
              && cards.length === 0
              && shoppingCount === 0;

            const title = synthesis
              ? synthesis
              : isFullyEmpty
                ? "I don't have anything to brief you on yet."
                : "You're all caught up for today.";

            const body = error
              ? "Can't reach your home server. Pull to retry."
              : isFullyEmpty
                ? !calendarConnected
                  ? 'Connect your calendar, or tell me what’s happening this week — I’ll build from there.'
                  : 'Tell me what’s happening this week, drop in a school letter, or share a contact — I’ll start to know your context.'
                : cards.length > 0
                  ? `${cards.length} item${cards.length === 1 ? '' : 's'} await your attention below.`
                  : 'Your stream is quiet. Memu is listening in the background.';

            return (
              <AIInsightCard
                label="Today's brief"
                icon="sparkles"
                greeting={todayHeader.greeting}
                dateLabel={todayHeader.dateLabel}
                title={title}
                body={body}
                ctaLabel={cards.length > 0 ? 'Review stream' : undefined}
                onCta={cards.length > 0 ? undefined : undefined}
              />
            );
          })()}
        </View>

        {/* News feed — Google-Discover-shaped block of curated headlines.
            Sources, location-driven regional matching, and refresh cadence
            are all driven by the user's brief preferences. Pull-to-refresh
            on the inner scroll; "More news" expands per-source from 3 → 8. */}
        <View style={styles.section}>
          <NewsFeed />
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
            {cards.map(card => {
              // Data-driven: if the card was persisted with structured actions
              // (briefing, reflection, care standards), render those. Fall back
              // to the legacy Calendar/List/Done triplet only for cards from
              // the old extraction path that have no actions[] yet.
              const persistedActions = mapCardActions(card);
              const hasPersisted = persistedActions && persistedActions.length > 0;
              const fallbackActions: NonNullable<React.ComponentProps<typeof StreamCard>['actions']> = hasPersisted ? [] : [
                ...(card.card_type !== 'shopping' ? [{
                  label: 'Calendar',
                  icon: 'calendar-outline' as const,
                  variant: 'secondary' as const,
                  onPress: () => handleAddToCalendar(card.id),
                }] : []),
                ...(card.card_type !== 'shopping' ? [{
                  label: 'List',
                  icon: 'basket-outline' as const,
                  variant: 'secondary' as const,
                  onPress: () => handleAddToShopping(card.id),
                }] : []),
                {
                  label: 'Done',
                  icon: 'checkmark' as const,
                  variant: 'primary' as const,
                  onPress: () => handleResolve(card.id),
                },
              ];
              return (
                <StreamCard
                  key={card.id}
                  id={card.id}
                  cardType={card.card_type}
                  title={card.title}
                  body={card.body}
                  source={card.source}
                  onDismiss={() => handleDismiss(card.id)}
                  onEdit={() => openEdit(card)}
                  actions={hasPersisted ? persistedActions : fallbackActions}
                />
              );
            })}
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

      {/* Reply-draft preview — opens for any briefing action of kind reply_draft.
          v1: read-only preview with Copy + Skip. No autonomous send. */}
      <Modal visible={!!replyPreview} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Draft reply</Text>
            {replyPreview?.recipient ? (
              <Text style={styles.modalLabel}>To: {replyPreview.recipient}</Text>
            ) : null}
            <Text style={[styles.modalInput, styles.modalInputMultiline, { textAlignVertical: 'top' }]}>
              {replyPreview?.draftText || ''}
            </Text>
            <View style={styles.modalActions}>
              <GradientButton
                label="Skip"
                onPress={handleReplyDraftSkip}
                variant="ghost"
              />
              <GradientButton
                label="Copy"
                onPress={handleReplyDraftCopy}
              />
            </View>
          </View>
        </View>
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

  onboardingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    ...shadows.low,
  },
  onboardingBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingBannerText: { flex: 1 },
  onboardingBannerTitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
  },
  onboardingBannerSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: 2,
    textTransform: 'capitalize',
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
