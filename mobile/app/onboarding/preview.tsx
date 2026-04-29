import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import {
  getOnboardingState, getPushDiagnostics,
  type OnboardingState,
} from '../../lib/api';
import { registerForPushNotifications, type PushRegistrationResult } from '../../lib/push';
import GradientButton from '../../components/GradientButton';
import MemuBubble from '../../components/MemuBubble';

/**
 * Preview step — the breath between conversational seeding and the
 * channels OAuth. Three jobs:
 *
 *   1. Show what Memu now holds (counts of answered steps), grounding
 *      the user in the real outcome of the prior 60 seconds.
 *   2. Wire push notifications — the foundation feature ("morning
 *      briefing") that the rest of the product depends on. Until the
 *      2026-04-29 fix, push tokens never registered for any user;
 *      surfacing it here means we're confronting that on Day 0 rather
 *      than silently failing for weeks.
 *   3. Hand the user off to channels.tsx (calendar OAuth) or directly
 *      to Today if they skip.
 */
export default function PreviewStep() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [pushTokenCount, setPushTokenCount] = useState<number>(0);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushResult, setPushResult] = useState<PushRegistrationResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [stateRes, pushRes] = await Promise.all([
      getOnboardingState(),
      getPushDiagnostics(),
    ]);
    if (stateRes.data) setState(stateRes.data.state);
    if (pushRes.data) setPushTokenCount(pushRes.data.tokenCount);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleEnablePush = useCallback(async () => {
    setPushBusy(true);
    const result = await registerForPushNotifications();
    setPushResult(result);
    if (result.ok) {
      await refresh();
    } else if (result.reason === 'permission_denied') {
      Alert.alert(
        'Notifications disabled',
        'Memu can only send push notifications if you enable them for the app in your device Settings.',
        [
          { text: 'Skip', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ],
      );
    }
    setPushBusy(false);
  }, [refresh]);

  const handleContinue = useCallback(() => {
    router.replace('/onboarding/channels');
  }, [router]);

  const handleSkipRest = useCallback(() => {
    // Skip channels too — go straight to Today. The user can hook up
    // calendar later via Settings → Connection.
    router.replace('/(tabs)');
  }, [router]);

  if (loading || !state) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Build the "what I know" summary from the state. We deliberately avoid
  // calling /api/dashboard/synthesis here — that fires a fresh Sonnet call
  // and the user will get one organically when they land on Today. The
  // preview's job is to ground them in the concrete outcome, not generate
  // a brief.
  const answeredSteps: string[] = [];
  if (state.people === 'answered') answeredSteps.push('the people in your life');
  if (state.rhythm === 'answered') answeredSteps.push('your weekly rhythm');
  if (state.focus === 'answered') answeredSteps.push("what's on your plate");

  const summary = answeredSteps.length === 0
    ? "You skipped the seed questions, which is fine — I'll learn as we chat."
    : answeredSteps.length === 1
      ? `I've got ${answeredSteps[0]}.`
      : answeredSteps.length === 2
        ? `I've got ${answeredSteps[0]} and ${answeredSteps[1]}.`
        : `I've got ${answeredSteps[0]}, ${answeredSteps[1]}, and ${answeredSteps[2]}.`;

  const pushOn = pushTokenCount > 0;

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {/* Progress dots — full bar lit, this is step 4 of 5 */}
      <View style={styles.progress}>
        {[1, 2, 3, 4, 5].map(i => (
          <View
            key={i}
            style={[styles.dot, i <= 4 && styles.dotActive, i === 4 && styles.dotCurrent]}
          />
        ))}
      </View>

      <MemuBubble
        text={summary}
        helper="Open the Spaces tab anytime to see, edit, or delete what I've remembered."
      />

      {/* What's saved — concrete outcome card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <Text style={styles.summaryHeaderText}>What's saved on your hardware</Text>
        </View>
        <View style={styles.summaryRows}>
          <SummaryRow
            label="People"
            status={state.people}
          />
          <SummaryRow
            label="Weekly rhythm"
            status={state.rhythm}
          />
          <SummaryRow
            label="Current focus"
            status={state.focus}
          />
        </View>
      </View>

      {/* Push notification prompt — paired with the briefing promise */}
      <MemuBubble
        text={
          pushOn
            ? "Notifications are on. I'll brief you each morning at 7."
            : 'Want me to brief you each morning? You\'ll get a push notification at 7am — and only when there\'s something useful to say.'
        }
        helper={
          pushOn
            ? undefined
            : 'You can change the time — or turn this off — in Settings later.'
        }
      />

      {!pushOn ? (
        <View style={styles.pushRow}>
          <GradientButton
            label={pushBusy ? 'Setting up…' : 'Enable morning briefings'}
            icon="notifications-outline"
            onPress={handleEnablePush}
            loading={pushBusy}
            full
          />
        </View>
      ) : null}

      {pushResult && !pushResult.ok && pushResult.reason !== 'permission_denied' ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
          <Text style={styles.errorText}>
            Couldn't register: {pushResult.reason}{pushResult.detail ? ` — ${pushResult.detail}` : ''}
          </Text>
        </View>
      ) : null}

      {/* Action row — continue to channels or skip to Today */}
      <View style={styles.actions}>
        <GradientButton
          label="Skip the rest"
          variant="ghost"
          onPress={handleSkipRest}
        />
        <GradientButton
          label="One more thing"
          icon="arrow-forward"
          onPress={handleContinue}
        />
      </View>
    </ScrollView>
  );
}

function SummaryRow({ label, status }: { label: string; status: 'pending' | 'answered' | 'skipped' }) {
  const iconName: React.ComponentProps<typeof Ionicons>['name'] =
    status === 'answered' ? 'checkmark' : status === 'skipped' ? 'remove' : 'ellipsis-horizontal';
  const tone =
    status === 'answered' ? colors.success : status === 'skipped' ? colors.textMuted : colors.textMuted;
  const note =
    status === 'answered' ? 'Saved' : status === 'skipped' ? 'Skipped — pick up later' : 'Not yet';
  return (
    <View style={styles.summaryRow}>
      <View style={[styles.summaryRowIcon, { backgroundColor: status === 'answered' ? colors.tertiaryContainer : colors.surfaceContainerHigh }]}>
        <Ionicons name={iconName} size={14} color={tone} />
      </View>
      <Text style={styles.summaryRowLabel}>{label}</Text>
      <Text style={[styles.summaryRowNote, { color: tone }]}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingTop: spacing['2xl'], paddingBottom: spacing['3xl'], backgroundColor: colors.surface },

  progress: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surfaceContainerHigh },
  dotActive: { backgroundColor: colors.primaryFixedDim },
  dotCurrent: { backgroundColor: colors.primary, width: 24, borderRadius: 4 },

  summaryCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.low,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  summaryHeaderText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  summaryRows: { gap: spacing.sm },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  summaryRowIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRowLabel: {
    flex: 1,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  summaryRowNote: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
  },

  pushRow: {
    marginBottom: spacing.lg,
  },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: typography.sizes.xs,
    flex: 1,
    fontFamily: typography.families.body,
  },

  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.xl,
  },
});
