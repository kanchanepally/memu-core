import React from 'react';
import { Pressable, PressableProps, StyleSheet, ViewStyle } from 'react-native';
import { Text } from './Text';
import { colors, spacing, radius } from '../../lib/tokens';

export interface ButtonProps extends PressableProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  style,
  disabled,
  ...props
}) => {
  const getBackgroundColor = (pressed: boolean) => {
    if (disabled) return colors.surfaceContainerHigh;
    switch (variant) {
      case 'primary': return pressed ? colors.primaryDim : colors.primary;
      case 'secondary': return pressed ? colors.surfaceContainerHighest : colors.surfaceContainerHigh;
      case 'ghost': return pressed ? colors.surfaceContainer : 'transparent';
      case 'danger': return pressed ? colors.errorDim : colors.error;
      default: return colors.primary;
    }
  };

  const getTextColor = () => {
    if (disabled) return 'onSurfaceVariant';
    switch (variant) {
      case 'primary': return 'onPrimary';
      case 'secondary': return 'onSurface';
      case 'ghost': return 'primary';
      case 'danger': return 'onError';
      default: return 'onPrimary';
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        styles[`size_${size}`],
        fullWidth && styles.fullWidth,
        { backgroundColor: getBackgroundColor(pressed) },
        typeof style === 'function' ? style({ pressed }) : style,
      ]}
      disabled={disabled}
      {...props}
    >
      <Text
        variant="ui"
        weight="medium"
        size={size === 'sm' ? 'sm' : 'body'}
        color={getTextColor()}
        align="center"
      >
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  size_sm: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  size_md: {
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  size_lg: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  fullWidth: {
    width: '100%',
  },
});
