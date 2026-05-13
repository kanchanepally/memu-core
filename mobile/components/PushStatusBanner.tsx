import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../lib/tokens';
import { useToast } from './Toast';
import { sendTestPush, getPushDiagnostics, type PushTokenSummary } from '../lib/api';
import { registerForPushNotifications } from '../lib/push';

interface Props {
  tokens: PushTokenSummary[];
  onTokensChange: (tokens: PushTokenSummary[]) => void;
}

/**
 * Push status surfaced on Today — the one place Hareesh actually opens daily.
 *
 * Two visual states:
 *   - "Setup needed" (loud, primary tint) — tokens.length === 0
 *   - "Lock-screen brief on" (subtle, surfaceVariant) — at least one token
 *
 * Either way the user is one tap from verification ("Send a ping") rather
 * than four taps deep in Settings → Notifications → modal → Send test.
 *
 * The diagnostic + test endpoints already exist on the backend
 * (/api/push/diagnose, /api/push/test); this is purely the discoverable
 * surface for them.
 */
export default function PushStatusBanner({ tokens, onTokensChange }: Props) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const refreshTokens = useCallback(async () => {
    const { data } = await getPushDiagnostics();
    if (data) onTokensChange(data.tokens);
  }, [onTokensChange]);

  const handleEnable = useCallback(async () => {
    setBusy(true);
    const result = await registerForPushNotifications();
    if (result.ok) {
      await refreshTokens();
      toast.show('Notifications on — try the test ping', 'success');
    } else if (result.reason === 'permission_denied') {
      Alert.alert(
        'Notifications turned off',
        'Memu can only ping you if notifications are enabled for the app in your device Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ],
      );
    } else if (result.reason === 'simulator') {
      toast.show('Push only works on a real device, not a simulator', 'error');
    } else if (result.reason === 'token_unavailable') {
      Alert.alert(
        'Push token unavailable',
        result.detail ?? "Expo couldn't issue a token. On Android this usually means Firebase Cloud Messaging credentials aren't set up for the EAS project.",
        [{ text: 'OK' }],
      );
    } else {
      const detail = result.detail ? `${result.reason} — ${result.detail.slice(0, 120)}` : result.reason;
      toast.show(`Couldn't enable: ${detail}`, 'error');
    }
    setBusy(false);
  }, [refreshTokens, toast]);

  const handleTest = useCallback(async () => {
    setBusy(true);
    const { data, error } = await sendTestPush();
    setBusy(false);
    if (error) {
      toast.show(error.length > 80 ? "Couldn't send test" : error, 'error');
      return;
    }
    const n = data?.attempted ?? 0;
    toast.show(`Sent to ${n} device${n === 1 ? '' : 's'} — check your lock screen`, 'success');
  }, [toast]);

  // No tokens → "Setup needed" state.
  if (tokens.length === 0) {
    return (
      <View style={[styles.banner, styles.bannerSetup]}>
        <View style={styles.iconWrap}>
          <Ionicons name="notifications-off-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.copyWrap}>
          <Text style={styles.title}>Get your 7am brief on the lock screen</Text>
          <Text style={styles.subtitle}>Memu can't reach you yet — takes one tap.</Text>
        </View>
        <Pressable
          onPress={handleEnable}
          disabled={busy}
          style={({ pressed }) => [
            styles.action,
            styles.actionPrimary,
            pressed && { opacity: 0.7 },
            busy && { opacity: 0.5 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text style={styles.actionTextPrimary}>Enable</Text>
          )}
        </Pressable>
      </View>
    );
  }

  // Tokens present → "Ready" state, with one-tap test ping.
  return (
    <View style={[styles.banner, styles.bannerReady]}>
      <View style={styles.iconWrap}>
        <Ionicons name="notifications-outline" size={18} color={colors.tertiary} />
      </View>
      <View style={styles.copyWrap}>
        <Text style={styles.titleReady}>Lock-screen brief is on</Text>
        <Text style={styles.subtitleReady}>
          {tokens.length === 1 ? 'This device' : `${tokens.length} devices`} · 7am every day
        </Text>
      </View>
      <Pressable
        onPress={handleTest}
        disabled={busy}
        style={({ pressed }) => [
          styles.action,
          styles.actionGhost,
          pressed && { opacity: 0.7 },
          busy && { opacity: 0.5 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={styles.actionTextGhost}>Send ping</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  bannerSetup: {
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  bannerReady: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.tertiaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  subtitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  titleReady: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
  },
  subtitleReady: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: {
    backgroundColor: colors.primary,
  },
  actionGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionTextPrimary: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onPrimary,
    letterSpacing: typography.tracking.tight,
  },
  actionTextGhost: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
    letterSpacing: typography.tracking.tight,
  },
});
