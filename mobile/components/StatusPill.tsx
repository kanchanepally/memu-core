import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { colors, spacing, typography, radius } from '../lib/tokens';

interface Props {
  label: string;
  pulse?: boolean;
  tone?: 'primary' | 'success' | 'muted';
}

export default function StatusPill({ label, pulse = true, tone = 'primary' }: Props) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);

  const dotColor =
    tone === 'success' ? colors.success :
    tone === 'muted' ? colors.outline :
    colors.primary;

  return (
    <View style={styles.pill}>
      <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity }]} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.pill,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
});
