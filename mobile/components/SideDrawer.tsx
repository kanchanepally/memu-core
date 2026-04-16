import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Dimensions,
  Pressable,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useDrawer } from '../lib/drawer';
import { colors, spacing, radius, typography } from '../lib/tokens';
import { LogoMark } from './Logo';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(300, SCREEN_WIDTH * 0.82);
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 56;

type Destination = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconActive: React.ComponentProps<typeof Ionicons>['name'];
  path: string;
};

const PRIMARY: Destination[] = [
  { label: 'Today', icon: 'sunny-outline', iconActive: 'sunny', path: '/(tabs)' },
  { label: 'Chat', icon: 'chatbubble-outline', iconActive: 'chatbubble', path: '/(tabs)/chat' },
  { label: 'Spaces', icon: 'albums-outline', iconActive: 'albums', path: '/(tabs)/spaces' },
  { label: 'Calendar', icon: 'calendar-outline', iconActive: 'calendar', path: '/(tabs)/calendar' },
  { label: 'Lists', icon: 'list-outline', iconActive: 'list', path: '/(tabs)/lists' },
];

const SECONDARY: Destination[] = [
  { label: 'Settings', icon: 'settings-outline', iconActive: 'settings', path: '/(tabs)/settings' },
];

function isActive(pathname: string, dest: Destination) {
  if (dest.path === '/(tabs)') return pathname === '/' || pathname === '/(tabs)';
  return pathname === dest.path || pathname === dest.path.replace('/(tabs)', '');
}

export default function SideDrawer() {
  const { open, hide } = useDrawer();
  const router = useRouter();
  const pathname = usePathname();

  const translate = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlay = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      Animated.parallel([
        Animated.timing(translate, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(overlay, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translate, { toValue: -DRAWER_WIDTH, duration: 180, useNativeDriver: true }),
        Animated.timing(overlay, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [open, translate, overlay]);

  const navigate = (path: string) => {
    hide();
    setTimeout(() => router.push(path as any), 120);
  };

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={hide}>
      <View style={styles.root}>
        <Animated.View style={[styles.overlay, { opacity: overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={hide} />
        </Animated.View>

        <Animated.View style={[styles.drawer, { transform: [{ translateX: translate }] }]}>
          <View style={styles.header}>
            <LogoMark size={36} />
            <Text style={styles.wordmark}>Memu</Text>
          </View>

          <View style={styles.section}>
            {PRIMARY.map(dest => {
              const active = isActive(pathname, dest);
              return (
                <Pressable
                  key={dest.path}
                  onPress={() => navigate(dest.path)}
                  style={({ pressed }) => [
                    styles.row,
                    active && styles.rowActive,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Ionicons
                    name={active ? dest.iconActive : dest.icon}
                    size={20}
                    color={active ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>
                    {dest.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.divider} />

          <View style={styles.section}>
            {SECONDARY.map(dest => {
              const active = isActive(pathname, dest);
              return (
                <Pressable
                  key={dest.path}
                  onPress={() => navigate(dest.path)}
                  style={({ pressed }) => [
                    styles.row,
                    active && styles.rowActive,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Ionicons
                    name={active ? dest.iconActive : dest.icon}
                    size={20}
                    color={active ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>
                    {dest.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,17,40,0.45)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.surface,
    paddingTop: TOP_PAD + spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.lg,
  },
  wordmark: {
    fontSize: typography.sizes.xl,
    color: colors.primary,
    fontFamily: typography.families.headline,
    letterSpacing: typography.tracking.tight,
  },
  section: { gap: 2 },
  divider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    marginVertical: spacing.md,
    marginHorizontal: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowActive: {
    backgroundColor: colors.surfaceVariant,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  rowLabelActive: {
    color: colors.primary,
    fontFamily: typography.families.bodyBold,
  },
});
