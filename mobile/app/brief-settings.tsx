import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Switch,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getBriefPreferences,
  updateBriefPreferences,
  type BriefPreferences,
  type NewsSourceOption,
} from '../lib/api';
import { useToast } from '../components/Toast';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import ScreenHeader from '../components/ScreenHeader';
import GradientButton from '../components/GradientButton';

/**
 * Your morning brief — per-profile customisation of the 7am briefing.
 *
 * The brief is whatever you want it to be. Four amendable surfaces:
 *
 *   1. Location — "Ivybridge", "Plymouth", anywhere. Server geocodes via
 *      Open-Meteo and uses it for weather + regional news matching.
 *   2. News sources — toggle BBC, Guardian, Hacker News, regional papers.
 *   3. Topics — free-text interests, comma-separated. Weighted into the
 *      brief over time.
 *   4. Thinking prompt — one daily "worth thinking about today" line
 *      generated from your recent Spaces. On by default; turn off if you
 *      want a pure news-and-calendar brief.
 *
 * No save button — every change writes back on blur / toggle so the user
 * can play with it and the next 7am brief reflects their choices.
 */
export default function BriefSettingsScreen() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<BriefPreferences | null>(null);
  const [availableSources, setAvailableSources] = useState<NewsSourceOption[]>([]);

  // Local-only text state so the user can type without each keystroke
  // hitting the server. Commit on blur.
  const [placeDraft, setPlaceDraft] = useState('');
  const [topicsDraft, setTopicsDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getBriefPreferences();
    if (data) {
      setPrefs(data.preferences);
      // 'regional' is a meta-source the user always has access to — show
      // it in the list even if the backend catalogue doesn't enumerate it
      // (the catalogue lists concrete feeds; 'regional' picks among them).
      const sources = data.availableSources.some(s => s.id === 'regional')
        ? data.availableSources
        : [...data.availableSources, { id: 'regional', label: 'Local / regional paper' }];
      setAvailableSources(sources);
      setPlaceDraft(data.preferences.location?.placeName || '');
      setTopicsDraft((data.preferences.topics || []).join(', '));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savePlace = useCallback(async () => {
    const trimmed = placeDraft.trim();
    if (!trimmed) return;
    if (trimmed === prefs?.location?.placeName) return; // unchanged
    setBusy(true);
    const { data, error } = await updateBriefPreferences({ placeName: trimmed });
    setBusy(false);
    if (error) {
      toast.show(error.length > 80 ? "Couldn't save location" : error, 'error');
      // Revert draft to the persisted value so the user sees what's actually saved.
      setPlaceDraft(prefs?.location?.placeName || '');
      return;
    }
    if (data) {
      setPrefs(data.preferences);
      setPlaceDraft(data.preferences.location?.placeName || '');
      toast.show(`Location set to ${data.preferences.location?.placeName}`, 'success');
    }
  }, [placeDraft, prefs, toast]);

  const saveTopics = useCallback(async () => {
    const topics = topicsDraft
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);
    const current = (prefs?.topics || []);
    // Skip if no real change.
    if (topics.length === current.length && topics.every((t, i) => t === current[i])) return;
    setBusy(true);
    const { data, error } = await updateBriefPreferences({ topics });
    setBusy(false);
    if (error) {
      toast.show("Couldn't save topics", 'error');
      return;
    }
    if (data) setPrefs(data.preferences);
  }, [topicsDraft, prefs, toast]);

  const toggleSource = useCallback(async (sourceId: string) => {
    if (!prefs) return;
    const current = prefs.newsSources || [];
    const next = current.includes(sourceId)
      ? current.filter(s => s !== sourceId)
      : [...current, sourceId];
    setBusy(true);
    const { data, error } = await updateBriefPreferences({ newsSources: next });
    setBusy(false);
    if (error) {
      toast.show("Couldn't update sources", 'error');
      return;
    }
    if (data) setPrefs(data.preferences);
  }, [prefs, toast]);

  const toggleThinkingPrompt = useCallback(async (value: boolean) => {
    setBusy(true);
    const { data, error } = await updateBriefPreferences({ thinkingPromptEnabled: value });
    setBusy(false);
    if (error) {
      toast.show("Couldn't save preference", 'error');
      return;
    }
    if (data) setPrefs(data.preferences);
  }, [toast]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!prefs) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Couldn't load preferences.</Text>
        <GradientButton label="Retry" onPress={load} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Your morning brief" rightIcon="close" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Lead — sets the tone */}
          <View style={styles.lead}>
            <Text style={styles.leadTitle}>The brief is yours.</Text>
            <Text style={styles.leadBody}>
              Where you are, what you read, what's worth thinking about. Tweak any of it. The next 7am brief will reflect your choices.
            </Text>
          </View>

          {/* Location */}
          <Text style={styles.sectionLabel}>Where you are</Text>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="location-outline" size={18} color={colors.tertiary} />
              <Text style={styles.cardTitle}>Location</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              We use this for weather and to find local news. Type a town or city — we'll look it up.
            </Text>
            <TextInput
              style={styles.input}
              value={placeDraft}
              onChangeText={setPlaceDraft}
              onBlur={savePlace}
              placeholder="e.g. Ivybridge"
              placeholderTextColor={colors.outline}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={savePlace}
            />
            {prefs.location ? (
              <Text style={styles.helper}>
                Resolved to {prefs.location.placeName} ({prefs.location.lat.toFixed(3)}, {prefs.location.lon.toFixed(3)})
              </Text>
            ) : (
              <Text style={styles.helper}>Defaults to London until you set a place.</Text>
            )}
          </View>

          {/* News sources */}
          <Text style={styles.sectionLabel}>News you'd like</Text>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="newspaper-outline" size={18} color={colors.tertiary} />
              <Text style={styles.cardTitle}>News sources</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              Pick the feeds you actually read. The brief pulls 2-3 headlines from each.
            </Text>
            <View style={styles.sourceList}>
              {availableSources.map(src => {
                const enabled = prefs.newsSources.includes(src.id);
                return (
                  <Pressable
                    key={src.id}
                    onPress={() => toggleSource(src.id)}
                    style={({ pressed }) => [
                      styles.sourceRow,
                      enabled && styles.sourceRowActive,
                      pressed && { opacity: 0.7 },
                    ]}
                    disabled={busy}
                  >
                    <Ionicons
                      name={enabled ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={enabled ? colors.primary : colors.outline}
                    />
                    <Text style={[styles.sourceLabel, enabled && styles.sourceLabelActive]}>
                      {src.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.helper}>
              "Local / regional paper" picks the right paper for your location automatically.
            </Text>
          </View>

          {/* Topics */}
          <Text style={styles.sectionLabel}>What you care about</Text>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="pricetags-outline" size={18} color={colors.tertiary} />
              <Text style={styles.cardTitle}>Topics</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              Comma-separated. Used to weight what surfaces and to colour the thinking prompt. Free text — no need to match any taxonomy.
            </Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={topicsDraft}
              onChangeText={setTopicsDraft}
              onBlur={saveTopics}
              placeholder="e.g. AI, gardening, UK politics, sailing"
              placeholderTextColor={colors.outline}
              multiline
              returnKeyType="done"
              blurOnSubmit
            />
          </View>

          {/* Thinking prompt */}
          <Text style={styles.sectionLabel}>One thing worth thinking about</Text>
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.cardTitle}>Daily thinking prompt</Text>
                <Text style={styles.cardSubtitle}>
                  Once a day, Memu surfaces one thing from your recent Spaces that's worth a decision. Off if you'd rather just get news and calendar.
                </Text>
              </View>
              <Switch
                value={prefs.thinkingPromptEnabled}
                onValueChange={toggleThinkingPrompt}
                trackColor={{ false: colors.surfaceVariant, true: colors.primary }}
                thumbColor={colors.surface}
                disabled={busy}
              />
            </View>
          </View>

          <View style={{ height: spacing.xl * 2 }} />
        </ScrollView>
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
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  lead: {
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  leadTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  leadBody: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.low,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  cardSubtitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  inputMulti: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  helper: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.outline,
    marginTop: spacing.xs,
  },
  sourceList: {
    gap: spacing.xs,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  sourceRowActive: {
    backgroundColor: colors.surfaceContainerLow,
  },
  sourceLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  sourceLabelActive: {
    color: colors.onSurface,
    fontFamily: typography.families.bodyMedium,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  toggleCopy: {
    flex: 1,
    gap: spacing.xs,
  },
});
