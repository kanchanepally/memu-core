import React from 'react';
import { Pressable, Text, StyleSheet, View, ActivityIndicator, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, motion } from '../lib/tokens';

interface Props {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  size?: 'md' | 'sm';
}

/**
 * Indigo Sanctuary button.
 * Primary: silk gradient primary → primaryContainer at 135°.
 * Secondary: secondaryContainer fill, no border.
 * Ghost: transparent. All tactile-scale on press (0.98).
 */
export default function GradientButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  loading,
  disabled,
  full,
  size = 'md',
}: Props) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const handlePressIn = () => {
    Animated.spring(scale, { toValue: motion.pressScale, useNativeDriver: true, speed: 30 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }).start();
  };

  const isDisabled = disabled || loading;
  const paddingV = size === 'sm' ? 10 : 14;
  const paddingH = size === 'sm' ? spacing.md : spacing.lg;

  const content = (
    <>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onPrimary : colors.primary} size="small" />
      ) : (
        <>
          {icon ? (
            <Ionicons
              name={icon}
              size={size === 'sm' ? 14 : 18}
              color={variant === 'primary' ? colors.onPrimary : colors.primary}
            />
          ) : null}
          <Text style={[
            styles.label,
            size === 'sm' && styles.labelSm,
            variant === 'primary' ? styles.labelOnPrimary : styles.labelOnSurface,
          ]}>
            {label}
          </Text>
        </>
      )}
    </>
  );

  const inner =
    variant === 'primary' ? (
      // Gradient simulated with two stacked views — keeps the component pure RN.
      <View style={[
        styles.base,
        { paddingVertical: paddingV, paddingHorizontal: paddingH },
        full && styles.full,
        styles.primary,
        isDisabled && styles.disabled,
      ]}>
        <View style={styles.gradientOverlay} pointerEvents="none" />
        <View style={styles.contentRow}>{content}</View>
      </View>
    ) : variant === 'secondary' ? (
      <View style={[
        styles.base,
        { paddingVertical: paddingV, paddingHorizontal: paddingH },
        full && styles.full,
        styles.secondary,
        isDisabled && styles.disabled,
      ]}>
        <View style={styles.contentRow}>{content}</View>
      </View>
    ) : (
      <View style={[
        styles.base,
        { paddingVertical: paddingV, paddingHorizontal: paddingH },
        full && styles.full,
        isDisabled && styles.disabled,
      ]}>
        <View style={styles.contentRow}>{content}</View>
      </View>
    );

  return (
    <Animated.View style={{ transform: [{ scale }], alignSelf: full ? 'stretch' : 'flex-start' }}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {inner}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  full: {
    width: '100%',
  },
  primary: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.primaryContainer,
    opacity: 0.35,
  },
  secondary: {
    backgroundColor: colors.secondaryContainer,
  },
  disabled: {
    opacity: 0.5,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyBold,
    letterSpacing: typography.tracking.wide,
  },
  labelSm: {
    fontSize: typography.sizes.xs,
  },
  labelOnPrimary: {
    color: colors.onPrimary,
  },
  labelOnSurface: {
    color: colors.primary,
  },
});
