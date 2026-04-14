import React from 'react';
import { ScrollView, View, StyleSheet, RefreshControl, StyleProp, ViewStyle } from 'react-native';
import { colors, spacing } from '../lib/tokens';

interface Props {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  /** Extra bottom padding to clear the floating tab bar (default: 120) */
  bottomInset?: number;
}

/**
 * Standard screen surface. Cool-neutral background, generous bottom inset
 * so content clears the floating tab bar. Use under the ScreenHeader.
 */
export default function ScreenContainer({
  children,
  refreshing = false,
  onRefresh,
  contentStyle,
  scrollable = true,
  bottomInset = 120,
}: Props) {
  if (!scrollable) {
    return (
      <View style={[styles.root, { paddingBottom: bottomInset }, contentStyle]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }, contentStyle]}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        ) : undefined
      }
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    paddingTop: spacing.lg,
  },
});
