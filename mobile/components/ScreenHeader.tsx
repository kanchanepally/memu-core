import React from 'react';
import { View, Text, Pressable, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { useTokens } from '../lib/theme';
import { useDrawer } from '../lib/drawer';

/**
 * v3 top header. Hamburger left, optional title (Newsreader serif), optional
 * right icon. Uses useTokens() so light/dark mode tracks the theme switcher
 * in Settings.
 *
 * Pre-v3 ScreenHeader used a BlurView + static Indigo Sanctuary tokens; the
 * shape and props are preserved so every existing call site keeps working.
 *
 * `statusLabel` / `statusPulse` / `showWordmark` are accepted for back-compat
 * but no longer rendered — they were obscuring the title and added little
 * signal in the v3 layout.
 */
interface Props {
  title?: string;
  showLogo?: boolean;       // back-compat — controls hamburger visibility
  showWordmark?: boolean;   // back-compat — no longer rendered
  statusLabel?: string;     // back-compat — no longer rendered
  statusPulse?: boolean;    // back-compat — no longer rendered
  onRightPress?: () => void;
  rightIcon?: React.ComponentProps<typeof Ionicons>['name'];
}

const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 44;

export default function ScreenHeader({
  title,
  showLogo = true,
  onRightPress,
  rightIcon,
}: Props) {
  const router = useRouter();
  const t = useTokens();
  const { show: openDrawer } = useDrawer();

  return (
    <View style={{
      paddingTop: TOP_PAD,
      backgroundColor: t.bg,
    }}>
      <View style={{
        paddingHorizontal: 18,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
      }}>
        {showLogo ? (
          <Pressable
            onPress={openDrawer}
            accessibilityLabel="Open menu"
            hitSlop={12}
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              backgroundColor: t.surface,
              borderWidth: 1,
              borderColor: t.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <Path d="M3 7h18M3 12h18M3 17h14" stroke={t.text} strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
          </Pressable>
        ) : null}

        <View style={{ flex: 1, minWidth: 0 }}>
          {title ? (
            <Text
              numberOfLines={1}
              style={{
                fontFamily: t.serif,
                fontSize: 16,
                fontWeight: '500',
                color: t.text,
                letterSpacing: -0.4,
              }}
            >
              {title}
            </Text>
          ) : null}
        </View>

        {rightIcon ? (
          <Pressable
            onPress={onRightPress ?? (() => router.back())}
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name={rightIcon} size={22} color={t.text2} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
