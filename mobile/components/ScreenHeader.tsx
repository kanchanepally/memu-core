import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, typography } from '../lib/tokens';
import Logo, { LogoMark } from './Logo';

/**
 * Inline screen header — sits flush with content (no borders, no elevation).
 * Use on every tab after hiding the native header. Anytype-style: spacing
 * does the structural work, not lines.
 */
interface Props {
  title?: string;
  showLogo?: boolean;
  showWordmark?: boolean;
}

export default function ScreenHeader({ title, showLogo = true, showWordmark = false }: Props) {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {showWordmark ? (
          <Logo width={120} height={36} scale={0.3} />
        ) : showLogo ? (
          <LogoMark size={28} />
        ) : null}
        {title ? <Text style={styles.title}>{title}</Text> : null}
      </View>
      <Pressable
        onPress={() => router.push('/settings')}
        accessibilityLabel="Settings"
        hitSlop={8}
      >
        <Ionicons name="ellipsis-horizontal-circle-outline" size={24} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: (Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 44) + spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.text,
    fontFamily: 'Outfit_600SemiBold',
  },
});
