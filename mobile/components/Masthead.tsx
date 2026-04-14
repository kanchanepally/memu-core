import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../lib/tokens';

interface Props {
  eyebrow?: string;           // uppercase label above the headline
  headline: string;           // the big Manrope headline
  accent?: string;            // optional inline accent word (rendered italic + primary)
  subheading?: string;
  align?: 'left' | 'center';
}

/**
 * Editorial Masthead — uppercase eyebrow + large Manrope headline.
 * Optionally highlights a single word with italic + primary colour.
 */
export default function Masthead({ eyebrow, headline, accent, subheading, align = 'left' }: Props) {
  const parts = accent ? headline.split(accent) : [headline];

  return (
    <View style={[styles.container, align === 'center' && styles.centered]}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.headline}>
        {parts.length === 2 ? (
          <>
            {parts[0]}
            <Text style={styles.accent}>{accent}</Text>
            {parts[1]}
          </>
        ) : (
          headline
        )}
      </Text>
      {subheading ? <Text style={styles.sub}>{subheading}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
  },
  centered: {
    alignItems: 'center',
  },
  eyebrow: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: spacing.sm,
  },
  headline: {
    fontSize: 38,
    lineHeight: 44,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  accent: {
    color: colors.primary,
    fontStyle: 'italic',
  },
  sub: {
    marginTop: spacing.md,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
});
