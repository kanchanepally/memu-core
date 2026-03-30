import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTodayBrief, resolveCard, type StreamCard } from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';

export default function ListsScreen() {
  const [items, setItems] = useState<StreamCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newItem, setNewItem] = useState('');

  const loadItems = useCallback(async () => {
    const { data } = await getTodayBrief();
    if (data) {
      setItems(data.shoppingItems);
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
    setItems(prev => prev.filter(i => i.id !== cardId));
  }, []);

  return (
    <View style={styles.container}>
      {/* Add item input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Add to shopping list..."
          placeholderTextColor={colors.textMuted}
          value={newItem}
          onChangeText={setNewItem}
          onSubmitEditing={() => {
            // TODO: POST to add shopping item via chat pipeline
            setNewItem('');
          }}
          returnKeyType="done"
        />
        <Pressable style={styles.addButton}>
          <Ionicons name="add" size={22} color={colors.textInverse} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="cart-outline" size={48} color={colors.border} />
            <Text style={styles.emptyText}>The list is clear. Nice work.</Text>
          </View>
        ) : (
          items.map(item => (
            <Pressable key={item.id} style={styles.item} onPress={() => handleCheck(item.id)}>
              <View style={styles.checkbox}>
                <Ionicons name="square-outline" size={22} color={colors.textMuted} />
              </View>
              <View style={styles.itemContent}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.body ? <Text style={styles.itemBody}>{item.body}</Text> : null}
              </View>
              <Text style={styles.itemSource}>{item.source.replace('_', ' ')}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  input: {
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: typography.sizes.body, color: colors.text,
  },
  addButton: {
    backgroundColor: colors.accent, borderRadius: radius.pill,
    width: 40, height: 40, justifyContent: 'center', alignItems: 'center',
  },

  empty: { alignItems: 'center', paddingVertical: spacing.xl * 2, gap: spacing.md },
  emptyText: { color: colors.textMuted, fontSize: typography.sizes.body },

  item: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm, ...shadows.sm,
  },
  checkbox: { width: 28 },
  itemContent: { flex: 1 },
  itemTitle: { fontSize: typography.sizes.body, color: colors.text },
  itemBody: { fontSize: typography.sizes.sm, color: colors.textMuted, marginTop: 2 },
  itemSource: { fontSize: typography.sizes.xs, color: colors.textMuted },
});
