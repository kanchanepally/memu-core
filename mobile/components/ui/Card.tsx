import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { colors, spacing, radius, shadows } from '../../lib/tokens';

export interface CardProps extends ViewProps {
  variant?: 'elevated' | 'outlined' | 'flat';
  padding?: keyof typeof spacing | 'none';
  elevation?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({
  variant = 'elevated',
  padding = 'lg',
  elevation = 'sm',
  style,
  children,
  ...props
}) => {
  return (
    <View
      style={[
        styles.base,
        variant === 'elevated' && styles.elevated,
        variant === 'outlined' && styles.outlined,
        variant === 'flat' && styles.flat,
        padding !== 'none' && { padding: spacing[padding] },
        variant === 'elevated' && elevation !== 'none' && shadows[elevation],
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainerLowest,
  },
  elevated: {
    backgroundColor: colors.surfaceContainerLowest,
  },
  outlined: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
  },
  flat: {
    backgroundColor: colors.surfaceContainerLow,
  },
});
