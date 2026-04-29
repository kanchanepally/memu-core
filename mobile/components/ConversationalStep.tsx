import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../lib/tokens';
import {
  getOnboardingState, submitOnboardingAnswer, skipOnboardingStep,
  type OnboardingStep, type OnboardingStepCopy,
} from '../lib/api';
import GradientButton from './GradientButton';
import MemuBubble from './MemuBubble';

interface Props {
  /** Which step this screen owns. Drives copy lookup and persistence. */
  step: Extract<OnboardingStep, 'people' | 'rhythm' | 'focus'>;
  /** Where to navigate on completion or skip — typically the next step in
   *  the onboarding sequence (or '/onboarding/preview' for the last step). */
  nextRoute: string;
  /** Step number for the progress dots (1-indexed against the conversational
   *  cluster: people=1, rhythm=2, focus=3). Total is fixed at 3 here; the
   *  preview + channels steps have their own progress treatment. */
  stepNumber: 1 | 2 | 3;
}

/**
 * The conversational onboarding screen — shared by people, rhythm, focus.
 *
 * Lifecycle:
 *   1. On mount, fetch /api/onboarding/state to receive the personalised
 *      `copy` for this step (prompt is generated server-side from prior
 *      answers — see src/onboarding/prompts.ts).
 *   2. If the user previously answered this step, prefill the input from
 *      `state.answers[step]` so they can edit rather than retype. This is
 *      what makes the step revisitable from Settings.
 *   3. User types → taps Continue → POST /api/onboarding/answer. Backend
 *      runs autolearn, creates Spaces, returns a structured ack.
 *   4. Display ack as a second MemuBubble. User taps "Continue" to navigate
 *      to nextRoute.
 *
 * Skip path: just POST /api/onboarding/skip and navigate. No ack — the
 * user has explicitly chosen not to seed this step.
 */
export default function ConversationalStep({ step, nextRoute, stepNumber }: Props) {
  const router = useRouter();
  const [copy, setCopy] = useState<OnboardingStepCopy | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);

  // Load the per-step copy + any prior answer.
  useEffect(() => {
    (async () => {
      const { data } = await getOnboardingState();
      if (data) {
        // Use the server's `copy` if it matches this step's nextStep — but
        // we may navigate to a step earlier than nextStep (revisit from
        // Settings), so resolve client-side from the server's full copy.
        if (data.nextStep === step && data.copy) {
          setCopy(data.copy);
        } else {
          // Fetch a generic placeholder while the server-side personalised
          // copy isn't available for this exact step. The server tracks
          // ONLY the next-pending copy, so for revisits we synthesise a
          // simple fallback. v2: server endpoint that takes ?step= param.
          setCopy({
            prompt: defaultPromptForStep(step),
            placeholder: defaultPlaceholderForStep(step),
            helper: 'Update or refine your earlier answer.',
            skipLabel: 'Skip',
          });
        }
        const prior = data.state.answers[step];
        if (prior) setAnswer(prior);
      }
      setStateLoaded(true);
    })();
  }, [step]);

  const handleSubmit = useCallback(async () => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await submitOnboardingAnswer(step, trimmed);
    setSubmitting(false);
    if (err || !data) {
      setError(err || 'Could not save your answer. Try again?');
      return;
    }
    setAcknowledgement(data.acknowledgement);
  }, [answer, step]);

  const handleContinue = useCallback(() => {
    router.replace(nextRoute as any);
  }, [router, nextRoute]);

  const handleSkip = useCallback(async () => {
    setSkipping(true);
    await skipOnboardingStep(step);
    setSkipping(false);
    router.replace(nextRoute as any);
  }, [router, nextRoute, step]);

  if (!stateLoaded || !copy) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const hasAck = acknowledgement !== null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Progress — 3 dots for the conversational cluster */}
        <View style={styles.progress}>
          {[1, 2, 3].map(i => (
            <View
              key={i}
              style={[
                styles.dot,
                i <= stepNumber && styles.dotActive,
                i === stepNumber && styles.dotCurrent,
              ]}
            />
          ))}
        </View>

        {/* Memu's prompt — the conversational opener */}
        <MemuBubble text={copy.prompt} helper={copy.helper} />

        {/* User's answer (echoed as a 'sent message' once submitted) */}
        {hasAck ? (
          <View style={styles.userBubbleRow}>
            <View style={styles.userBubble}>
              <Text style={styles.userBubbleText}>{answer}</Text>
            </View>
          </View>
        ) : null}

        {/* Memu's acknowledgement — appears after the answer is processed */}
        {acknowledgement ? (
          <MemuBubble text={acknowledgement} variant="ack" />
        ) : null}

        {/* Input — hidden once we've shown the ack */}
        {!hasAck ? (
          <View style={styles.inputBlock}>
            <TextInput
              style={styles.input}
              value={answer}
              onChangeText={setAnswer}
              placeholder={copy.placeholder}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              autoFocus
              accessibilityLabel="Your answer"
            />
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Action row */}
        <View style={styles.actions}>
          {!hasAck ? (
            <>
              <GradientButton
                label={copy.skipLabel}
                variant="ghost"
                onPress={handleSkip}
                loading={skipping}
              />
              <GradientButton
                label={submitting ? 'Saving…' : 'Continue'}
                onPress={handleSubmit}
                disabled={!answer.trim()}
                loading={submitting}
                icon="arrow-forward"
              />
            </>
          ) : (
            <GradientButton
              label="Continue"
              onPress={handleContinue}
              icon="arrow-forward"
              full
            />
          )}
        </View>

        {/* Subtle "edit my earlier answer" affordance once we've shown the ack */}
        {hasAck ? (
          <Pressable style={styles.editLink} onPress={() => setAcknowledgement(null)}>
            <Ionicons name="pencil-outline" size={12} color={colors.textMuted} />
            <Text style={styles.editLinkText}>Edit your answer</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Fallback copy for revisited steps. Used when the server's `nextStep` !==
// the step the user is revisiting (which means `state.copy` is for a
// different step). Plain prompts — the personalisation is for the FIRST
// pass; revisits get a generic re-frame.
function defaultPromptForStep(step: 'people' | 'rhythm' | 'focus'): string {
  switch (step) {
    case 'people': return "Who are the people who matter most to your day?";
    case 'rhythm': return "What's the rhythm of your week?";
    case 'focus':  return "What's on your plate right now?";
  }
}

function defaultPlaceholderForStep(step: 'people' | 'rhythm' | 'focus'): string {
  switch (step) {
    case 'people': return "First names with roles — e.g. 'Rach (wife), Robin (7yo)'.";
    case 'rhythm': return "Recurring weekly anchors.";
    case 'focus':  return "Big things, small things — anything that matters.";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingTop: spacing['2xl'], paddingBottom: spacing['3xl'] },

  progress: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceContainerHigh,
  },
  dotActive: {
    backgroundColor: colors.primaryFixedDim,
  },
  dotCurrent: {
    backgroundColor: colors.primary,
    width: 24,
    borderRadius: 4,
  },

  userBubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.lg,
  },
  userBubble: {
    maxWidth: '85%',
    backgroundColor: colors.primaryContainer,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  userBubbleText: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onPrimaryContainer,
    lineHeight: 22,
  },

  inputBlock: {
    marginBottom: spacing.lg,
  },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: 120,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    lineHeight: 22,
  },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorContainer,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: typography.sizes.sm,
    flex: 1,
    fontFamily: typography.families.body,
  },

  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },

  editLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.lg,
  },
  editLinkText: {
    fontSize: typography.sizes.xs,
    color: colors.textMuted,
    fontFamily: typography.families.body,
  },
});
