import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTodayBrief, resolveCard, extractListCommand, type StreamCard } from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';

export default function ListsScreen() {
  const [tasks, setTasks] = useState<StreamCard[]>([]);
  const [shoppingItems, setShoppingItems] = useState<StreamCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [newItem, setNewItem] = useState('');
  
  // Segment control state
  const [activeTab, setActiveTab] = useState<'tasks' | 'shopping'>('tasks');

  const loadItems = useCallback(async () => {
    const { data } = await getTodayBrief();
    if (data) {
      setTasks(data.streamCards);
      setShoppingItems(data.shoppingItems);
    }
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
    if (activeTab === 'tasks') {
      setTasks(prev => prev.filter(i => i.id !== cardId));
    } else {
      setShoppingItems(prev => prev.filter(i => i.id !== cardId));
    }
  }, [activeTab]);

  const handleSubmit = useCallback(async () => {
    if (!newItem.trim()) return;
    setIsProcessing(true);
    const content = newItem;
    setNewItem(''); // Optimistically clear input
    await extractListCommand(content);
    // Give AI a second before refreshing
    setTimeout(async () => {
      await loadItems();
      setIsProcessing(false);
    }, 1500);
  }, [newItem, loadItems]);

  const items = activeTab === 'tasks' ? tasks : shoppingItems;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Lists" />
      {/* Nori-inspired Segmented Control */}
      <View style={styles.tabContainer}>
        <Pressable 
          style={[styles.tabButton, activeTab === 'tasks' && styles.tabActive]} 
          onPress={() => setActiveTab('tasks')}
        >
          <Text style={[styles.tabText, activeTab === 'tasks' && styles.tabTextActive]}>Tasks</Text>
        </Pressable>
        <Pressable 
          style={[styles.tabButton, activeTab === 'shopping' && styles.tabActive]} 
          onPress={() => setActiveTab('shopping')}
        >
          <Text style={[styles.tabText, activeTab === 'shopping' && styles.tabTextActive]}>Shopping</Text>
        </Pressable>
      </View>

      {/* Add item input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={`Add to ${activeTab}...`}
          placeholderTextColor={colors.textMuted}
          value={newItem}
          onChangeText={setNewItem}
          onSubmitEditing={handleSubmit}
          returnKeyType="done"
          editable={!isProcessing}
        />
        <Pressable style={styles.addButton} onPress={handleSubmit} disabled={isProcessing}>
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Ionicons name="add" size={22} color={colors.textInverse} />
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name={activeTab === 'tasks' ? 'checkmark-done-circle-outline' : 'cart-outline'} size={48} color={colors.border} />
            <Text style={styles.emptyText}>All caught up. Nice work.</Text>
          </View>
        ) : (
          items.map(item => (
            <Pressable key={item.id} style={styles.item} onPress={() => handleCheck(item.id)}>
              <View style={styles.checkbox}>
                <Ionicons name="ellipse-outline" size={24} color={colors.textMuted} />
              </View>
              <View style={styles.itemContent}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.body ? <Text style={styles.itemBody}>{item.body}</Text> : null}
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHover,
  },
  tabActive: {
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  tabText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.weights.medium,
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: typography.weights.semibold,
  },

  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md,
  },
  input: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontSize: typography.sizes.body, color: colors.text,
    ...shadows.sm,
  },
  addButton: {
    backgroundColor: colors.accent, borderRadius: radius.pill,
    width: 44, height: 44, justifyContent: 'center', alignItems: 'center',
  },

  empty: { alignItems: 'center', paddingVertical: spacing.xl * 2, gap: spacing.md },
  emptyText: { color: colors.textMuted, fontSize: typography.sizes.body },

  item: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  checkbox: { width: 32, justifyContent: 'center' },
  itemContent: { flex: 1 },
  itemTitle: { fontSize: typography.sizes.body, color: colors.text, fontWeight: '500' },
  itemBody: { fontSize: typography.sizes.sm, color: colors.textMuted, marginTop: 4 },
});
