import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView,
  KeyboardAvoidingView, Platform, TextInput, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { getSpaces, updateSpace, createSpace, type SynthesisPage } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import { stripMarkdown } from '../../lib/markdown';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import Masthead from '../../components/Masthead';
import GradientButton from '../../components/GradientButton';

type Category = 'all' | 'person' | 'routine' | 'household' | 'commitment' | 'document';

const CATEGORY_ORDER: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'person', label: 'People' },
  { key: 'routine', label: 'Routines' },
  { key: 'household', label: 'Household' },
  { key: 'commitment', label: 'Commitments' },
  { key: 'document', label: 'Documents' },
];

function categoryIcon(category: string): React.ComponentProps<typeof Ionicons>['name'] {
  switch (category) {
    case 'person': return 'person-outline';
    case 'routine': return 'time-outline';
    case 'household': return 'home-outline';
    case 'commitment': return 'calendar-number-outline';
    case 'document': return 'document-text-outline';
    default: return 'folder-outline';
  }
}

export default function SpacesScreen() {
  const [spaces, setSpaces] = useState<SynthesisPage[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Category>('all');

  const [selectedPage, setSelectedPage] = useState<SynthesisPage | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newCategory, setNewCategory] = useState<'person' | 'routine' | 'household' | 'commitment' | 'document'>('person');
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [creatingSaving, setCreatingSaving] = useState(false);
  const toast = useToast();

  const loadSpaces = useCallback(async () => {
    const { data } = await getSpaces();
    if (data) setSpaces(data.spaces);
    setLoading(false);
  }, []);

  // Refresh whenever the tab is focused
  useFocusEffect(
    useCallback(() => {
      loadSpaces();
    }, [loadSpaces])
  );

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSpaces();
    setRefreshing(false);
  }, [loadSpaces]);

  const filteredSpaces = useMemo(() => {
    if (filter === 'all') return spaces;
    return spaces.filter(s => s.category === filter);
  }, [spaces, filter]);

  const [featured, ...rest] = filteredSpaces;

  const openEditor = () => {
    if (!selectedPage) return;
    setEditTitle(selectedPage.title);
    setEditBody(selectedPage.body_markdown);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!selectedPage) return;
    setSaving(true);
    const { data } = await updateSpace(selectedPage.id, editTitle.trim(), editBody);
    setSaving(false);
    if (data?.space) {
      setSpaces(prev => prev.map(s => (s.id === data.space.id ? data.space : s)));
      setSelectedPage(data.space);
      setIsEditing(false);
    }
  };

  const closeModal = () => {
    setIsEditing(false);
    setSelectedPage(null);
  };

  const openCreate = () => {
    setNewCategory(filter !== 'all' ? (filter as typeof newCategory) : 'person');
    setNewTitle('');
    setNewBody('');
    setCreating(true);
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      toast.show('Give the space a title first.', 'error');
      return;
    }
    setCreatingSaving(true);
    const { data, error } = await createSpace(newTitle.trim(), newCategory, newBody);
    setCreatingSaving(false);
    if (error || !data?.space) {
      toast.show(error || 'Could not create the space.', 'error');
      return;
    }
    setSpaces(prev => [data.space, ...prev.filter(s => s.id !== data.space.id)]);
    setCreating(false);
    toast.show('Space created.', 'info');
  };

  const handleShare = () => {
    if (!selectedPage) return;
    Share.share({ title: selectedPage.title, message: selectedPage.body_markdown });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Reading your spaces…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Spaces" statusLabel="Curated" statusPulse={false} />

      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        <Masthead
          eyebrow="Curated knowledge"
          headline="Your Spaces, quietly alive."
          accent="quietly alive"
        />

        {/* Category chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {CATEGORY_ORDER.map(c => {
            const active = filter === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => setFilter(c.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {filteredSpaces.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <View style={styles.emptyGlow} />
              <Ionicons name="albums-outline" size={32} color={colors.tertiary} />
            </View>
            <Text style={styles.emptyTitle}>Nothing curated yet.</Text>
            <Text style={styles.emptyHint}>
              Chat with Memu — spaces compile themselves as your knowledge settles.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {/* Feature card (full-width) */}
            {featured ? (
              <Pressable style={styles.featureCard} onPress={() => setSelectedPage(featured)}>
                <View style={styles.featureGlow} />
                <View style={styles.featureHeader}>
                  <View style={styles.featureIconChip}>
                    <Ionicons name={categoryIcon(featured.category)} size={20} color={colors.tertiary} />
                  </View>
                  <Text style={styles.featureCategory}>{featured.category}</Text>
                </View>
                <Text style={styles.featureTitle}>{featured.title}</Text>
                <Text style={styles.featurePreview} numberOfLines={4}>
                  {stripMarkdown(featured.body_markdown)}
                </Text>
                <View style={styles.featureFooter}>
                  <Text style={styles.featureFooterText}>Open space</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                </View>
              </Pressable>
            ) : null}

            {/* 2-column grid for remaining */}
            {rest.length > 0 ? (
              <View style={styles.gridRow}>
                {rest.map(page => (
                  <Pressable
                    key={page.id}
                    style={styles.gridCard}
                    onPress={() => setSelectedPage(page)}
                  >
                    <View style={styles.gridCardHeader}>
                      <Ionicons name={categoryIcon(page.category)} size={16} color={colors.tertiary} />
                      <Text style={styles.gridCategory}>{page.category}</Text>
                    </View>
                    <Text style={styles.gridTitle} numberOfLines={2}>{page.title}</Text>
                    <Text style={styles.gridPreview} numberOfLines={3}>
                      {stripMarkdown(page.body_markdown)}
                    </Text>
                  </Pressable>
                ))}
                {rest.length % 2 === 1 ? <View style={styles.gridCardSpacer} /> : null}
              </View>
            ) : null}
          </View>
        )}
      </ScreenContainer>

      {/* Create FAB */}
      <Pressable style={styles.fab} onPress={openCreate} accessibilityLabel="Create new space">
        <Ionicons name="add" size={26} color={colors.onPrimary} />
      </Pressable>

      {/* Create modal */}
      <Modal visible={creating} animationType="slide" transparent onRequestClose={() => setCreating(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />

            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <View style={styles.modalIconChip}>
                  <Ionicons name="sparkles" size={20} color={colors.tertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalCategory}>New space</Text>
                  <Text style={styles.modalTitle}>Compile by hand</Text>
                </View>
                <Pressable onPress={() => setCreating(false)} hitSlop={12}>
                  <Ionicons name="close" size={22} color={colors.outline} />
                </Pressable>
              </View>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={{ paddingBottom: spacing.xl }}>
              <Text style={styles.fieldLabel}>Category</Text>
              <View style={styles.categoryRow}>
                {(['person', 'routine', 'household', 'commitment', 'document'] as const).map(cat => {
                  const active = newCategory === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setNewCategory(cat)}
                      style={[styles.categoryChip, active && styles.categoryChipActive]}
                    >
                      <Ionicons
                        name={categoryIcon(cat)}
                        size={14}
                        color={active ? colors.onTertiaryContainer : colors.onSurfaceVariant}
                      />
                      <Text style={[styles.categoryChipLabel, active && styles.categoryChipLabelActive]}>
                        {cat}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                style={styles.editTitleInput}
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="e.g. Robin's school routine"
                placeholderTextColor={colors.outline}
              />

              <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Content (markdown)</Text>
              <TextInput
                style={[styles.editBodyInput, { minHeight: 200 }]}
                value={newBody}
                onChangeText={setNewBody}
                multiline
                textAlignVertical="top"
                placeholder="Write freely — headings, lists, whatever holds the thread."
                placeholderTextColor={colors.outline}
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <GradientButton label="Cancel" variant="ghost" onPress={() => setCreating(false)} />
              <GradientButton
                label={creatingSaving ? 'Saving…' : 'Create space'}
                onPress={handleCreate}
                loading={creatingSaving}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Detail modal */}
      <Modal visible={!!selectedPage} animationType="slide" transparent onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />

            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <View style={styles.modalIconChip}>
                  <Ionicons
                    name={categoryIcon(selectedPage?.category || '')}
                    size={20}
                    color={colors.tertiary}
                  />
                </View>
                {isEditing ? (
                  <TextInput
                    style={styles.editTitleInput}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    placeholder="Space title"
                    placeholderTextColor={colors.outline}
                  />
                ) : (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalCategory}>{selectedPage?.category}</Text>
                    <Text style={styles.modalTitle}>{selectedPage?.title}</Text>
                  </View>
                )}
                <Pressable onPress={closeModal} hitSlop={12}>
                  <Ionicons name="close" size={22} color={colors.outline} />
                </Pressable>
              </View>
            </View>

            {isEditing ? (
              <TextInput
                style={styles.editBodyInput}
                value={editBody}
                onChangeText={setEditBody}
                multiline
                textAlignVertical="top"
                placeholder="Markdown content…"
                placeholderTextColor={colors.outline}
              />
            ) : (
              <ScrollView style={styles.modalScroll} contentContainerStyle={{ paddingBottom: spacing.xl }}>
                <Markdown style={markdownStyles}>
                  {selectedPage?.body_markdown || ''}
                </Markdown>
              </ScrollView>
            )}

            <View style={styles.modalActions}>
              {isEditing ? (
                <>
                  <GradientButton label="Cancel" variant="ghost" onPress={() => setIsEditing(false)} />
                  <GradientButton
                    label={saving ? 'Saving…' : 'Save'}
                    onPress={handleSave}
                    loading={saving}
                  />
                </>
              ) : (
                <>
                  <GradientButton label="Share" variant="ghost" icon="share-outline" onPress={handleShare} />
                  <GradientButton label="Edit" icon="create-outline" onPress={openEditor} />
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  loadingText: {
    color: colors.onSurfaceVariant,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
  },

  // Category chips
  chipsScroll: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  chipsRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceContainerLow,
  },
  chipActive: {
    backgroundColor: colors.tertiaryContainer,
  },
  chipLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  chipLabelActive: {
    color: colors.onTertiaryContainer,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyGlow: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
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

  // Grid
  grid: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  featureCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.medium,
  },
  featureGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.tertiaryContainer,
    opacity: 0.35,
  },
  featureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  featureIconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCategory: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  featureTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
    marginBottom: spacing.sm,
    lineHeight: 28,
  },
  featurePreview: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  featureFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  featureFooterText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
    letterSpacing: typography.tracking.wide,
    textTransform: 'uppercase',
  },

  // Grid secondary cards
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gridCard: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 140,
    ...shadows.low,
  },
  gridCardSpacer: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  gridCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  gridCategory: {
    fontSize: 9,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  gridTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyBold,
    color: colors.onSurface,
    marginBottom: spacing.xs + 2,
    lineHeight: 20,
  },
  gridPreview: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 17,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(12,14,16,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    height: '88%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    ...shadows.high,
  },
  modalHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
    alignSelf: 'center',
    marginBottom: spacing.md,
    opacity: 0.5,
  },
  modalHeader: {
    marginBottom: spacing.md,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  modalIconChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  modalCategory: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: 2,
  },
  modalTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
    lineHeight: 28,
  },
  editTitleInput: {
    flex: 1,
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.sm,
  },
  modalScroll: {
    flex: 1,
  },
  editBodyInput: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: typography.sizes.body,
    color: colors.onSurface,
    fontFamily: typography.families.body,
    lineHeight: 22,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },

  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: Platform.OS === 'ios' ? 110 : 96,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.high,
  },

  fieldLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: spacing.sm,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceContainerLow,
  },
  categoryChipActive: {
    backgroundColor: colors.tertiaryContainer,
  },
  categoryChipLabel: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  categoryChipLabelActive: {
    color: colors.onTertiaryContainer,
  },
});

const markdownStyles = StyleSheet.create({
  body: {
    fontSize: typography.sizes.body,
    lineHeight: 24,
    color: colors.onSurface,
    fontFamily: typography.families.body,
  },
  heading1: {
    fontSize: typography.sizes['2xl'],
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    letterSpacing: typography.tracking.tight,
  },
  heading2: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    letterSpacing: typography.tracking.tight,
  },
  heading3: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.bodyBold,
    color: colors.onSurfaceVariant,
    marginTop: spacing.sm,
  },
  paragraph: {
    marginBottom: spacing.sm,
  },
  listItem: {
    marginBottom: spacing.xs,
  },
  link: {
    color: colors.primary,
  },
  code_inline: {
    backgroundColor: colors.surfaceContainerLow,
    color: colors.tertiary,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    fontFamily: typography.families.body,
  },
  blockquote: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.sm,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
  },
});
