import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, typography } from '../lib/tokens';
import { useTokens } from '../lib/theme';

interface Props {
  eyebrow?: string;           // uppercase label above the headline
  headline: string;           // the big serif headline
  accent?: string;            // optional inline accent word (rendered italic + primary)
  subheading?: string;
  align?: 'left' | 'center';
}

/**
 * Editorial Masthead — uppercase eyebrow + large serif headline.
 * Optionally highlights a single word with italic + brand colour.
 * v3 dark-mode parity — uses useTokens() so it follows the theme swap.
 */
export default function Masthead({ eyebrow, headline, accent, subheading, align = 'left' }: Props) {
  const t = useTokens();
  const parts = accent ? headline.split(accent) : [headline];

  return (
    <View style={[styles.container, align === 'center' && styles.centered]}>
      {eyebrow ? (
        <Text style={[styles.eyebrow, { color: t.brand }]}>{eyebrow}</Text>
      ) : null}
      <Text style={[styles.headline, { color: t.text, fontFamily: t.serif }]}>
        {parts.length === 2 ? (
          <>
            {parts[0]}
            <Text style={{ color: t.brand, fontFamily: t.serifItalic, fontStyle: 'italic' }}>{accent}</Text>
            {parts[1]}
          </>
        ) : (
          headline
        )}
      </Text>
      {subheading ? (
        <Text style={[styles.sub, { color: t.text2 }]}>{subheading}</Text>
      ) : null}
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
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: spacing.sm,
  },
  headline: {
    fontSize: 38,
    lineHeight: 44,
    letterSpacing: typography.tracking.tight,
  },
  sub: {
    marginTop: spacing.md,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    lineHeight: 22,
  },
});
