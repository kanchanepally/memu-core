import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, StatusBar } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, typography } from '../lib/tokens';
import { LogoMark } from './Logo';
import { useDrawer } from '../lib/drawer';

/**
 * Indigo Sanctuary top header.
 * Left: avatar (LogoMark) — tap to open the side drawer.
 * Centre: optional wordmark.
 * Right: optional overflow / close button.
 *
 * `statusLabel` and `statusPulse` are accepted for back-compat but no longer
 * rendered — they were obscuring the wordmark and added little signal.
 */
interface Props {
  title?: string;
  showLogo?: boolean;
  showWordmark?: boolean;
  statusLabel?: string;
  statusPulse?: boolean;
  onRightPress?: () => void;
  rightIcon?: React.ComponentProps<typeof Ionicons>['name'];
}

const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 44;

export default function ScreenHeader({
  title,
  showLogo = true,
  showWordmark = false,
  onRightPress,
  rightIcon,
}: Props) {
  const router = useRouter();
  const { show: openDrawer } = useDrawer();

  return (
    <BlurView intensity={60} tint="light" style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.left}>
          {showLogo ? (
            <Pressable
              onPress={openDrawer}
              accessibilityLabel="Open menu"
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <LogoMark size={32} />
            </Pressable>
          ) : null}
          {title ? <Text style={styles.title}>{title}</Text> : null}
        </View>

        {showWordmark ? (
          <Text style={styles.wordmark}>Memu</Text>
        ) : <View />}

        <View style={styles.right}>
          {rightIcon ? (
            <Pressable
              onPress={onRightPress ?? (() => router.back())}
              accessibilityLabel="Close"
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name={rightIcon} size={22} color={colors.onSurfaceVariant} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: TOP_PAD,
    backgroundColor: 'rgba(249,249,251,0.6)',
  },
  inner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    justifyContent: 'flex-end',
  },
  title: {
    fontSize: typography.sizes.lg,
    color: colors.onSurface,
    fontFamily: typography.families.bodyBold,
  },
  wordmark: {
    fontSize: typography.sizes['xl'],
    color: colors.primary,
    fontFamily: typography.families.headline,
    letterSpacing: typography.tracking.tight,
  },
});
