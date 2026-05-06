import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useDrawer } from '../lib/drawer';
import { colors, spacing, radius, typography } from '../lib/tokens';
import { LogoMark } from './Logo';
import { listConversations, type ConversationSummary } from '../lib/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(300, SCREEN_WIDTH * 0.82);
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 56;

type Destination = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconActive: React.ComponentProps<typeof Ionicons>['name'];
  path: string;
};

const PRIMARY: Destination[] = [
  { label: 'Chat', icon: 'chatbubble-outline', iconActive: 'chatbubble', path: '/(tabs)/chat' },
  { label: 'Today', icon: 'sunny-outline', iconActive: 'sunny', path: '/(tabs)/today' },
  { label: 'Spaces', icon: 'albums-outline', iconActive: 'albums', path: '/(tabs)/spaces' },
  { label: 'Calendar', icon: 'calendar-outline', iconActive: 'calendar', path: '/(tabs)/calendar' },
  { label: 'Lists', icon: 'list-outline', iconActive: 'list', path: '/(tabs)/lists' },
];

const SECONDARY: Destination[] = [
  { label: 'Settings', icon: 'settings-outline', iconActive: 'settings', path: '/(tabs)/settings' },
];

function isChatActive(pathname: string): boolean {
  return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/chat' || pathname === '/chat';
}

function isActive(pathname: string, dest: Destination) {
  if (dest.path === '/(tabs)/chat') return isChatActive(pathname);
  return pathname === dest.path || pathname === dest.path.replace('/(tabs)', '');
}

function formatConvDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function SideDrawer() {
  const { open, hide } = useDrawer();
  const router = useRouter();
  const pathname = usePathname();

  const translate = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlay = useRef(new Animated.Value(0)).current;

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  // Refresh conversations whenever the drawer opens AND we're in the Chat
  // section. No point keeping a polled list when the drawer is closed.
  const reloadConversations = useCallback(async () => {
    const { data } = await listConversations();
    if (data?.conversations) setConversations(data.conversations);
  }, []);

  useEffect(() => {
    if (open && isChatActive(pathname)) reloadConversations();
  }, [open, pathname, reloadConversations]);

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

  const openConversation = useCallback((conversationId: string) => {
    hide();
    setTimeout(() => router.push(`/(tabs)/chat?conversationId=${conversationId}` as any), 120);
  }, [hide, router]);

  const startNewConversation = useCallback(() => {
    hide();
    setTimeout(() => router.push('/(tabs)/chat?new=1' as any), 120);
  }, [hide, router]);

  const chatActive = isChatActive(pathname);

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

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <View style={styles.section}>
              {PRIMARY.map(dest => {
                const active = isActive(pathname, dest);
                const isChatRow = dest.path === '/(tabs)/chat';
                return (
                  <React.Fragment key={dest.path}>
                    <Pressable
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

                    {/* Conversations nested under Chat — only visible when
                        Chat is the active section. New chat button at top,
                        scrollable conversations list below. */}
                    {isChatRow && chatActive ? (
                      <View style={styles.chatChildren}>
                        <Pressable
                          onPress={startNewConversation}
                          style={({ pressed }) => [styles.newChatRow, pressed && styles.rowPressed]}
                        >
                          <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                          <Text style={styles.newChatLabel}>New chat</Text>
                        </Pressable>
                        {conversations.length === 0 ? (
                          <Text style={styles.emptyConversations}>No conversations yet.</Text>
                        ) : (
                          conversations.slice(0, 30).map(c => (
                            <Pressable
                              key={c.id}
                              onPress={() => openConversation(c.id)}
                              style={({ pressed }) => [styles.conversationRow, pressed && styles.rowPressed]}
                            >
                              <Text style={styles.conversationTitle} numberOfLines={1}>
                                {c.title || 'New conversation'}
                              </Text>
                              <Text style={styles.conversationDate}>
                                {formatConvDate(c.lastMessageAt || c.startedAt)}
                              </Text>
                            </Pressable>
                          ))
                        )}
                      </View>
                    ) : null}
                  </React.Fragment>
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
          </ScrollView>
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.lg },
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

  // ---- Conversations nested under Chat ----
  chatChildren: {
    marginLeft: spacing.lg,
    paddingLeft: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.surfaceVariant,
    marginBottom: spacing.sm,
    gap: 2,
  },
  newChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  newChatLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
  },
  conversationRow: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  conversationTitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  conversationDate: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.outline,
    marginTop: 2,
  },
  emptyConversations: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
  },
});
