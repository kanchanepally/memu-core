import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  ActivityIndicator, Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTodayBrief, resolveCard, extractListCommand, type StreamCard } from '../../lib/api';
import { colors, spacing, radius, typography, shadows, motion } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import Masthead from '../../components/Masthead';

type Tab = 'tasks' | 'shopping';

const sourceColor = (src?: string) => {
  switch (src) {
    case 'chat': return colors.sourceChat;
    case 'calendar': return colors.sourceCalendar;
    case 'email': return colors.sourceEmail;
    case 'document': return colors.sourceDocument;
    default: return colors.sourceManual;
  }
};

function ListItem({ item, onCheck }: { item: StreamCard; onCheck: (id: string) => void }) {
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

  return (
    <Animated.View style={{ opacity: rowOpacity }}>
      <Pressable style={styles.item} onPress={handlePress}>
        <Animated.View style={[styles.checkbox, checked && styles.checkboxChecked, { transform: [{ scale: checkScale }] }]}>
          {checked ? (
            <Ionicons name="checkmark" size={16} color={colors.onPrimary} />
          ) : null}
        </Animated.View>
        <View style={styles.itemContent}>
          <Text style={[styles.itemTitle, checked && styles.itemTitleChecked]}>{item.title}</Text>
          {item.body ? <Text style={styles.itemBody}>{item.body}</Text> : null}
          {item.source ? (
            <View style={styles.sourcePill}>
              <View style={[styles.sourceDot, { backgroundColor: sourceColor(item.source) }]} />
              <Text style={styles.sourceLabel}>{item.source}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function ListsScreen() {
  const [tasks, setTasks] = useState<StreamCard[]>([]);
  const [shoppingItems, setShoppingItems] = useState<StreamCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('tasks');

  const loadItems = useCallback(async () => {
    const { data } = await getTodayBrief();
    if (data) {
      setTasks(data.streamCards || []);
      setShoppingItems(data.shoppingItems || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }, [loadItems]);

  const handleCheck = useCallback(async (cardId: string) => {
    await resolveCard(cardId);
    setTasks(prev => prev.filter(i => i.id !== cardId));
    setShoppingItems(prev => prev.filter(i => i.id !== cardId));
  }, []);

  const handleSubmit = useCallback(async () => {
    const text = newItem.trim();
    if (!text) return;
    setIsProcessing(true);
    setNewItem('');
    await extractListCommand(text);
    setTimeout(async () => {
      await loadItems();
      setIsProcessing(false);
    }, 1500);
  }, [newItem, loadItems]);

  const items = activeTab === 'tasks' ? tasks : shoppingItems;
  const otherCount = activeTab === 'tasks' ? shoppingItems.length : tasks.length;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Lists" statusLabel="Live" statusPulse />

      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        <Masthead
          eyebrow="What's on your plate"
          headline="Small tasks, gently carried."
          accent="gently"
        />

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
              color={colors.outline}
            />
            <TextInput
              style={styles.input}
              placeholder={activeTab === 'tasks' ? 'Add a task… or just describe it' : 'Add groceries…'}
              placeholderTextColor={colors.outline}
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
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Ionicons name="arrow-up" size={16} color={colors.onPrimary} />
              )}
            </Pressable>
          </View>
          <Text style={styles.inputHint}>
            Memu parses natural language — "buy milk and eggs" becomes two items.
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
                  color={colors.tertiary}
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
            items.map(item => (
              <ListItem key={item.id} item={item} onCheck={handleCheck} />
            ))
          )}
        </View>
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },

  segmentWrap: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerLow,
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
    backgroundColor: colors.surfaceContainerLowest,
    ...shadows.low,
  },
  segmentLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurfaceVariant,
    letterSpacing: typography.tracking.wide,
  },
  segmentLabelActive: {
    color: colors.onSurface,
    fontFamily: typography.families.bodyBold,
  },
  countBadge: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.pill,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeActive: {
    backgroundColor: colors.primaryContainer,
  },
  countText: {
    fontSize: 10,
    fontFamily: typography.families.bodyBold,
    color: colors.onSurfaceVariant,
  },
  countTextActive: {
    color: colors.onPrimaryContainer,
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
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.pill,
    ...shadows.low,
  },
  input: {
    flex: 1,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    paddingVertical: 10,
  },
  submitBtn: {
    backgroundColor: colors.primary,
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
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  listSection: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
  },

  skeletonWrap: {
    gap: spacing.sm,
  },
  skeletonRow: {
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainerLow,
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
    backgroundColor: colors.tertiaryContainer,
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  emptyHint: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },

  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.low,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  itemContent: {
    flex: 1,
    gap: spacing.xs,
  },
  itemTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    lineHeight: 20,
  },
  itemTitleChecked: {
    color: colors.onSurfaceVariant,
    textDecorationLine: 'line-through',
  },
  itemBody: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  sourcePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sourceLabel: {
    fontSize: 9,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
});
