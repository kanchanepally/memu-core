import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import {
  getGoogleAuthUrl, completeOnboarding, getTodayBrief,
} from '../../lib/api';
import GradientButton from '../../components/GradientButton';
import MemuBubble from '../../components/MemuBubble';

/**
 * Channels — the final onboarding step. Just Google Calendar OAuth.
 *
 * Refactored 2026-04-29:
 *   - Removed the "WhatsApp Forwarding (Soon)" and "Documents (Soon)"
 *     placeholders. Both are now real features (WhatsApp self-chat
 *     ingestion + document upload via Spaces). The "Soon" treatment
 *     was misleading users into thinking the product had less than
 *     it does.
 *   - Calls completeOnboarding() on Continue or Skip so the Today
 *     banner clears and the flow's `completedAt` lands.
 */
export default function ChannelsStep() {
  const router = useRouter();
  const [calendarConnecting, setCalendarConnecting] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Re-check calendar state on focus — the OAuth round-trip happens in
  // the system browser, so when the user comes back we want to reflect
  // the new state without making them tap a refresh button.
  useEffect(() => {
    (async () => {
      const { data } = await getTodayBrief();
      if (data?.isCalendarConnected) setCalendarConnected(true);
    })();
  }, []);

  const handleConnectCalendar = useCallback(async () => {
    setCalendarConnecting(true);
    const { data } = await getGoogleAuthUrl('mobile');
    setCalendarConnecting(false);
    if (data?.url) {
      await Linking.openURL(data.url);
      // Optimistic — actual confirmation arrives via the brief poll above.
      setCalendarConnected(true);
    }
  }, []);

  const handleFinish = useCallback(async () => {
    setCompleting(true);
    await completeOnboarding();
    setCompleting(false);
    router.replace('/(tabs)/chat');
  }, [router]);

  return (
    <View style={styles.container}>
      {/* Progress — full bar */}
      <View style={styles.progress}>
        {[1, 2, 3, 4, 5].map(i => (
          <View
            key={i}
            style={[styles.dot, styles.dotActive, i === 5 && styles.dotCurrent]}
          />
        ))}
      </View>

      <MemuBubble
        text="Last thing — want to plug in your Google Calendar? Optional, but it makes the morning briefing a lot more useful."
        helper="The OAuth happens in your browser. I only see the events on this calendar — and only on this device."
      />

      {/* Calendar card */}
      <View style={styles.channelCard}>
        <View style={styles.channelIcon}>
          <Ionicons name="calendar-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.channelInfo}>
          <Text style={styles.channelTitle}>Google Calendar</Text>
          <Text style={styles.channelBody}>
            Today's events on the home screen, conflict detection in the morning brief,
            and one-tap "add to calendar" actions in chat.
          </Text>
        </View>
        {calendarConnected ? (
          <View style={styles.connectedChip}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.connectedChipText}>Linked</Text>
          </View>
        ) : (
          <Pressable
            style={[styles.connectButton, calendarConnecting && { opacity: 0.6 }]}
            onPress={handleConnectCalendar}
            disabled={calendarConnecting}
          >
            {calendarConnecting ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.connectButtonText}>Connect</Text>
            )}
          </Pressable>
        )}
      </View>

      <Text style={styles.footnote}>
        Other ways to feed Memu — WhatsApp self-chat forwarding, photo uploads, document
        drops — work straight away. No setup needed.
      </Text>

      <View style={styles.bottom}>
        <GradientButton
          label={completing ? 'Finishing…' : calendarConnected ? 'Open Today' : 'Continue without calendar'}
          icon="arrow-forward"
          onPress={handleFinish}
          loading={completing}
          full
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    paddingTop: spacing['2xl'],
  },

  progress: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surfaceContainerHigh },
  dotActive: { backgroundColor: colors.primaryFixedDim },
  dotCurrent: { backgroundColor: colors.primary, width: 24, borderRadius: 4 },

  channelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.low,
  },
  channelIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primaryContainer,
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelInfo: { flex: 1 },
  channelTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    marginBottom: 2,
  },
  channelBody: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  connectButton: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  connectButtonText: {
    fontSize: typography.sizes.xs,
    color: colors.primary,
    fontFamily: typography.families.bodyMedium,
  },
  connectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  connectedChipText: {
    fontSize: typography.sizes.xs,
    color: colors.success,
    fontFamily: typography.families.bodyMedium,
  },

  footnote: {
    fontSize: typography.sizes.xs,
    color: colors.textMuted,
    fontFamily: typography.families.body,
    fontStyle: 'italic',
    lineHeight: 18,
    marginBottom: spacing.xl,
  },

  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xl,
  },
});
