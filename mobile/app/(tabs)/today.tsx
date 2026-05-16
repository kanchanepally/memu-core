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
import { spacing, radius } from '../../lib/tokens';
import { useTokens } from '../../lib/theme';
import type { Tokens } from '../../lib/tokens';
import { getCardTypeDisplay } from '../../lib/cardTypeDisplay';
import { Logo, MarkWeekend, MarkMeals, MarkMissing } from '../../components/Marks';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import { Logo as MemuLogo } from '../../components/Marks';
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
  const t = useTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
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
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        showWordmark
        statusLabel={error ? 'Offline' : 'Node Syncing'}
        statusPulse={!error}
      />
      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        {/* v3 brand row */}
        <View style={styles.brandRow}>
          <Logo size={22} color={t.brand} color2={t.brandMuted} />
          <Text style={styles.brandWord}>memu</Text>
        </View>

        {/* Onboarding resume banner — shows when the conversational seed
            flow isn't complete. Stays at the top so it nudges without
            dominating; the Today's-brief insight card carries the day. */}
        {onboardingNextStep ? (
          <Pressable
            style={styles.onboardingBanner}
            onPress={() => router.push(`/onboarding/${onboardingNextStep}` as any)}
          >
            <View style={styles.onboardingBannerIcon}>
              <Ionicons name="sparkles-outline" size={16} color={t.brand} />
            </View>
            <View style={styles.onboardingBannerText}>
              <Text style={styles.onboardingBannerTitle}>Pick up where we left off</Text>
              <Text style={styles.onboardingBannerSub}>
                {onboardingProgress.done} of {onboardingProgress.total} done — next: {onboardingNextStep}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.text3} />
          </Pressable>
        ) : null}

        {/* Push status banner — shown when notifications aren't set up yet
            (loud, CTA-shaped) and when they are (subtle, with a one-tap test).
            Sits just above the hero so the lock-screen brief gate is visible
            the moment Today opens. */}
        <PushStatusBanner tokens={pushTokens} onTokensChange={setPushTokens} />

        {/* ─── Zone 0 — Context header (v3) ─────────────────────── */}
        <View style={styles.headerZone}>
          <View style={styles.headerMeta}>
            <View style={styles.brandRow}>
              <MemuLogo
                size={22}
                color={colors.primary}
                color2={colors.primaryContainer}
                showRing={false}
              />
              <Text style={styles.brandWordmark}>memu</Text>
            </View>
            <Text style={styles.headerDate}>{todayHeader.dateLabel}</Text>
            <Text style={styles.headerGreeting}>{todayHeader.greeting}</Text>
          </View>
          <Pressable
            style={styles.lensPill}
            onPress={cycleLens}
            accessibilityLabel={`Switch view to ${lens === 'family' ? 'individual' : 'family'}`}
          >
            <Ionicons name="people-outline" size={13} color={t.brand} />
            <Text style={styles.lensPillLabel}>{lens === 'family' ? 'Family' : firstName}</Text>
            <Ionicons name="chevron-down-outline" size={10} color={t.brand} />
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
            <Ionicons name="time-outline" size={11} color={t.brand} />
            <Text style={styles.zoneEyebrowText}>What's happening</Text>
          </View>

          {/* Schedule card */}
          <View style={styles.zoneCard}>
            <View style={styles.zoneCardHead}>
              <Ionicons name="calendar-outline" size={13} color={t.brand} />
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
              <Ionicons name="checkbox-outline" size={13} color={t.brand} />
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
                      <Ionicons name="chevron-forward-outline" size={14} color={t.text3} />
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
                    <Ionicons name="chevron-forward-outline" size={14} color={t.text3} />
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
                const accent = isAttention ? t.amber : t.brand;
                return (
                  <View
                    key={card.id}
                    style={[
                      styles.noticedCard,
                      { borderLeftColor: accent },
                    ]}
                  >
                    <View style={styles.noticedMark}>
                      {isAttention
                        ? <MarkMissing size={40} color={accent} />
                        : <MarkWeekend size={40} color={accent} />}
                    </View>
                    <View style={[styles.noticedVerbPill, { backgroundColor: accent + '1A' }]}>
                      <Ionicons
                        name={display.icon}
                        size={11}
                        color={accent}
                      />
                      <Text
                        style={[
                          styles.noticedEyebrowText,
                          { color: accent },
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
            <Ionicons name="sparkles-outline" size={11} color={t.brand} />
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
              <View style={styles.thinkingMark}>
                <MarkWeekend size={36} color={t.brand} />
              </View>
              <View style={styles.thinkingCardBody}>
                <Text style={styles.thinkingCardTitle}>Weekend ideas</Text>
                <Text style={styles.thinkingCardSub}>Local events that fit our family</Text>
              </View>
              <Text style={styles.thinkingAsk}>Ask Memu →</Text>
            </Pressable>
            <Pressable
              style={styles.thinkingCard}
              onPress={() => askMemuStarter(
                'What should we eat this week? Suggest 3 recipes that work for our ' +
                'household given anything you know about our preferences.'
              )}
            >
              <View style={styles.thinkingMark}>
                <MarkMeals size={36} color={t.brand} />
              </View>
              <View style={styles.thinkingCardBody}>
                <Text style={styles.thinkingCardTitle}>Meals this week</Text>
                <Text style={styles.thinkingCardSub}>Recipes from what you've told me</Text>
              </View>
              <Text style={styles.thinkingAsk}>Ask Memu →</Text>
            </Pressable>
            <Pressable
              style={styles.thinkingCard}
              onPress={() => askMemuStarter(
                "What's worth my attention this week? Look across my Spaces, " +
                "calendar, and any patterns you've noticed and tell me what I might be missing."
              )}
            >
              <View style={styles.thinkingMark}>
                <MarkMissing size={36} color={t.brand} />
              </View>
              <View style={styles.thinkingCardBody}>
                <Text style={styles.thinkingCardTitle}>What I'm missing</Text>
                <Text style={styles.thinkingCardSub}>Across Spaces, calendar, patterns</Text>
              </View>
              <Text style={styles.thinkingAsk}>Ask Memu →</Text>
            </Pressable>
          </View>
        </View>

        {/* ─── Zone 4 — News (demoted) ───────────────────────────── */}
        <View style={styles.zoneNews}>
          <View style={styles.zoneNewsHead}>
            <View style={styles.zoneEyebrow}>
              <Ionicons name="newspaper-outline" size={11} color={t.brand} />
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
              placeholderTextColor={t.text3}
            />
            <Text style={styles.modalLabel}>Details</Text>
            <TextInput
              style={[styles.modalInput, styles.modalInputMultiline]}
              value={editBody}
              onChangeText={setEditBody}
              placeholder="Card details"
              placeholderTextColor={t.text3}
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

function makeStyles(t: Tokens) {
  return StyleSheet.create({
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 4,
  },
  brandWord: {
    fontFamily: t.serifItalic,
    fontSize: 18,
    color: t.text,
  },
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: t.bg,
  },
  loadingText: {
    color: t.text2, fontSize: 15,
    fontFamily: t.uiRegular,
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
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  brandWordmark: {
    fontFamily: 'Newsreader_400Regular_Italic',
    fontSize: 18,
    color: colors.onSurface,
    letterSpacing: -0.3,
  },
  headerDate: {
    fontSize: 11,
    fontFamily: t.mono,
    color: t.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerGreeting: {
    fontSize: 28,
    fontFamily: t.serifRegular,
    color: t.text,
    letterSpacing: -0.5,
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
    backgroundColor: t.brandSoft,
    marginBottom: 4,
  },
  lensPillLabel: {
    fontSize: 12,
    fontFamily: t.mono,
    color: t.brand,
    letterSpacing: 0.02,
  },

  errorBanner: {
    marginHorizontal: spacing.md,
    padding: spacing.md,
    backgroundColor: t.amberBg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: t.amber,
  },
  errorBannerText: {
    fontSize: 13,
    color: t.amber,
    fontFamily: t.uiRegular,
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
    fontFamily: t.uiBold,
    color: t.text3,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  diamondGlyph: {
    width: 8,
    height: 8,
    backgroundColor: t.text3,
    transform: [{ rotate: '45deg' }],
    marginRight: 2,
  },
  zoneCard: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    borderWidth: 1,
    borderColor: t.border,
    gap: 10,
  },
  zoneCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  zoneCardHeadText: {
    fontSize: 11,
    fontFamily: t.uiBold,
    color: t.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  zoneCardHeadMeta: {
    fontSize: 11,
    fontFamily: t.mono,
    color: t.text3,
    opacity: 0.8,
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
    fontSize: 13,
    fontFamily: t.serifItalic,
    color: t.text2,
  },
  zoneEmptyLink: {
    fontSize: 12,
    fontFamily: t.ui,
    color: t.brand,
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
    borderLeftColor: t.amber,
    backgroundColor: t.amberBg,
  },
  scheduleTime: {
    fontSize: 10,
    fontFamily: t.mono,
    color: t.brand,
    backgroundColor: t.brandSoft,
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
    fontFamily: t.serif,
    color: t.text,
  },
  scheduleClashBadge: {
    fontSize: 9,
    fontFamily: t.uiBold,
    color: t.amber,
    textTransform: 'uppercase',
    letterSpacing: 0.08,
  },
  scheduleMore: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  scheduleMoreText: {
    fontSize: 11,
    fontFamily: t.ui,
    color: t.brand,
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
    fontFamily: t.uiBold,
    color: t.brand,
    backgroundColor: t.brandSoft,
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
    fontFamily: t.serif,
    color: t.text,
  },
  commitmentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.brand,
  },

  // ─── Zone 2 — Noticed ──────────────────────────────────────────
  noticedEmpty: {
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: t.border,
  },
  noticedEmptyText: {
    fontSize: 13,
    fontFamily: t.serifItalic,
    color: t.text2,
    lineHeight: 20,
  },
  noticedCard: {
    backgroundColor: t.surface,
    borderRadius: radius.md,
    padding: spacing.md + 2,
    borderWidth: 1,
    borderColor: t.border,
    borderLeftWidth: 3,
    gap: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  noticedMark: {
    position: 'absolute',
    top: 10,
    right: 10,
    opacity: 0.5,
  },
  noticedVerbPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
    marginBottom: 2,
  },
  noticedEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  noticedEyebrowText: {
    fontSize: 10,
    fontFamily: t.uiBold,
    letterSpacing: 0.6,
  },
  noticedTitle: {
    fontSize: 17,
    fontFamily: t.serif,
    color: t.text,
    lineHeight: 22,
    paddingRight: 36,
  },
  noticedBody: {
    fontSize: 13,
    fontFamily: t.uiRegular,
    color: t.text2,
    lineHeight: 19,
    paddingRight: 36,
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
    backgroundColor: t.brand,
  },
  noticedBtnPrimaryText: {
    fontSize: 12,
    fontFamily: t.ui,
    color: '#FFFFFF',
  },
  noticedBtnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  noticedBtnGhostText: {
    fontSize: 12,
    fontFamily: t.ui,
    color: t.text2,
  },

  // ─── Zone 3 — Thinking ─────────────────────────────────────────
  zoneThinking: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    marginBottom: spacing.xl,
    backgroundColor: t.brandSofter,
    gap: 12,
  },
  thinkingIntro: {
    fontSize: 13,
    fontFamily: t.serifItalic,
    color: t.text2,
    lineHeight: 20,
    marginTop: -2,
  },
  thinkingStack: { gap: 8 },
  thinkingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: t.border,
  },
  thinkingMark: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thinkingCardBody: { flex: 1 },
  thinkingCardTitle: {
    fontSize: 15,
    fontFamily: t.serif,
    color: t.text,
  },
  thinkingCardSub: {
    fontSize: 12,
    fontFamily: t.uiRegular,
    color: t.text2,
    marginTop: 2,
    lineHeight: 16,
  },
  thinkingAsk: {
    fontSize: 11,
    fontFamily: t.uiBold,
    color: t.brand,
  },

  // ─── Zone 4 — News (demoted) ───────────────────────────────────
  zoneNews: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: t.border,
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
    borderTopColor: t.border,
  },
  provenanceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.green,
  },
  provenanceText: {
    flex: 1,
    fontSize: 11,
    fontFamily: t.uiRegular,
    color: t.text3,
  },
  provenanceStrong: {
    fontFamily: t.uiBold,
    color: t.text,
  },
  provenanceLink: {
    fontSize: 11,
    fontFamily: t.ui,
    color: t.brand,
  },

  onboardingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  onboardingBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: t.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingBannerText: { flex: 1 },
  onboardingBannerTitle: {
    fontSize: 13,
    fontFamily: t.ui,
    color: t.text,
  },
  onboardingBannerSub: {
    fontSize: 11,
    fontFamily: t.uiRegular,
    color: t.text2,
    marginTop: 2,
    textTransform: 'capitalize',
  },

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
  modalTitle: {
    fontSize: 22,
    fontFamily: t.serif,
    color: t.text,
    marginBottom: spacing.lg,
    letterSpacing: -0.5,
  },
  modalLabel: {
    fontSize: 13,
    fontFamily: t.ui,
    color: t.text2,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  modalInput: {
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
    fontSize: 15,
    fontFamily: t.uiRegular,
    color: t.text,
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
}

