import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from '../lib/theme';

/**
 * ThemeToggle — a settings row (not just a button) for mobile.
 *
 * Drop into your settings screen:
 *
 *   import { ThemeToggle } from '../../components/ThemeToggle';
 *   <ThemeToggle />
 */
export function ThemeToggle() {
  const { tokens: t, mode, setMode } = useTheme();
  const options: Array<{ value: 'system' | 'light' | 'dark'; label: string; icon: string }> = [
    { value: 'system', label: 'Auto', icon: '◐' },
    { value: 'light', label: 'Light', icon: '☀' },
    { value: 'dark', label: 'Dark', icon: '☾' },
  ];

  return (
    <View style={{
      backgroundColor: t.surface,
      borderWidth: 1, borderColor: t.border,
      borderRadius: 14,
      padding: 14,
    }}>
      <Text style={{
        fontSize: 10.5, fontWeight: '700', color: t.text3,
        letterSpacing: 1.5, marginBottom: 12,
      }}>
        APPEARANCE
      </Text>
      <View style={{
        flexDirection: 'row',
        backgroundColor: t.bg,
        borderRadius: 12,
        padding: 4,
        gap: 2,
      }}>
        {options.map(o => {
          const active = mode === o.value;
          return (
            <Pressable
              key={o.value}
              onPress={() => setMode(o.value)}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: 9,
                backgroundColor: active ? t.surface : 'transparent',
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Text style={{ fontSize: 14, color: active ? t.brand : t.text3 }}>
                {o.icon}
              </Text>
              <Text style={{
                fontSize: 12.5, fontWeight: '600',
                color: active ? t.text : t.text2,
              }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
