/**
 * Memu Mobile — v3 header chrome.
 *
 * Hamburger + screen title + optional right slot (avatar / status pill).
 * Hamburger calls onMenuOpen which should drive the existing DrawerContext
 * (lib/drawer.tsx).
 *
 * Usage:
 *
 *   const { show } = useDrawer();
 *   <MobileHeader
 *     eyebrow="SPACES · 47"
 *     title="What Memu knows"
 *     accent
 *     onMenuOpen={show}
 *   />
 */

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTokens } from '../lib/theme';
import Svg, { Path } from 'react-native-svg';

interface HeaderProps {
  eyebrow?: string;
  title?: string;
  accent?: boolean;  // italic serif title
  onMenuOpen: () => void;
  rightSlot?: React.ReactNode;
}

export function MobileHeader({ eyebrow, title, accent, onMenuOpen, rightSlot }: HeaderProps) {
  const t = useTokens();
  return (
    <View style={{
      paddingHorizontal: 18, paddingVertical: 14,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: t.bg,
    }}>
      <Pressable onPress={onMenuOpen} style={{
        width: 36, height: 36, borderRadius: 9,
        backgroundColor: t.surface,
        borderWidth: 1, borderColor: t.border,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <Path d="M3 7h18M3 12h18M3 17h14" stroke={t.text} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
      </Pressable>

      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <Text style={{
            fontSize: 10, fontWeight: '700',
            color: t.text3, letterSpacing: 1.5,
          }}>{eyebrow}</Text>
        )}
        {title && (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: accent ? t.serifItalic : t.serif,
              fontSize: 16, fontWeight: '500',
              color: t.text, letterSpacing: -0.4,
              marginTop: eyebrow ? 1 : 0,
            }}
          >{title}</Text>
        )}
      </View>

      {rightSlot}
    </View>
  );
}

/**
 * Common right-slot variants
 */
export function AccountAvatar({ initial = 'H' }: { initial?: string }) {
  const t = useTokens();
  return (
    <View style={{
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: t.brand,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontFamily: t.serifItalic, fontSize: 14, fontWeight: '700', color: 'white' }}>{initial}</Text>
    </View>
  );
}

export function AnonymisedPill() {
  const t = useTokens();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100,
      backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
    }}>
      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.green }} />
      <Text style={{ fontSize: 10, fontWeight: '600', color: t.text2, letterSpacing: 0.4 }}>Anonymised</Text>
    </View>
  );
}
