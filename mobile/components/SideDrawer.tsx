import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Dimensions,
  Pressable,
  FlatList,
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

// Primary nav — the surfaces the user opens daily.
//
// Phase A.4 — 'Dashboard' (was 'Today') is now positioned as the
// power-user structured view: full calendar strip, all open commitments,
// raw stream feed. The default landing is Chat (chat-first per the
// Canvas brief), so Dashboard sits as the second item — discoverable
// for users who want the structured overview, not the daily default.
//
// The underlying route is still /(tabs)/today.tsx — the screen wasn't
// reworked, only its semantic position changed. A.5's polymorphic chat
// renderer means most of what used to be on Today (briefings, action
// nudges) now also shows up inline in chat, so the Dashboard is
// genuinely a complementary view rather than the primary one.
const PRIMARY: Destination[] = [
  { label: 'Chat', icon: 'chatbubble-outline', iconActive: 'chatbubble', path: '/(tabs)/chat' },
  { label: 'Spaces', icon: 'albums-outline', iconActive: 'albums', path: '/(tabs)/spaces' },
  { label: 'Calendar', icon: 'calendar-outline', iconActive: 'calendar', path: '/(tabs)/calendar' },
  { label: 'Lists', icon: 'list-outline', iconActive: 'list', path: '/(tabs)/lists' },
  { label: 'Dashboard', icon: 'grid-outline', iconActive: 'grid', path: '/(tabs)/today' },
];

// Secondary nav — less-frequent surfaces. Settings sits under a divider so
// the eye groups it apart from the daily flow.
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

/**
 * Two-region drawer.
 *
 * Top region (fixed height): all primary nav + divider + secondary nav (Settings).
 * Always visible — no matter how many conversations accumulate.
 *
 * Bottom region (flex: 1, scrolls independently): "Conversations" label +
 * "New chat" button (pinned) + scrolling FlatList of conversations.
 *
 * Before this restructure the conversations rendered inline under the
 * Chat nav row in a single ScrollView, so 30+ threads pushed Settings
 * off-screen (visible in the 2026-05-12 screenshot). The split keeps menu
 * discoverable while giving conversation history its own scroll context.
 */
export default function SideDrawer() {
  const { open, hide } = useDrawer();
  const router = useRouter();
  const pathname = usePathname();

  const translate = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlay = useRef(new Animated.Value(0)).current;

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  const reloadConversations = useCallback(async () => {
    const { data } = await listConversations();
    if (data?.conversations) setConversations(data.conversations);
  }, []);

  useEffect(() => {
    if (open) reloadConversations();
  }, [open, reloadConversations]);

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

  const renderNavRow = (dest: Destination) => {
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
  };

  const renderConversation = useCallback(({ item }: { item: ConversationSummary }) => (
    <Pressable
      onPress={() => openConversation(item.id)}
      style={({ pressed }) => [styles.conversationRow, pressed && styles.rowPressed]}
    >
      <Text style={styles.conversationTitle} numberOfLines={1}>
        {item.title || 'New conversation'}
      </Text>
      <Text style={styles.conversationDate}>
        {formatConvDate(item.lastMessageAt || item.startedAt)}
      </Text>
    </Pressable>
  ), [openConversation]);

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={hide}>
      <View style={styles.root}>
        <Animated.View style={[styles.overlay, { opacity: overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={hide} />
        </Animated.View>

        <Animated.View style={[styles.drawer, { transform: [{ translateX: translate }] }]}>
          {/* Brand header — always at the top. */}
          <View style={styles.header}>
            <LogoMark size={36} />
            <Text style={styles.wordmark}>Memu</Text>
          </View>

          {/* Top region — primary + secondary nav. Fixed height; never
              scrolls regardless of how many conversations accumulate. */}
          <View style={styles.navRegion}>
            <View style={styles.section}>
              {PRIMARY.map(renderNavRow)}
            </View>
            <View style={styles.divider} />
            <View style={styles.section}>
              {SECONDARY.map(renderNavRow)}
            </View>
          </View>

          {/* Bottom region — conversations. Section label + pinned New
              chat button + FlatList that takes the remaining height and
              scrolls on its own. */}
          <View style={styles.conversationsRegion}>
            <View style={styles.conversationsHeader}>
              <Text style={styles.conversationsLabel}>Conversations</Text>
              <Pressable
                onPress={startNewConversation}
                style={({ pressed }) => [styles.newChatBtn, pressed && styles.rowPressed]}
                accessibilityLabel="Start new chat"
              >
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={styles.newChatLabel}>New</Text>
              </Pressable>
            </View>

            {conversations.length === 0 ? (
              <Text style={styles.emptyConversations}>No conversations yet.</Text>
            ) : (
              <FlatList
                data={conversations}
                keyExtractor={c => c.id}
                renderItem={renderConversation}
                style={styles.conversationsList}
                contentContainerStyle={styles.conversationsListContent}
                showsVerticalScrollIndicator={false}
              />
            )}
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
    // Layout: header + navRegion fixed at top, conversationsRegion fills
    // the remaining vertical space.
    display: 'flex',
    flexDirection: 'column',
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
  navRegion: {
    // Fixed natural height — no flex so it doesn't grow.
  },
  section: { gap: 2 },
  divider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    marginVertical: spacing.sm,
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

  // ---- Bottom region — independently-scrolling conversation history ----
  conversationsRegion: {
    flex: 1,
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    paddingTop: spacing.sm,
    minHeight: 0, // critical: lets FlatList shrink/scroll inside flex parent
  },
  conversationsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  conversationsLabel: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  newChatLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
  },
  conversationsList: {
    flex: 1,
  },
  conversationsListContent: {
    paddingBottom: spacing.lg,
  },
  conversationRow: {
    paddingVertical: 8,
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
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
  },
});
