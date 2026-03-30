import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  getTodayBrief, resolveCard, dismissCard, editCard, addToCalendar, cardToShopping,
  type BriefEvent, type StreamCard,
} from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';

function formatTime(isoString: string | null): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function getSourceColor(source: string): string {
  const map: Record<string, string> = {
    whatsapp_group: colors.sourceChat,
    calendar: colors.sourceCalendar,
    email: colors.sourceEmail,
    document: colors.sourceDocument,
    manual: colors.sourceManual,
    proactive: colors.accent,
  };
  return map[source] || colors.sourceManual;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export default function TodayScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<BriefEvent[]>([]);
  const [cards, setCards] = useState<StreamCard[]>([]);
  const [shoppingCount, setShoppingCount] = useState(0);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBrief = useCallback(async () => {
    const { data, error: err } = await getTodayBrief();
    if (err) {
      setError(err);
    } else if (data) {
      setEvents(data.events);
      setCards(data.streamCards);
      setShoppingCount(data.shoppingItems.length);
      setCalendarConnected(data.isCalendarConnected);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadBrief();
  }, [loadBrief]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBrief();
    setRefreshing(false);
  }, [loadBrief]);

  // Edit modal state
  const [editingCard, setEditingCard] = useState<StreamCard | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);

  const handleResolve = useCallback(async (cardId: string) => {
    await resolveCard(cardId);
    setCards(prev => prev.filter(c => c.id !== cardId));
  }, []);

  const handleDismiss = useCallback(async (cardId: string) => {
    await dismissCard(cardId);
    setCards(prev => prev.filter(c => c.id !== cardId));
  }, []);

  const handleAddToCalendar = useCallback(async (cardId: string) => {
    const { error: err } = await addToCalendar(cardId);
    if (!err) {
      setCards(prev => prev.filter(c => c.id !== cardId));
    }
  }, []);

  const handleAddToShopping = useCallback(async (cardId: string) => {
    const { error: err } = await cardToShopping(cardId);
    if (!err) {
      setCards(prev => prev.filter(c => c.id !== cardId));
    }
  }, []);

  const openEdit = useCallback((card: StreamCard) => {
    setEditingCard(card);
    setEditTitle(card.title);
    setEditBody(card.body);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingCard) return;
    setSaving(true);
    const { data } = await editCard(editingCard.id, editTitle.trim(), editBody.trim());
    setSaving(false);
    if (data?.card) {
      setCards(prev => prev.map(c => c.id === editingCard.id
        ? { ...c, title: editTitle.trim(), body: editBody.trim() }
        : c
      ));
    }
    setEditingCard(null);
  }, [editingCard, editTitle, editBody]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading your day...</Text>
      </View>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.date}>{formatDate()}</Text>
      </View>

      {/* Connection status */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.error} />
          <Text style={styles.errorText}>Can't reach Memu. Check your connection.</Text>
        </View>
      )}

      {/* Calendar */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.sectionTitle}>Today's Schedule</Text>
        </View>
        {!calendarConnected ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Calendar not connected yet.</Text>
            <Text style={styles.emptyHint}>Connect Google Calendar in Settings.</Text>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Nothing scheduled today.</Text>
          </View>
        ) : (
          events.map((event, i) => (
            <View key={i} style={styles.eventCard}>
              <View style={styles.eventTime}>
                <Text style={styles.eventTimeText}>{formatTime(event.startTime)}</Text>
              </View>
              <Text style={styles.eventTitle}>{event.title}</Text>
            </View>
          ))
        )}
      </View>

      {/* Stream Cards */}
      {cards.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="bulb-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.sectionTitle}>Intelligence</Text>
          </View>
          {cards.map(card => (
            <View
              key={card.id}
              style={[styles.streamCard, { borderLeftColor: getSourceColor(card.source) }]}
            >
              <View style={styles.streamCardHeader}>
                <Text style={styles.streamCardSource}>{card.source.replace('_', ' ')}</Text>
                <Text style={styles.streamCardType}>{card.card_type.replace('_', ' ')}</Text>
              </View>
              <Text style={styles.streamCardTitle}>{card.title}</Text>
              <Text style={styles.streamCardBody}>{card.body}</Text>

              {/* Action bar: contextual actions + confirm + edit + dismiss */}
              <View style={styles.streamCardActions}>
                {/* Contextual: calendar for events, shopping for extraction */}
                {card.card_type !== 'shopping' && (
                  <Pressable style={styles.actionButton} onPress={() => handleAddToCalendar(card.id)}>
                    <Ionicons name="calendar-outline" size={14} color={colors.accent} />
                    <Text style={styles.actionText}>Calendar</Text>
                  </Pressable>
                )}
                {card.card_type !== 'shopping' && (
                  <Pressable style={styles.actionButton} onPress={() => handleAddToShopping(card.id)}>
                    <Ionicons name="cart-outline" size={14} color={colors.accent} />
                    <Text style={styles.actionText}>List</Text>
                  </Pressable>
                )}

                {/* Core three: Edit, Confirm, Dismiss */}
                <Pressable style={styles.actionButton} onPress={() => openEdit(card)}>
                  <Ionicons name="create-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.actionText, { color: colors.textSecondary }]}>Edit</Text>
                </Pressable>
                <Pressable style={styles.actionButton} onPress={() => handleResolve(card.id)}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={colors.success} />
                  <Text style={[styles.actionText, { color: colors.success }]}>Done</Text>
                </Pressable>
                <Pressable style={styles.actionButton} onPress={() => handleDismiss(card.id)}>
                  <Ionicons name="close-circle-outline" size={14} color={colors.textMuted} />
                  <Text style={[styles.actionText, { color: colors.textMuted }]}>Dismiss</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Shopping summary */}
      {shoppingCount > 0 && (
        <Pressable style={styles.shoppingSummary} onPress={() => router.push('/(tabs)/lists')}>
          <Ionicons name="cart-outline" size={18} color={colors.accent} />
          <Text style={styles.shoppingText}>
            {shoppingCount} item{shoppingCount !== 1 ? 's' : ''} on the shopping list
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      )}

      {/* Privacy footer */}
      <Pressable style={styles.privacyFooter} onPress={() => router.push('/ledger')}>
        <Ionicons name="shield-checkmark-outline" size={14} color={colors.textMuted} />
        <Text style={styles.privacyText}>All queries anonymised via Digital Twin</Text>
        <Text style={styles.privacyLink}>See what Claude saw</Text>
      </Pressable>
    </ScrollView>

    {/* Edit Modal */}
    <Modal visible={!!editingCard} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Edit Card</Text>
          <Text style={styles.modalLabel}>Title</Text>
          <TextInput
            style={styles.modalInput}
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="Card title"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.modalLabel}>Details</Text>
          <TextInput
            style={[styles.modalInput, styles.modalInputMultiline]}
            value={editBody}
            onChangeText={setEditBody}
            placeholder="Card details"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
          />
          <View style={styles.modalActions}>
            <Pressable
              style={styles.modalCancelButton}
              onPress={() => setEditingCard(null)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.modalSaveButton, saving && { opacity: 0.6 }]}
              onPress={handleSaveEdit}
              disabled={saving}
            >
              <Text style={styles.modalSaveText}>{saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  loadingText: { color: colors.textMuted, fontSize: typography.sizes.body },

  header: { marginBottom: spacing.lg },
  greeting: { fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold, color: colors.text },
  date: { fontSize: typography.sizes.body, color: colors.textSecondary, marginTop: spacing.xs },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#fef2f2', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: '#fecaca',
  },
  errorText: { color: colors.error, fontSize: typography.sizes.sm },

  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },

  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  emptyText: { color: colors.textSecondary, fontSize: typography.sizes.body },
  emptyHint: { color: colors.textMuted, fontSize: typography.sizes.sm, marginTop: spacing.xs },

  eventCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm,
    ...shadows.sm,
  },
  eventTime: {
    backgroundColor: colors.accentLight, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  eventTimeText: { fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold, color: colors.accent },
  eventTitle: { fontSize: typography.sizes.body, color: colors.text, flex: 1 },

  streamCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4,
    marginBottom: spacing.sm, ...shadows.sm,
  },
  streamCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  streamCardSource: { fontSize: typography.sizes.xs, color: colors.textMuted, textTransform: 'capitalize' },
  streamCardType: { fontSize: typography.sizes.xs, color: colors.textMuted, textTransform: 'capitalize' },
  streamCardTitle: { fontSize: typography.sizes.body, fontWeight: typography.weights.semibold, color: colors.text, marginBottom: spacing.xs },
  streamCardBody: { fontSize: typography.sizes.sm, color: colors.textSecondary, lineHeight: 20 },
  streamCardActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actionText: { fontSize: typography.sizes.sm, color: colors.accent, fontWeight: typography.weights.medium },

  shoppingSummary: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg,
  },
  shoppingText: { flex: 1, fontSize: typography.sizes.body, color: colors.text },

  privacyFooter: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, justifyContent: 'center',
  },
  privacyText: { fontSize: typography.sizes.xs, color: colors.textMuted },
  privacyLink: { fontSize: typography.sizes.xs, color: colors.accent, fontWeight: typography.weights.medium },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    ...shadows.md,
  },
  modalTitle: {
    fontSize: typography.sizes.lg, fontWeight: typography.weights.bold, color: colors.text, marginBottom: spacing.md,
  },
  modalLabel: {
    fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colors.textSecondary, marginBottom: spacing.xs,
  },
  modalInput: {
    backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    fontSize: typography.sizes.body, color: colors.text, marginBottom: spacing.md,
  },
  modalInputMultiline: {
    minHeight: 100, textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm,
  },
  modalCancelButton: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  modalCancelText: {
    fontSize: typography.sizes.body, color: colors.textSecondary, fontWeight: typography.weights.medium,
  },
  modalSaveButton: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  modalSaveText: {
    fontSize: typography.sizes.body, color: '#fff', fontWeight: typography.weights.semibold,
  },
});
