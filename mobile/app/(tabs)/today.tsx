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
  getTodayBrief, resolveCard, dismissCard, editCard, addToCalendar, cardToShopping,
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
import { getCardTypeDisplay } from '../../lib/cardTypeDisplay';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
// AIInsightCard retired from Dashboard — briefings live in chat now.
// The component is still used by other surfaces (briefing bubble in chat
// uses its styling); the import here goes with the hero render that was
// removed.
import PushStatusBanner from '../../components/PushStatusBanner';
import NewsFeed from '../../components/NewsFeed';
import StreamCard from '../../components/StreamCard';
import GradientButton from '../../components/GradientButton';

// Phase A.9 — Dashboard reshape. Card-type classification for zones.
//   Zone 1 (open commitments) = concrete "do-this" cards
//   Zone 2 (noticed)          = observations / reflections / patterns
// Source of truth for the enum is migration 019; mirror via cardTypeDisplay
// for label + tone resolution per type.
const COMMITMENT_CARD_TYPES = new Set([
  'extraction', 'reminder', 'document_extracted', 'calendar_added', 'proactive_nudge',
]);
const NOTICED_CARD_TYPES = new Set([
  'contradiction', 'stale_fact', 'pattern', 'unfinished_business',
  'care_standard_lapsed', 'collision', 'weekly_digest',
]);

// Time-bucket conflict detection for today's schedule. Two events overlap →
// both get an amber rule. Same logic mirrored in the PWA.
function flagClashes(events: BriefEvent[]): Array<BriefEvent & { clash: boolean }> {
  if (!Array.isArray(events) || events.length < 2) {
    return events.map(e => ({ ...e, clash: false }));
  }
  const withTimes = events.map(e => ({
    ...e,
    startMs: e.startTime ? new Date(e.startTime).getTime() : null,
    endMs: e.endTime ? new Date(e.endTime).getTime() : null,
  }));
  return withTimes.map((e, i) => {
    const startMs = e.startMs;
    if (startMs === null) return { ...e, clash: false };
    const endMs = e.endMs ?? (startMs + 30 * 60 * 1000);
    const clash = withTimes.some((o, j) => {
      if (i === j || o.startMs === null) return false;
      const bStart = o.startMs;
      const bEnd = o.endMs ?? (o.startMs + 30 * 60 * 1000);
      return startMs < bEnd && bStart < endMs;
    });
    return { ...e, clash };
  });
}

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
  // synthesis state retired with the briefing-hero removal — Dashboard
  // no longer pulls the briefing via /api/dashboard/synthesis. The
  // chat surface is the canonical place for the morning brief.

  // Push status — surfaced as a banner above the hero so the user can verify
  // notification delivery in two taps rather than four-deep in Settings.
  const [pushTokens, setPushTokens] = useState<PushTokenSummary[]>([]);

  // Phase A.9.1 — family/individual lens. Default is `me`
  // (individual-first per the architectural North Star — show the
  // smallest scope by default; the user widens to the household).
  // Calendar events swap on toggle; stream cards / shopping list are
  // still household-scope today (no owner_profile_id axis on cards) —
  // the provenance footer names that gap so the pill doesn't lie.
  const [lens, setLens] = useState<'family' | 'me'>('me');
  const [lensCalendarCount, setLensCalendarCount] = useState<number>(1);
  const firstName = useMemo(
    () => (displayName ? displayName.split(' ')[0] : 'Me'),
    [displayName],
  );
  const cycleLens = useCallback(() => {
    setLens(prev => (prev === 'family' ? 'me' : 'family'));
  }, []);

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
    const { data, error: err } = await getTodayBrief(lens);
    if (err) {
      setError(err);
    } else if (data) {
      setEvents(data.todayEvents || data.events || []);
      setCards(data.streamCards || []);
      setShoppingCount((data.shoppingItems || []).length);
      setCalendarConnected(data.isCalendarConnected);
      setLensCalendarCount(data.lensCalendarCount ?? 1);
      setError(null);
    }
    setLoading(false);
  }, [lens]);

  // Refresh whenever the tab is focused
  useFocusEffect(
    useCallback(() => {
      loadBrief();
      loadOnboardingBanner();
      loadPushStatus();
    }, [loadBrief, loadOnboardingBanner, loadPushStatus])
  );

  useEffect(() => {
    loadBrief();
    loadOnboardingBanner();
    loadPushStatus();
    loadAuthState().then(auth => {
      if (auth.displayName) setDisplayName(auth.displayName);
    });
  }, [loadBrief, loadOnboardingBanner, loadPushStatus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBrief();
    setRefreshing(false);
  }, [loadBrief]);

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

  // Zone 3 starter prompts — route to chat with a seeded message. Mirrors
  // the PWA's askMemuStarter() approach. Chat input reads the message and
  // fires the standard pipeline; no new API surface required.
  const askMemuStarter = useCallback((prompt: string) => {
    router.push({ pathname: '/(tabs)/chat', params: { seed: prompt } } as any);
  }, [router]);

  // Split cards into Zone 1 (commitments) and Zone 2 (noticed). Memoised
  // so re-renders don't recompute on every state nudge.
  const { commitments, noticed } = useMemo(() => {
    const commitments: StreamCardData[] = [];
    const noticed: StreamCardData[] = [];
    for (const c of cards) {
      if (COMMITMENT_CARD_TYPES.has(c.card_type)) commitments.push(c);
      else if (NOTICED_CARD_TYPES.has(c.card_type)) noticed.push(c);
    }
    return { commitments, noticed };
  }, [cards]);

  const taggedEvents = useMemo(() => flagClashes(events), [events]);

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

        {/* ─── Zone 0 — Context header ──────────────────────────── */}
        <View style={styles.headerZone}>
          <View style={styles.headerMeta}>
            <Text style={styles.headerDate}>{todayHeader.dateLabel}</Text>
            <Text style={styles.headerGreeting}>{todayHeader.greeting}</Text>
          </View>
          <Pressable
            style={styles.lensPill}
            onPress={cycleLens}
            accessibilityLabel={`Switch view to ${lens === 'family' ? 'individual' : 'family'}`}
          >
            <Ionicons name="people-outline" size={13} color={colors.primary} />
            <Text style={styles.lensPillLabel}>{lens === 'family' ? 'Family' : firstName}</Text>
            <Ionicons name="chevron-down-outline" size={10} color={colors.primary} />
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>Can't reach your home server. Pull to retry.</Text>
          </View>
        ) : null}

        {/* ─── Zone 1 — What's happening ─────────────────────────── */}
        <View style={styles.zone}>
          <View style={styles.zoneEyebrow}>
            <Ionicons name="time-outline" size={11} color={colors.primary} />
            <Text style={styles.zoneEyebrowText}>What's happening</Text>
          </View>

          {/* Schedule card */}
          <View style={styles.zoneCard}>
            <View style={styles.zoneCardHead}>
              <Ionicons name="calendar-outline" size={13} color={colors.primary} />
              <Text style={styles.zoneCardHeadText}>Schedule</Text>
              {/* Phase A.9.1 — show-the-work: when the lens widens to
                  Family, name exactly how many calendars were merged so
                  the user can read what the pill did. Quiet on 'me'. */}
              {lens === 'family' && (
                <Text style={styles.zoneCardHeadMeta}>
                  {lensCalendarCount <= 1
                    ? '· Just yours — no other calendars connected'
                    : `· ${lensCalendarCount} calendars merged`}
                </Text>
              )}
            </View>
            {!calendarConnected ? (
              <Pressable
                style={styles.zoneEmptyRow}
                onPress={() => router.push('/(tabs)/calendar')}
              >
                <Text style={styles.zoneEmptyText}>Connect a calendar to see today's shape.</Text>
                <Text style={styles.zoneEmptyLink}>Connect →</Text>
              </Pressable>
            ) : taggedEvents.length === 0 ? (
              <View style={styles.zoneEmptyRow}>
                <Text style={styles.zoneEmptyText}>No events today. Your day is wide open.</Text>
              </View>
            ) : (
              <View style={styles.zoneList}>
                {taggedEvents.slice(0, 4).map((event, i) => (
                  <View
                    key={i}
                    style={[styles.scheduleRow, event.clash && styles.scheduleRowClash]}
                  >
                    <Text style={styles.scheduleTime}>{formatTime(event.startTime) || '—'}</Text>
                    <Text style={styles.scheduleTitle} numberOfLines={1}>{event.title}</Text>
                    {event.clash ? <Text style={styles.scheduleClashBadge}>Clash</Text> : null}
                  </View>
                ))}
                {taggedEvents.length > 4 ? (
                  <Pressable onPress={() => router.push('/(tabs)/calendar')} style={styles.scheduleMore}>
                    <Text style={styles.scheduleMoreText}>
                      +{taggedEvents.length - 4} more · see calendar
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          {/* Open commitments card */}
          <View style={styles.zoneCard}>
            <View style={styles.zoneCardHead}>
              <Ionicons name="checkbox-outline" size={13} color={colors.primary} />
              <Text style={styles.zoneCardHeadText}>Open commitments</Text>
            </View>
            {commitments.length === 0 && shoppingCount === 0 ? (
              <View style={styles.zoneEmptyRow}>
                <Text style={styles.zoneEmptyText}>Nothing open. You're caught up.</Text>
              </View>
            ) : (
              <View style={styles.zoneList}>
                {commitments.slice(0, 4).map(card => {
                  const display = getCardTypeDisplay(card.card_type);
                  return (
                    <Pressable
                      key={card.id}
                      style={styles.commitmentRow}
                      onPress={() => router.push('/(tabs)/chat' as any)}
                    >
                      <Text style={styles.commitmentEyebrow}>{display.label}</Text>
                      <Text style={styles.commitmentTitle} numberOfLines={1}>{card.title}</Text>
                      <Ionicons name="chevron-forward-outline" size={14} color={colors.outline} />
                    </Pressable>
                  );
                })}
                {shoppingCount > 0 ? (
                  <Pressable
                    style={styles.commitmentRow}
                    onPress={() => router.push('/(tabs)/lists')}
                  >
                    <View style={styles.commitmentDot} />
                    <Text style={styles.commitmentTitle} numberOfLines={1}>
                      Shopping list · {shoppingCount} item{shoppingCount === 1 ? '' : 's'}
                    </Text>
                    <Ionicons name="chevron-forward-outline" size={14} color={colors.outline} />
                  </Pressable>
                ) : null}
                {commitments.length > 4 ? (
                  <Pressable onPress={() => router.push('/(tabs)/chat' as any)} style={styles.scheduleMore}>
                    <Text style={styles.scheduleMoreText}>
                      +{commitments.length - 4} more in chat →
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        </View>

        {/* ─── Zone 2 — What I noticed ───────────────────────────── */}
        <View style={styles.zone}>
          <View style={styles.zoneEyebrow}>
            <View style={styles.diamondGlyph} />
            <Text style={styles.zoneEyebrowText}>What I noticed</Text>
          </View>
          {noticed.length === 0 ? (
            <View style={styles.noticedEmpty}>
              <Text style={styles.noticedEmptyText}>
                Memu hasn't surfaced anything to flag. As patterns and contradictions accumulate
                across your Spaces and chats, they'll appear here.
              </Text>
            </View>
          ) : (
            <View style={styles.zoneList}>
              {noticed.slice(0, 5).map(card => {
                const display = getCardTypeDisplay(card.card_type);
                const isAttention = display.tone === 'attention';
                return (
                  <View
                    key={card.id}
                    style={[
                      styles.noticedCard,
                      { borderLeftColor: isAttention ? '#C26A00' : colors.primary },
                    ]}
                  >
                    <View style={styles.noticedEyebrow}>
                      <Ionicons
                        name={display.icon}
                        size={11}
                        color={isAttention ? '#C26A00' : colors.primary}
                      />
                      <Text
                        style={[
                          styles.noticedEyebrowText,
                          { color: isAttention ? '#C26A00' : colors.primary },
                        ]}
                      >
                        {display.label.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.noticedTitle}>{card.title}</Text>
                    {card.body ? (
                      <Text style={styles.noticedBody}>{card.body}</Text>
                    ) : null}
                    <View style={styles.noticedActions}>
                      <Pressable
                        style={styles.noticedBtnPrimary}
                        onPress={() => handleResolve(card.id)}
                      >
                        <Text style={styles.noticedBtnPrimaryText}>Mark done</Text>
                      </Pressable>
                      <Pressable
                        style={styles.noticedBtnGhost}
                        onPress={() => handleDismiss(card.id)}
                      >
                        <Text style={styles.noticedBtnGhostText}>Dismiss</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ─── Zone 3 — What I'm thinking ────────────────────────── */}
        <View style={styles.zoneThinking}>
          <View style={styles.zoneEyebrow}>
            <Ionicons name="sparkles-outline" size={11} color={colors.primary} />
            <Text style={styles.zoneEyebrowText}>What I'm thinking</Text>
          </View>
          <Text style={styles.thinkingIntro}>
            Memu is starting to learn what matters to you. Try one of these to surface
            what's worth your attention this week.
          </Text>
          <View style={styles.thinkingStack}>
            <Pressable
              style={styles.thinkingCard}
              onPress={() => askMemuStarter(
                "What's worth doing this weekend with the family? " +
                "Consider Robin's age and our recent activities."
              )}
            >
              <View style={styles.thinkingCardIcon}>
                <Ionicons name="home-outline" size={16} color={colors.primary} />
              </View>
              <View style={styles.thinkingCardBody}>
                <Text style={styles.thinkingCardTitle}>Weekend ideas</Text>
                <Text style={styles.thinkingCardSub}>Local events that fit our family</Text>
              </View>
              <Ionicons name="chevron-forward-outline" size={14} color={colors.outline} />
            </Pressable>
            <Pressable
              style={styles.thinkingCard}
              onPress={() => askMemuStarter(
                'What should we eat this week? Suggest 3 recipes that work for our ' +
                'household given anything you know about our preferences.'
              )}
            >
              <View style={styles.thinkingCardIcon}>
                <Ionicons name="restaurant-outline" size={16} color={colors.primary} />
              </View>
              <View style={styles.thinkingCardBody}>
                <Text style={styles.thinkingCardTitle}>Meals this week</Text>
                <Text style={styles.thinkingCardSub}>Recipes from what you've told me</Text>
              </View>
              <Ionicons name="chevron-forward-outline" size={14} color={colors.outline} />
            </Pressable>
            <Pressable
              style={styles.thinkingCard}
              onPress={() => askMemuStarter(
                "What's worth my attention this week? Look across my Spaces, " +
                "calendar, and any patterns you've noticed and tell me what I might be missing."
              )}
            >
              <View style={styles.thinkingCardIcon}>
                <Ionicons name="search-outline" size={16} color={colors.primary} />
              </View>
              <View style={styles.thinkingCardBody}>
                <Text style={styles.thinkingCardTitle}>What I'm missing</Text>
                <Text style={styles.thinkingCardSub}>Across Spaces, calendar, patterns</Text>
              </View>
              <Ionicons name="chevron-forward-outline" size={14} color={colors.outline} />
            </Pressable>
          </View>
        </View>

        {/* ─── Zone 4 — News (demoted) ───────────────────────────── */}
        <View style={styles.zoneNews}>
          <View style={styles.zoneNewsHead}>
            <View style={styles.zoneEyebrow}>
              <Ionicons name="newspaper-outline" size={11} color={colors.primary} />
              <Text style={styles.zoneEyebrowText}>News</Text>
            </View>
          </View>
          <NewsFeed />
        </View>

        {/* ─── Privacy provenance footer ─────────────────────────── */}
        <Pressable style={styles.provenance} onPress={() => router.push('/ledger')}>
          <View style={styles.provenanceDot} />
          <Text style={styles.provenanceText}>
            Anonymised via Digital Twin · External models: <Text style={styles.provenanceStrong}>0</Text>
          </Text>
          <Text style={styles.provenanceLink}>Ledger →</Text>
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

  // Phase A.9 — Dashboard reshape — 5 concentric zones.

  // ─── Zone 0 — Context header ───────────────────────────────────
  headerZone: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerMeta: { flex: 1, gap: 2 },
  headerDate: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  headerGreeting: {
    fontSize: 26,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
    lineHeight: 32,
    marginTop: 2,
  },
  lensPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.secondaryContainer,
    marginBottom: 4,
  },
  lensPillLabel: {
    fontSize: 12,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
    letterSpacing: 0.02,
  },

  errorBanner: {
    marginHorizontal: spacing.md,
    padding: spacing.md,
    backgroundColor: '#FFF7E6',
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: '#E6B847',
  },
  errorBannerText: {
    fontSize: typography.sizes.sm,
    color: '#7A5A12',
    fontFamily: typography.families.body,
  },

  // ─── Zone scaffold ─────────────────────────────────────────────
  zone: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
    gap: 12,
  },
  zoneEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  zoneEyebrowText: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  diamondGlyph: {
    width: 8,
    height: 8,
    backgroundColor: colors.primary,
    transform: [{ rotate: '45deg' }],
    marginRight: 2,
  },
  zoneCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    gap: 10,
    ...shadows.low,
  },
  zoneCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.outline + '20',
  },
  zoneCardHeadText: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  zoneCardHeadMeta: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    opacity: 0.7,
    textTransform: 'none',
    letterSpacing: 0,
    flexShrink: 1,
  },
  zoneList: {
    gap: 4,
  },
  zoneEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  zoneEmptyText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
  },
  zoneEmptyLink: {
    fontSize: 12,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
  },

  // Schedule rows
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  scheduleRowClash: {
    borderLeftColor: '#B88843',
    backgroundColor: 'rgba(184, 136, 67, 0.06)',
  },
  scheduleTime: {
    fontSize: 10,
    fontFamily: typography.families.bodyBold,
    color: colors.primary,
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    letterSpacing: 0.04,
    minWidth: 56,
    textAlign: 'center',
    overflow: 'hidden',
  },
  scheduleTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  scheduleClashBadge: {
    fontSize: 9,
    fontFamily: typography.families.bodyBold,
    color: '#B88843',
    textTransform: 'uppercase',
    letterSpacing: 0.08,
  },
  scheduleMore: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  scheduleMoreText: {
    fontSize: 11,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
  },

  // Open-commitment rows
  commitmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    borderRadius: radius.md,
  },
  commitmentEyebrow: {
    fontSize: 9,
    fontFamily: typography.families.bodyBold,
    color: colors.primary,
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    letterSpacing: 0.1,
    textTransform: 'uppercase',
    overflow: 'hidden',
  },
  commitmentTitle: {
    flex: 1,
    fontSize: 13,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  commitmentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },

  // ─── Zone 2 — Noticed ──────────────────────────────────────────
  noticedEmpty: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  noticedEmptyText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
  },
  noticedCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    padding: spacing.md + 2,
    borderLeftWidth: 3,
    gap: 4,
    ...shadows.low,
  },
  noticedEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  noticedEyebrowText: {
    fontSize: 10,
    fontFamily: typography.families.label,
    letterSpacing: typography.tracking.widest,
  },
  noticedTitle: {
    fontSize: 14,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    lineHeight: 20,
  },
  noticedBody: {
    fontSize: 13,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 19,
  },
  noticedActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  noticedBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  noticedBtnPrimaryText: {
    fontSize: 12,
    fontFamily: typography.families.bodyMedium,
    color: colors.onPrimary,
  },
  noticedBtnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  noticedBtnGhostText: {
    fontSize: 12,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurfaceVariant,
  },

  // ─── Zone 3 — Thinking ─────────────────────────────────────────
  zoneThinking: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    marginBottom: spacing.xl,
    backgroundColor: 'rgba(80, 84, 181, 0.04)',
    gap: 12,
  },
  thinkingIntro: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
    marginTop: -2,
  },
  thinkingStack: { gap: 8 },
  thinkingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(80, 84, 181, 0.10)',
  },
  thinkingCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thinkingCardBody: { flex: 1 },
  thinkingCardTitle: {
    fontSize: 14,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
  },
  thinkingCardSub: {
    fontSize: 12,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: 2,
    lineHeight: 16,
  },

  // ─── Zone 4 — News (demoted) ───────────────────────────────────
  zoneNews: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.outline + '20',
    gap: 10,
  },
  zoneNewsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // ─── Privacy provenance footer ─────────────────────────────────
  provenance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.outline + '20',
  },
  provenanceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ade80',
  },
  provenanceText: {
    flex: 1,
    fontSize: 11,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  provenanceStrong: {
    fontFamily: typography.families.bodyBold,
    color: colors.onSurface,
  },
  provenanceLink: {
    fontSize: 11,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
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

