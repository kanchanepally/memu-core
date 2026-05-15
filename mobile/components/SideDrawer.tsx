import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
import { loadAuthState } from '../lib/auth';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(300, SCREEN_WIDTH * 0.82);
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 56;

type Destination = {
  label: string;
  iconName: keyof typeof Ionicons.glyphMap;
  path: string;
};

// Primary nav — the surfaces the user opens daily.
//
// Phase A.7 — icons swapped from Ionicons-outline/solid pairs to Lucide.
// Lucide's stroke calibration reads cleaner at 18px than Ionicons-outline
// (which were drawn for 24px display); active state no longer relies on
// outline → solid morph but on colour + a left rule (see styles.rowActive
// below).
//
// Phase A.4 — 'Dashboard' (was 'Today') is the power-user structured view:
// full calendar strip, all open commitments, raw stream feed. The default
// landing is Chat (chat-first per the Canvas brief), so Dashboard sits as
// the last primary item — discoverable for users who want the structured
// overview, not the daily default.
//
// The underlying route is still /(tabs)/today.tsx — the screen wasn't
// reworked, only its semantic position changed.
const PRIMARY: Destination[] = [
  { label: 'Chat', iconName: 'chatbubble-outline', path: '/(tabs)/chat' },
  { label: 'Spaces', iconName: 'layers-outline', path: '/(tabs)/spaces' },
  { label: 'Calendar', iconName: 'calendar-outline', path: '/(tabs)/calendar' },
  { label: 'Lists', iconName: 'list-outline', path: '/(tabs)/lists' },
  { label: 'Dashboard', iconName: 'grid-outline', path: '/(tabs)/today' },
];

// Phase A.8 — Settings retired from inline nav. The account pill at the
// bottom of the drawer (see renderAccountPill) is now the entry point.

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
  const [displayName, setDisplayName] = useState<string | null>(null);

  const reloadConversations = useCallback(async () => {
    const { data } = await listConversations();
    if (data?.conversations) setConversations(data.conversations);
  }, []);

  // Phase A.8 — populate the account pill at the bottom of the drawer.
  // Reads from SecureStore/web storage on every open so a name change in
  // Settings reflects on the next drawer open without a full reload.
  const loadDisplayName = useCallback(async () => {
    const auth = await loadAuthState();
    setDisplayName(auth.displayName);
  }, []);

  useEffect(() => {
    if (open) {
      reloadConversations();
      loadDisplayName();
    }
  }, [open, reloadConversations, loadDisplayName]);

  const avatarInitial = useMemo(() => {
    const trimmed = (displayName || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  }, [displayName]);

  const isSettingsActive = pathname === '/(tabs)/settings' || pathname === '/settings';
  const openSettings = useCallback(() => {
    hide();
    setTimeout(() => router.push('/(tabs)/settings' as any), 120);
  }, [hide, router]);

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
          name={dest.iconName}
          size={18}
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

          {/* Phase A.8 — primary nav only (Settings retired from this
              region). Fixed height; never scrolls regardless of how many
              conversations accumulate. */}
          <View style={styles.navRegion}>
            <View style={styles.section}>
              {PRIMARY.map(renderNavRow)}
            </View>
          </View>

          {/* Conversations promoted directly under primary nav. Section
              label + pinned New chat button + FlatList that takes the
              remaining height and scrolls on its own. */}
          <View style={styles.conversationsRegion}>
            <View style={styles.conversationsHeader}>
              <Text style={styles.conversationsLabel}>Conversations</Text>
              <Pressable
                onPress={startNewConversation}
                style={({ pressed }) => [styles.newChatBtn, pressed && styles.rowPressed]}
                accessibilityLabel="Start new chat"
              >
                <Ionicons name="add" size={14} color={colors.primary} />
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

          {/* Account pill — pinned at bottom. Avatar (initial) + display
              name + small gear hint. Whole pill is the tap target →
              Settings. Subtle top divider separates it from the
              scrolling conversation list above. */}
          <Pressable
            onPress={openSettings}
            style={({ pressed }) => [
              styles.accountPill,
              isSettingsActive && styles.accountPillActive,
              pressed && styles.rowPressed,
            ]}
            accessibilityLabel="Open settings"
          >
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>{avatarInitial}</Text>
            </View>
            <View style={styles.accountMeta}>
              <Text style={styles.accountName} numberOfLines={1}>
                {displayName || 'Account'}
              </Text>
              <Text style={styles.accountHint}>Settings</Text>
            </View>
            <Ionicons
              name="settings-outline"
              size={14}
              color={colors.onSurfaceVariant}
            />
          </Pressable>
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
  section: { gap: 1 },
  // Phase A.7 — nav rail is chrome, not content.
  // - 13px / 400 at rest, 600 active (was body / bold-active)
  // - Active state is a 3px left rule + indigo text (was filled
  //   grey slab). Same gesture as the PWA — the rail is a persistent
  //   spatial anchor; active item is legible without a competing fill.
  // - Inset by 3px on inactive rows so the text doesn't shift left
  //   when the rule appears on active.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  rowActive: {
    backgroundColor: 'transparent',
    borderLeftColor: colors.primary,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowLabel: {
    fontSize: 13,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.1,
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

  // ---- Phase A.8 — account pill at the bottom of the drawer ----
  // Avatar + display name + small gear hint. Whole pill is the tap
  // target → Settings. Mirrors the PWA .sidebar-account-pill rules.
  accountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: spacing.sm,
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  accountPillActive: {
    borderLeftColor: colors.primary,
    backgroundColor: colors.surfaceContainerLow,
  },
  accountAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.tertiaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountAvatarText: {
    fontSize: 13,
    fontFamily: typography.families.bodyBold,
    color: colors.tertiary,
    lineHeight: 16,
  },
  accountMeta: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    fontSize: 13,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    lineHeight: 16,
  },
  accountHint: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    letterSpacing: typography.tracking.wide,
    textTransform: 'uppercase',
    marginTop: 1,
  },
});

