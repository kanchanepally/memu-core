import React from 'react';
import { ScrollView, View, RefreshControl, StyleProp, ViewStyle } from 'react-native';
import { useTokens } from '../lib/theme';
import { spacing } from '../lib/tokens';

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
 * Standard screen surface. Background tracks the v3 theme via useTokens(),
 * generous bottom inset so content clears the floating tab bar. Use under
 * the ScreenHeader.
 */
export default function ScreenContainer({
  children,
  refreshing = false,
  onRefresh,
  contentStyle,
  scrollable = true,
  bottomInset = 120,
}: Props) {
  const t = useTokens();
  const rootStyle = { flex: 1, backgroundColor: t.bg };
  const contentStyleBase = { paddingTop: spacing.lg };

  if (!scrollable) {
    return (
      <View style={[rootStyle, { paddingBottom: bottomInset }, contentStyle]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={rootStyle}
      contentContainerStyle={[contentStyleBase, { paddingBottom: bottomInset }, contentStyle]}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.brand}
          />
        ) : undefined
      }
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}
