import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, Modal, KeyboardAvoidingView, Platform, TextInput, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { getSpaces, type SynthesisPage } from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';

export default function SpacesScreen() {
  const [spaces, setSpaces] = useState<SynthesisPage[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [selectedPage, setSelectedPage] = useState<SynthesisPage | null>(null);

  const loadSpaces = useCallback(async () => {
    const { data } = await getSpaces();
    if (data) {
      setSpaces(data.spaces);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSpaces();
    setRefreshing(false);
  }, [loadSpaces]);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'person': return 'person-outline';
      case 'routine': return 'time-outline';
      case 'household': return 'home-outline';
      case 'commitment': return 'calendar-number-outline';
      case 'document': return 'document-text-outline';
      default: return 'folder-outline';
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading Spaces...</Text>
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
        <Text style={styles.viewTitle}>Family Spaces</Text>
        <Text style={styles.viewSubtitle}>Living knowledge, compiled automatically.</Text>
        
        {spaces.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="albums-outline" size={48} color={colors.border} />
            <Text style={styles.emptyText}>No spaces exist yet.</Text>
            <Text style={styles.emptyHint}>Chat with Memu — it creates topics automatically over time.</Text>
          </View>
        )}

        <View style={styles.grid}>
          {spaces.map(page => (
            <Pressable key={page.id} style={styles.card} onPress={() => setSelectedPage(page)}>
              <View style={styles.cardHeader}>
                <Ionicons name={getCategoryIcon(page.category)} size={20} color={colors.accent} />
                <Text style={styles.categoryText}>{page.category}</Text>
              </View>
              <Text style={styles.cardTitle}>{page.title}</Text>
              <Text style={styles.cardPreview} numberOfLines={3}>{page.body_markdown}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* Detail Modal */}
      <Modal visible={!!selectedPage} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTop}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Ionicons name={getCategoryIcon(selectedPage?.category || '')} size={24} color={colors.accent} />
                  <Text style={styles.modalTitle}>{selectedPage?.title}</Text>
                </View>
                <Pressable onPress={() => setSelectedPage(null)}>
                  <Ionicons name="close-circle" size={28} color={colors.textMuted} />
                </Pressable>
              </View>
              {/* Action Bar */}
              <View style={styles.modalActions}>
                <Pressable style={styles.actionButton}>
                  <Ionicons name="create-outline" size={16} color={colors.accent} />
                  <Text style={styles.actionText}>Edit</Text>
                </Pressable>
                <Pressable 
                  style={styles.actionButton}
                  onPress={() => {
                    if (selectedPage) {
                      Share.share({
                        title: selectedPage.title,
                        message: selectedPage.body_markdown
                      });
                    }
                  }}
                >
                  <Ionicons name="share-outline" size={16} color={colors.accent} />
                  <Text style={styles.actionText}>Share</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView style={styles.modalScroll}>
              <Markdown style={markdownStyles}>
                {selectedPage?.body_markdown || ''}
              </Markdown>
            </ScrollView>
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
  
  viewTitle: { fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold, color: colors.text, marginBottom: spacing.xs },
  viewSubtitle: { fontSize: typography.sizes.body, color: colors.textSecondary, marginBottom: spacing.lg },

  empty: { alignItems: 'center', paddingVertical: spacing.xl * 2, gap: spacing.md },
  emptyText: { color: colors.text, fontSize: typography.sizes.body, fontWeight: '500' },
  emptyHint: { color: colors.textSecondary, fontSize: typography.sizes.sm, textAlign: 'center', paddingHorizontal: spacing.xl },

  grid: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  categoryText: { fontSize: typography.sizes.xs, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTitle: { fontSize: typography.sizes.lg, fontWeight: typography.weights.bold, color: colors.text, marginBottom: spacing.xs },
  cardPreview: { fontSize: typography.sizes.sm, color: colors.textSecondary, lineHeight: 20 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    height: '85%',
    padding: spacing.lg,
    ...shadows.md,
  },
  modalHeader: { marginBottom: spacing.lg },
  modalHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: typography.sizes.xl, fontWeight: typography.weights.bold, color: colors.text },
  modalActions: { flexDirection: 'row', gap: spacing.md },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surfaceHover, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  actionText: { color: colors.accent, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium },
  modalScroll: { flex: 1 },
});

const markdownStyles = StyleSheet.create({
  body: {
    fontSize: typography.sizes.body,
    lineHeight: 24,
    color: colors.text,
    fontFamily: 'Outfit_400Regular',
  },
  heading1: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontFamily: 'Outfit_700Bold',
  },
  heading2: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    fontFamily: 'Outfit_700Bold',
  },
  heading3: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textSecondary,
    fontFamily: 'Outfit_600SemiBold',
  },
  paragraph: {
    marginBottom: spacing.sm,
  },
  listItem: {
    marginBottom: spacing.xs,
  },
});
