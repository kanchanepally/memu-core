import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  getCapturePrompt,
  submitCapture,
  type CapturePrompt,
} from '../../lib/api';
import { useToast } from '../../components/Toast';
import { colors, spacing, radius, typography } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import GradientButton from '../../components/GradientButton';

/**
 * Quick capture — the screen behind the 11am / 4pm daytime nudge push.
 *
 * Designed for one-tap engagement: a single prompt, a single text input,
 * Save or Skip. Answer flows through /api/capture → autolearn → relevant
 * Space. The agency loop, closed in 5-10 seconds.
 *
 * Query params:
 *   - promptId — picks a specific prompt from the catalogue (set by the
 *                push notification's data payload)
 *   - question — optional override (lets the future smart-selector pass
 *                a generated question without a catalogue id)
 *
 * If neither is set we fetch the current slot's rotating prompt from the
 * server.
 */
export default function CaptureQuickScreen() {
  const router = useRouter();
  const params = useLocalSearchParams() as { promptId?: string; question?: string };
  const toast = useToast();

  const [prompt, setPrompt] = useState<CapturePrompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      // If the caller passed a full question (free-form override), build a
      // synthetic prompt without going to the server.
      if (params.question) {
        setPrompt({
          id: 'inline',
          notification: params.question,
          question: params.question,
          hint: 'Whatever you want me to remember — short and rough is fine.',
        });
        setLoading(false);
        return;
      }
      const { data } = await getCapturePrompt(params.promptId);
      if (data?.prompt) setPrompt(data.prompt);
      setLoading(false);
    })();
  }, [params.promptId, params.question]);

  const handleSave = useCallback(async () => {
    if (!prompt) return;
    const text = answer.trim();
    if (!text) return;
    setSaving(true);
    const { error } = await submitCapture({
      promptId: prompt.id === 'inline' ? undefined : prompt.id,
      question: prompt.question,
      answer: text,
    });
    setSaving(false);
    if (error) {
      toast.show('Couldn\'t save — try again', 'error');
      return;
    }
    toast.show('Got it — saved', 'success');
    router.back();
  }, [prompt, answer, router, toast]);

  const handleSkip = useCallback(() => {
    router.back();
  }, [router]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!prompt) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Couldn't load prompt.</Text>
        <GradientButton label="Close" onPress={handleSkip} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Quick capture" rightIcon="close" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          {/* Sparkle eyebrow + question. The prompt sets a relaxed tone —
              "rough is fine" — to lower the bar for engagement. Five-second
              capture, not a journaling exercise. */}
          <View style={styles.eyebrowRow}>
            <Ionicons name="sparkles" size={14} color={colors.tertiary} />
            <Text style={styles.eyebrow}>Memu asks</Text>
          </View>
          <Text style={styles.question}>{prompt.question}</Text>
          <Text style={styles.hint}>{prompt.hint}</Text>

          <TextInput
            style={styles.input}
            value={answer}
            onChangeText={setAnswer}
            placeholder="Type whatever comes to mind…"
            placeholderTextColor={colors.outline}
            multiline
            autoFocus
            maxLength={5000}
            textAlignVertical="top"
          />

          <View style={styles.actionRow}>
            <Pressable
              onPress={handleSkip}
              style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.6 }]}
              disabled={saving}
            >
              <Text style={styles.skipLabel}>Skip</Text>
            </Pressable>
            <GradientButton
              label={saving ? 'Saving…' : 'Save'}
              onPress={handleSave}
              loading={saving}
              disabled={!answer.trim() || saving}
            />
          </View>

          <Text style={styles.footnote}>
            I'll quietly route this to the right Space. You can review what I learned in Family Memory.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  errorText: {
    fontSize: typography.sizes.body,
    color: colors.onSurfaceVariant,
    fontFamily: typography.families.body,
  },
  container: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eyebrow: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  question: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    lineHeight: 28,
    letterSpacing: typography.tracking.tight,
  },
  hint: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    minHeight: 140,
    lineHeight: 22,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skipBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  skipLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  footnote: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.outline,
    fontStyle: 'italic',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
});
