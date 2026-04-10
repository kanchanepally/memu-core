import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../../lib/tokens';
import { getGoogleAuthUrl } from '../../lib/api';

export default function ChannelsScreen() {
  const router = useRouter();
  const [calendarConnecting, setCalendarConnecting] = useState(false);
  const [calendarDone, setCalendarDone] = useState(false);

  const handleConnectCalendar = useCallback(async () => {
    setCalendarConnecting(true);
    const { data, error } = await getGoogleAuthUrl();
    setCalendarConnecting(false);

    if (data?.url) {
      await Linking.openURL(data.url);
      // Optimistically mark as done — user completes OAuth in browser
      setCalendarDone(true);
    }
  }, []);

  const handleFinish = () => {
    // Navigate to the main app — replace so there's no back to onboarding
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      {/* Progress */}
      <View style={styles.progress}>
        <View style={[styles.dot, styles.dotActive]} />
        <View style={[styles.dot, styles.dotActive]} />
        <View style={[styles.dot, styles.dotActive]} />
      </View>

      <Text style={styles.heading}>Connect your channels</Text>
      <Text style={styles.subheading}>
        These are optional. You can always connect them later in Settings.
      </Text>

      {/* Google Calendar */}
      <View style={styles.channelCard}>
        <View style={styles.channelIcon}>
          <Ionicons name="calendar-outline" size={24} color={colors.accent} />
        </View>
        <View style={styles.channelInfo}>
          <Text style={styles.channelTitle}>Google Calendar</Text>
          <Text style={styles.channelBody}>
            See your schedule in the Today view. Memu can spot conflicts and suggest times.
          </Text>
        </View>
        {calendarDone ? (
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
        ) : (
          <Pressable
            style={[styles.connectButton, calendarConnecting && { opacity: 0.6 }]}
            onPress={handleConnectCalendar}
            disabled={calendarConnecting}
          >
            {calendarConnecting ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={styles.connectButtonText}>Connect</Text>
            )}
          </Pressable>
        )}
      </View>

      {/* WhatsApp Forwarding — info only for now */}
      <View style={styles.channelCard}>
        <View style={styles.channelIcon}>
          <Ionicons name="logo-whatsapp" size={24} color="#25D366" />
        </View>
        <View style={styles.channelInfo}>
          <Text style={styles.channelTitle}>WhatsApp Forwarding</Text>
          <Text style={styles.channelBody}>
            Forward messages to Memu to build your family context. Coming soon — we'll email you when it's ready.
          </Text>
        </View>
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonText}>Soon</Text>
        </View>
      </View>

      {/* Document Upload — info only */}
      <View style={styles.channelCard}>
        <View style={styles.channelIcon}>
          <Ionicons name="document-text-outline" size={24} color={colors.sourceDocument} />
        </View>
        <View style={styles.channelInfo}>
          <Text style={styles.channelTitle}>Documents</Text>
          <Text style={styles.channelBody}>
            Share school letters, appointment letters, or any document. Memu extracts the actions.
          </Text>
        </View>
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonText}>Soon</Text>
        </View>
      </View>

      <View style={styles.bottom}>
        <Pressable style={styles.primaryButton} onPress={handleFinish}>
          <Text style={styles.primaryButtonText}>Start using Memu</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </Pressable>

        <Pressable style={styles.skipLink} onPress={handleFinish}>
          <Text style={styles.skipLinkText}>Skip for now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    paddingTop: spacing['2xl'],
  },

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
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 24,
    borderRadius: 4,
  },

  heading: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subheading: {
    fontSize: typography.sizes.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },

  channelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  channelIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accentLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelInfo: {
    flex: 1,
  },
  channelTitle: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.text,
    marginBottom: 2,
  },
  channelBody: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  connectButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  connectButtonText: {
    fontSize: typography.sizes.sm,
    color: colors.accent,
    fontWeight: typography.weights.semibold,
  },
  comingSoon: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  comingSoonText: {
    fontSize: typography.sizes.xs,
    color: colors.textMuted,
    fontWeight: typography.weights.medium,
  },

  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
  skipLink: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  skipLinkText: {
    fontSize: typography.sizes.sm,
    color: colors.textMuted,
  },
});
