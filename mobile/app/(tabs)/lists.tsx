import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  ActivityIndicator, Animated, Easing, Modal, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getLists,
  addListItemApi,
  completeListItemApi,
  updateListItemApi,
  deleteListItemApi,
  type ListItem as ListItemDto,
  type ListItemType,
} from '../../lib/api';
import { parseQuickInput } from '../../lib/listInputParser';
import { spacing, radius, motion } from '../../lib/tokens';
import { useTokens } from '../../lib/theme';
import type { Tokens } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import Masthead from '../../components/Masthead';
import GradientButton from '../../components/GradientButton';

type Tab = 'tasks' | 'shopping';

const sourceColor = (src: string | null | undefined, t: Tokens): string => {
  switch (src) {
    case 'chat': return t.brand;
    case 'calendar': return t.brand;
    case 'email': return t.amber;
    case 'document': return t.text2;
    default: return t.brandMuted;
  }
};

function splitInputItems(raw: string): string[] {
  const cleaned = raw
    .replace(/\s+and\s+/gi, ',')
    .replace(/\s*&\s*/g, ',')
    .replace(/\s+plus\s+/gi, ',');
  return cleaned
    .split(',')
    .map(s => s.trim().replace(/^(?:some|a|an|the)\s+/i, ''))
    .filter(s => s.length > 0 && s.length <= 120);
}

function titleCase(s: string): string {
  const body = s === s.toUpperCase() ? s.toLowerCase() : s;
  return body.charAt(0).toUpperCase() + body.slice(1);
}

// Format an ISO due_at as a friendly chip — "Today", "Tomorrow", "Fri", or
// "Mon 12 May" for items further out. Past-due items get an explicit
// negative-day count so the user knows they're behind.
function formatDueChip(iso: string | null): { label: string; tone: 'overdue' | 'today' | 'soon' | 'future' } | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday); startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const inSevenDays = new Date(startOfToday); inSevenDays.setDate(inSevenDays.getDate() + 7);

  if (due < startOfToday) {
    const days = Math.round((startOfToday.getTime() - due.getTime()) / (24 * 3600 * 1000));
    return { label: days === 1 ? 'Yesterday' : `${days}d overdue`, tone: 'overdue' };
  }
  if (due < startOfTomorrow) return { label: 'Today', tone: 'today' };
  const startOfDayAfter = new Date(startOfTomorrow); startOfDayAfter.setDate(startOfDayAfter.getDate() + 1);
  if (due < startOfDayAfter) return { label: 'Tomorrow', tone: 'soon' };
  if (due < inSevenDays) {
    return { label: due.toLocaleDateString([], { weekday: 'short' }), tone: 'soon' };
  }
  return {
    label: due.toLocaleDateString([], { day: 'numeric', month: 'short' }),
    tone: 'future',
  };
}

function dueChipStyle(tone: 'overdue' | 'today' | 'soon' | 'future', t: Tokens) {
  switch (tone) {
    case 'overdue':
      return { bg: t.redBg, fg: t.red };
    case 'today':
      return { bg: t.brand, fg: '#FFFFFF' };
    case 'soon':
      return { bg: t.brandSoft, fg: t.brand };
    case 'future':
    default:
      return { bg: t.surfaceAlt, fg: t.text2 };
  }
}

interface ListRowProps {
  item: ListItemDto;
  onCheck: (id: string) => void;
  onLongPress: (item: ListItemDto) => void;
}

function ListRow({ item, onCheck, onLongPress }: ListRowProps) {
  const t = useTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const checkScale = useRef(new Animated.Value(1)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;
  const [checked, setChecked] = useState(false);

  const handlePress = () => {
    if (checked) return;
    setChecked(true);
    Animated.sequence([
      Animated.spring(checkScale, { toValue: 1.15, useNativeDriver: true, speed: 40 }),
      Animated.spring(checkScale, { toValue: 1, useNativeDriver: true, speed: 30 }),
    ]).start();
    Animated.timing(rowOpacity, {
      toValue: 0,
      duration: motion.slow,
      easing: Easing.out(Easing.ease),
      delay: 220,
      useNativeDriver: true,
    }).start(() => onCheck(item.id));
  };

  const due = formatDueChip(item.due_at);
  const dueStyle = due ? dueChipStyle(due.tone, t) : null;

  return (
    <Animated.View style={{ opacity: rowOpacity }}>
      <Pressable
        style={styles.item}
        onPress={handlePress}
        onLongPress={() => onLongPress(item)}
        delayLongPress={350}
      >
        <Animated.View style={[styles.checkbox, checked && styles.checkboxChecked, { transform: [{ scale: checkScale }] }]}>
          {checked ? (
            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
          ) : null}
        </Animated.View>
        <View style={styles.itemContent}>
          <Text style={[styles.itemTitle, checked && styles.itemTitleChecked]}>{item.item_text}</Text>
          {item.note ? <Text style={styles.itemBody}>{item.note}</Text> : null}
          {(due || item.source) ? (
            <View style={styles.itemMetaRow}>
              {due && dueStyle ? (
                <View style={[styles.dueChip, { backgroundColor: dueStyle.bg }]}>
                  <Ionicons name="time-outline" size={11} color={dueStyle.fg} />
                  <Text style={[styles.dueChipLabel, { color: dueStyle.fg }]}>{due.label}</Text>
                </View>
              ) : null}
              {item.source ? (
                <View style={styles.sourcePill}>
                  <View style={[styles.sourceDot, { backgroundColor: sourceColor(item.source, t) }]} />
                  <Text style={styles.sourceLabel}>{item.source}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

interface EditModalState {
  open: boolean;
  item: ListItemDto | null;
}

interface EditModalProps {
  state: EditModalState;
  onClose: () => void;
  onSaved: (updated: ListItemDto) => void;
  onDeleted: (id: string) => void;
}

function EditModal({ state, onClose, onSaved, onDeleted }: EditModalProps) {
  const t = useTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [itemText, setItemText] = useState('');
  const [note, setNote] = useState('');
  const [listName, setListName] = useState('');
  const [dueText, setDueText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the modal opens for a new item.
  useEffect(() => {
    if (!state.open || !state.item) return;
    setItemText(state.item.item_text);
    setNote(state.item.note ?? '');
    setListName(state.item.list_name ?? '');
    // Render due_at as YYYY-MM-DD for the input. NULL → empty string.
    setDueText(state.item.due_at ? state.item.due_at.slice(0, 10) : '');
    setError(null);
    setSaving(false);
  }, [state.open, state.item]);

  if (!state.item) return null;

  const handleSave = async () => {
    if (!itemText.trim()) {
      setError('Item text is required.');
      return;
    }
    let dueAt: string | null = null;
    if (dueText.trim()) {
      const parsed = new Date(dueText.trim());
      if (Number.isNaN(parsed.getTime())) {
        setError('Date format not understood. Try YYYY-MM-DD.');
        return;
      }
      // Anchor to end of day local — matches the quick-input parser.
      parsed.setHours(23, 59, 0, 0);
      dueAt = parsed.toISOString();
    }
    setSaving(true);
    setError(null);
    const { data, error: err } = await updateListItemApi(state.item!.id, {
      itemText: itemText.trim(),
      note: note.trim() || null,
      listName: listName.trim() || null,
      dueAt,
    });
    setSaving(false);
    if (err || !data) {
      setError(err || 'Could not save.');
      return;
    }
    onSaved(data.item);
    onClose();
  };

  const handleDelete = async () => {
    setSaving(true);
    setError(null);
    const { error: err } = await deleteListItemApi(state.item!.id);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onDeleted(state.item!.id);
    onClose();
  };

  return (
    <Modal visible={state.open} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.modalScroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Edit item</Text>

            <Text style={styles.modalLabel}>Item</Text>
            <TextInput
              style={styles.modalInput}
              value={itemText}
              onChangeText={setItemText}
              placeholder="What is it?"
              placeholderTextColor={t.text3}
              autoCorrect
            />

            <Text style={styles.modalLabel}>Note</Text>
            <TextInput
              style={[styles.modalInput, styles.modalInputMultiline]}
              value={note}
              onChangeText={setNote}
              placeholder="Optional details"
              placeholderTextColor={t.text3}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.modalLabel}>Category (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={listName}
              onChangeText={setListName}
              placeholder="e.g. garden, work, kids"
              placeholderTextColor={t.text3}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.modalLabel}>Due date (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={dueText}
              onChangeText={setDueText}
              placeholder="YYYY-MM-DD or leave blank"
              placeholderTextColor={t.text3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />

            {error ? (
              <View style={styles.modalError}>
                <Ionicons name="alert-circle-outline" size={16} color={t.red} />
                <Text style={styles.modalErrorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <GradientButton label="Delete" variant="ghost" onPress={handleDelete} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <GradientButton label="Cancel" variant="ghost" onPress={onClose} />
                <GradientButton
                  label={saving ? 'Saving…' : 'Save'}
                  onPress={handleSave}
                  loading={saving}
                />
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Group items by list_name. Items with null list_name go into "Uncategorised"
// — but if every item is null, we render flat (no headers) so the page
// doesn't feel like it's making the user feel guilty for not categorising.
function groupItems(items: ListItemDto[]): { name: string | null; items: ListItemDto[] }[] {
  const map = new Map<string | null, ListItemDto[]>();
  for (const item of items) {
    const key = item.list_name && item.list_name.trim() ? item.list_name.trim() : null;
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  const named = [...map.entries()].filter(([k]) => k !== null) as [string, ListItemDto[]][];
  named.sort(([a], [b]) => a.localeCompare(b));
  const groups: { name: string | null; items: ListItemDto[] }[] = named.map(([name, items]) => ({ name, items }));
  if (map.has(null)) {
    groups.push({ name: null, items: map.get(null)! });
  }
  return groups;
}

export default function ListsScreen() {
  const t = useTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [tasks, setTasks] = useState<ListItemDto[]>([]);
  const [shoppingItems, setShoppingItems] = useState<ListItemDto[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('tasks');
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editModal, setEditModal] = useState<EditModalState>({ open: false, item: null });

  const loadItems = useCallback(async () => {
    const [tasksRes, shoppingRes] = await Promise.all([
      getLists({ listType: 'task', status: 'pending' }),
      getLists({ listType: 'shopping', status: 'pending' }),
    ]);

    if (tasksRes.error || shoppingRes.error) {
      const err = tasksRes.error || shoppingRes.error || 'Unknown error';
      setError(err);
    } else {
      setTasks(tasksRes.data?.items || []);
      setShoppingItems(shoppingRes.data?.items || []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadItems(); }, [loadItems]));
  useEffect(() => { loadItems(); }, [loadItems]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }, [loadItems]);

  const handleCheck = useCallback(async (id: string) => {
    await completeListItemApi(id);
    setTasks(prev => prev.filter(i => i.id !== id));
    setShoppingItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const handleSubmit = useCallback(async () => {
    const text = newItem.trim();
    if (!text) return;
    setIsProcessing(true);
    setNewItem('');
    const listType: ListItemType = activeTab === 'tasks' ? 'task' : 'shopping';
    // Each comma/and-separated part is parsed independently so each can carry
    // its own #category and "by Friday" markers.
    const parts = splitInputItems(text);
    for (const part of parts) {
      const parsed = parseQuickInput(part);
      const cleanText = titleCase(parsed.itemText);
      await addListItemApi(listType, cleanText, {
        listName: parsed.listName,
        dueAt: parsed.dueAt,
      });
    }
    await loadItems();
    setIsProcessing(false);
  }, [newItem, activeTab, loadItems]);

  const items = activeTab === 'tasks' ? tasks : shoppingItems;
  const otherCount = activeTab === 'tasks' ? shoppingItems.length : tasks.length;
  const groups = useMemo(() => groupItems(items), [items]);
  const showGroupHeaders = groups.some(g => g.name !== null);

  const toggleGroup = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleLongPress = (item: ListItemDto) => {
    setEditModal({ open: true, item });
  };

  const handleSaved = (updated: ListItemDto) => {
    if (updated.list_type === 'task') setTasks(prev => prev.map(i => i.id === updated.id ? updated : i));
    if (updated.list_type === 'shopping') setShoppingItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    // Re-sort after edit (due_at may have changed).
    loadItems();
  };

  const handleDeleted = (id: string) => {
    setTasks(prev => prev.filter(i => i.id !== id));
    setShoppingItems(prev => prev.filter(i => i.id !== id));
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Lists" statusLabel="Live" statusPulse />

      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        <Masthead
          eyebrow="What's on your plate"
          headline="Small tasks, gently carried."
          accent="gently"
        />

        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={t.red} />
            <Text style={styles.errorText}>Sync Error: {error}</Text>
          </View>
        ) : null}

        {/* Segmented control */}
        <View style={styles.segmentWrap}>
          <View style={styles.segment}>
            <Pressable
              style={[styles.segmentBtn, activeTab === 'tasks' && styles.segmentBtnActive]}
              onPress={() => setActiveTab('tasks')}
            >
              <Text style={[styles.segmentLabel, activeTab === 'tasks' && styles.segmentLabelActive]}>
                Tasks
              </Text>
              {tasks.length > 0 ? (
                <View style={[styles.countBadge, activeTab === 'tasks' && styles.countBadgeActive]}>
                  <Text style={[styles.countText, activeTab === 'tasks' && styles.countTextActive]}>
                    {tasks.length}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              style={[styles.segmentBtn, activeTab === 'shopping' && styles.segmentBtnActive]}
              onPress={() => setActiveTab('shopping')}
            >
              <Text style={[styles.segmentLabel, activeTab === 'shopping' && styles.segmentLabelActive]}>
                Shopping
              </Text>
              {shoppingItems.length > 0 ? (
                <View style={[styles.countBadge, activeTab === 'shopping' && styles.countBadgeActive]}>
                  <Text style={[styles.countText, activeTab === 'shopping' && styles.countTextActive]}>
                    {shoppingItems.length}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>

        {/* Add row */}
        <View style={styles.inputWrap}>
          <View style={styles.inputRow}>
            <Ionicons
              name={activeTab === 'tasks' ? 'add-circle-outline' : 'basket-outline'}
              size={18}
              color={t.text3}
            />
            <TextInput
              style={styles.input}
              placeholder={activeTab === 'tasks' ? 'Add a task… try "call HMRC by Friday #work"' : 'Add groceries… "milk, eggs #weekly"'}
              placeholderTextColor={t.text3}
              value={newItem}
              onChangeText={setNewItem}
              onSubmitEditing={handleSubmit}
              returnKeyType="done"
              editable={!isProcessing}
            />
            <Pressable
              style={({ pressed }) => [
                styles.submitBtn,
                (!newItem.trim() || isProcessing) && styles.submitDisabled,
                pressed && { transform: [{ scale: 0.95 }] },
              ]}
              onPress={handleSubmit}
              disabled={!newItem.trim() || isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="arrow-up" size={16} color="#FFFFFF" />
              )}
            </Pressable>
          </View>
          <Text style={styles.inputHint}>
            Tap an item to mark done. Long-press to edit, set a category, or change the due date.
          </Text>
        </View>

        {/* List */}
        <View style={styles.listSection}>
          {loading ? (
            <View style={styles.skeletonWrap}>
              {[0, 1, 2].map(i => (
                <View key={i} style={styles.skeletonRow} />
              ))}
            </View>
          ) : items.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <View style={styles.emptyGlow} />
                <Ionicons
                  name={activeTab === 'tasks' ? 'checkmark-done-outline' : 'basket-outline'}
                  size={28}
                  color={t.brand}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {activeTab === 'tasks' ? 'Nothing on your plate.' : 'The basket is empty.'}
              </Text>
              <Text style={styles.emptyHint}>
                {otherCount > 0
                  ? `${otherCount} waiting under ${activeTab === 'tasks' ? 'Shopping' : 'Tasks'}.`
                  : 'Drop it in above, or just tell Memu in chat.'}
              </Text>
            </View>
          ) : (
            groups.map(group => {
              const key = group.name ?? '__uncategorised__';
              const isCollapsed = collapsed[key] === true;
              return (
                <View key={key} style={styles.groupBlock}>
                  {showGroupHeaders ? (
                    <Pressable style={styles.groupHeader} onPress={() => toggleGroup(key)}>
                      <Ionicons
                        name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
                        size={14}
                        color={t.text2}
                      />
                      <Text style={styles.groupHeaderLabel}>
                        {group.name ?? 'Uncategorised'}
                      </Text>
                      <View style={styles.groupHeaderCount}>
                        <Text style={styles.groupHeaderCountText}>{group.items.length}</Text>
                      </View>
                    </Pressable>
                  ) : null}
                  {!isCollapsed
                    ? group.items.map(item => (
                        <ListRow
                          key={item.id}
                          item={item}
                          onCheck={handleCheck}
                          onLongPress={handleLongPress}
                        />
                      ))
                    : null}
                </View>
              );
            })
          )}
        </View>
      </ScreenContainer>

      <EditModal
        state={editModal}
        onClose={() => setEditModal({ open: false, item: null })}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </View>
  );
}

function makeStyles(t: Tokens) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  segmentWrap: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    padding: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  segmentBtnActive: {
    backgroundColor: t.brand,
  },
  segmentLabel: {
    fontSize: 13,
    fontFamily: t.ui,
    color: t.text2,
    letterSpacing: 0.5,
  },
  segmentLabelActive: {
    color: '#FFFFFF',
    fontFamily: t.uiBold,
  },
  countBadge: {
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  countText: {
    fontSize: 10,
    fontFamily: t.mono,
    color: t.text2,
  },
  countTextActive: {
    color: '#FFFFFF',
  },

  inputWrap: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: t.uiRegular,
    color: t.text,
    paddingVertical: 10,
  },
  submitBtn: {
    backgroundColor: t.brand,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: {
    opacity: 0.35,
  },
  inputHint: {
    fontSize: 11,
    fontFamily: t.serifItalic,
    color: t.text3,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  listSection: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
  },

  groupBlock: {
    marginBottom: spacing.md,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  groupHeaderLabel: {
    fontSize: 11,
    fontFamily: t.mono,
    color: t.brand,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    flex: 1,
  },
  groupHeaderCount: {
    backgroundColor: t.brandSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    minWidth: 22,
    alignItems: 'center',
  },
  groupHeaderCountText: {
    fontSize: 10,
    fontFamily: t.mono,
    color: t.brand,
  },

  skeletonWrap: { gap: spacing.sm },
  skeletonRow: {
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: t.surfaceAlt,
    opacity: 0.6,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.sm + 2,
  },
  emptyIconWrap: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyGlow: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: t.brandSoft,
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: 22,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
  },
  emptyHint: {
    fontSize: 13,
    fontFamily: t.serifItalic,
    color: t.text2,
    textAlign: 'center',
    lineHeight: 20,
  },

  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: t.brand,
    borderColor: t.brand,
  },
  itemContent: {
    flex: 1,
    gap: spacing.xs,
  },
  itemTitle: {
    fontSize: 15,
    fontFamily: t.serif,
    color: t.text,
    lineHeight: 20,
  },
  itemTitleChecked: {
    color: t.text3,
    textDecorationLine: 'line-through',
  },
  itemBody: {
    fontSize: 13,
    fontFamily: t.uiRegular,
    color: t.text2,
    lineHeight: 18,
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  dueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  dueChipLabel: {
    fontSize: 10,
    fontFamily: t.mono,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: t.brandSoft,
    borderRadius: radius.pill,
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sourceLabel: {
    fontSize: 9,
    fontFamily: t.mono,
    color: t.brand,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: t.redBg,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.red,
  },
  errorText: {
    fontSize: 13,
    fontFamily: t.ui,
    color: t.red,
    flex: 1,
  },

  // Edit modal
  modalOverlay: {
    flex: 1,
    backgroundColor: t.scrim,
    justifyContent: 'flex-end',
  },
  modalScroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: t.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing['2xl'],
    borderWidth: 1,
    borderColor: t.border,
  },
  modalHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.text3,
    alignSelf: 'center',
    marginBottom: spacing.md,
    opacity: 0.5,
  },
  modalTitle: {
    fontSize: 22,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
    marginBottom: spacing.lg,
  },
  modalLabel: {
    fontSize: 11,
    fontFamily: t.mono,
    color: t.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  modalInput: {
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
    fontSize: 15,
    fontFamily: t.uiRegular,
    color: t.text,
  },
  modalInputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  modalError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: t.redBg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    marginTop: spacing.md,
  },
  modalErrorText: {
    color: t.red,
    fontSize: 13,
    fontFamily: t.uiRegular,
    flex: 1,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  });
}
