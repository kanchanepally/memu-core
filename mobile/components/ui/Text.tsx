import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { typography, colors } from '../../lib/tokens';

export interface TextProps extends RNTextProps {
  variant?: 'ui' | 'reading';
  size?: keyof typeof typography.sizes;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  color?: keyof typeof colors;
  align?: 'left' | 'center' | 'right' | 'justify';
}

export const Text: React.FC<TextProps> = ({
  variant = 'ui',
  size = 'md',
  weight = 'regular',
  color = 'onSurface',
  align = 'left',
  style,
  ...props
}) => {
  const getFontFamily = () => {
    if (variant === 'ui') {
      switch (weight) {
        case 'medium': return typography.families.bodyMedium;
        case 'semibold': return typography.families.bodyBold; // Fallback to bold if semibold not defined
        case 'bold': return typography.families.bodyBold;
        default: return typography.families.body;
      }
    } else {
      switch (weight) {
        case 'medium': return typography.families.readingMedium;
        case 'semibold': return typography.families.readingBold; // Lora doesn't have semibold in tokens
        case 'bold': return typography.families.readingBold;
        default: return typography.families.reading;
      }
    }
  };

  return (
    <RNText
      style={[
        {
          fontFamily: getFontFamily(),
          fontSize: typography.sizes[size as keyof typeof typography.sizes],
          color: colors[color],
          textAlign: align,
        },
        style,
      ]}
      {...props}
    />
  );
};
