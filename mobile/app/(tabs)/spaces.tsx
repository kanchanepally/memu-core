import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView,
  KeyboardAvoidingView, Platform, TextInput, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import QRCode from 'react-native-qrcode-svg';
import {
  getSpaces, updateSpace, createSpace, firstAttachedDocumentIsPdf,
  type SynthesisPage,
} from '../../lib/api';
import { loadAuthState } from '../../lib/auth';
import { useToast } from '../../components/Toast';
import { spacing, radius } from '../../lib/tokens';
import { useTokens } from '../../lib/theme';
import type { Tokens } from '../../lib/tokens';
import { stripMarkdown } from '../../lib/markdown';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import Masthead from '../../components/Masthead';
import GradientButton from '../../components/GradientButton';
import PdfViewer from '../../components/PdfViewer';

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
  const t = useTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const markdownStyles = useMemo(() => makeMarkdownStyles(t), [t]);
  const pdfFallbackStyles = useMemo(() => makePdfFallbackStyles(t), [t]);
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
  const [canvasModal, setCanvasModal] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState<string>('');
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    loadAuthState().then(auth => {
      if (cancelled) return;
      if (auth.serverUrl) setCanvasUrl(auth.serverUrl.replace(/\/$/, '') + '/canvas.html');
    });
    return () => { cancelled = true; };
  }, []);

  const shareCanvasLink = useCallback(async () => {
    if (!canvasUrl) return;
    try {
      await Share.share({ message: canvasUrl, url: canvasUrl, title: 'Spaces Canvas' });
    } catch { /* user cancelled */ }
  }, [canvasUrl]);

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

  // Deep-link: chat artefact chips navigate via /(tabs)/spaces?focus=<slug>
  // and expect the matching Space to open in detail view. Watch for the
  // param + the spaces list both being ready, then open. consumedFocusRef
  // ensures we open it once per param value (focusing the same slug
  // shouldn't re-open if the user has since closed the detail view).
  const focusParam = (useLocalSearchParams() as { focus?: string }).focus;
  const consumedFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusParam || spaces.length === 0) return;
    if (consumedFocusRef.current === focusParam) return;
    const match = spaces.find(s => s.slug === focusParam);
    if (match) {
      setSelectedPage(match);
      consumedFocusRef.current = focusParam;
    }
  }, [focusParam, spaces]);

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

        {/* Canvas CTA — the map view works best on a larger screen, so on
            mobile we surface a discreet card instead of cramming Cytoscape
            onto a phone. */}
        {canvasUrl ? (
          <Pressable style={styles.canvasCta} onPress={() => setCanvasModal(true)}>
            <View style={styles.canvasCtaIcon}>
              <Ionicons name="git-network-outline" size={20} color={t.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.canvasCtaTitle}>Spaces Canvas</Text>
              <Text style={styles.canvasCtaHint} numberOfLines={2}>
                See how your Spaces connect — best on a tablet or laptop.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.text3} />
          </Pressable>
        ) : null}

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
              <Ionicons name="albums-outline" size={32} color={t.brand} />
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
                    <Ionicons name={categoryIcon(featured.category)} size={20} color={t.brand} />
                  </View>
                  <Text style={styles.featureCategory}>{featured.category}</Text>
                </View>
                <Text style={styles.featureTitle}>{featured.title}</Text>
                <Text style={styles.featurePreview} numberOfLines={4}>
                  {stripMarkdown(featured.body_markdown)}
                </Text>
                <View style={styles.featureFooter}>
                  <Text style={styles.featureFooterText}>Open space</Text>
                  <Ionicons name="arrow-forward" size={14} color={t.brand} />
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
                      <Ionicons name={categoryIcon(page.category)} size={16} color={t.brand} />
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

      {/* Canvas modal — QR + URL + share. Stays modest on mobile; the
          actual canvas is at /canvas.html on a larger display. */}
      <Modal visible={canvasModal} animationType="slide" transparent onRequestClose={() => setCanvasModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <View style={styles.modalIconChip}>
                  <Ionicons name="git-network-outline" size={20} color={t.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalCategory}>Canvas</Text>
                  <Text style={styles.modalTitle}>How it all connects</Text>
                </View>
                <Pressable onPress={() => setCanvasModal(false)} hitSlop={12}>
                  <Ionicons name="close" size={22} color={t.text2} />
                </Pressable>
              </View>
            </View>

            <View style={styles.canvasModalBody}>
              <Text style={styles.canvasModalHint}>
                Open this on a tablet or laptop on the same network.
                Scan the code or share the link to yourself.
              </Text>
              {canvasUrl ? (
                <View style={styles.canvasQrWrap}>
                  <QRCode value={canvasUrl} size={200} backgroundColor="#FFFFFF" color="#1F1B2E" />
                </View>
              ) : null}
              <Text style={styles.canvasUrlText} numberOfLines={1}>{canvasUrl}</Text>
              <View style={styles.canvasModalActions}>
                <Pressable style={styles.canvasShareBtn} onPress={shareCanvasLink}>
                  <Ionicons name="share-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.canvasShareBtnText}>Share link</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create FAB */}
      <Pressable style={styles.fab} onPress={openCreate} accessibilityLabel="Create new space">
        <Ionicons name="add" size={26} color="#FFFFFF" />
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
                  <Ionicons name="sparkles" size={20} color={t.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalCategory}>New space</Text>
                  <Text style={styles.modalTitle}>Compile by hand</Text>
                </View>
                <Pressable onPress={() => setCreating(false)} hitSlop={12}>
                  <Ionicons name="close" size={22} color={t.text3} />
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
                        color={active ? t.brand : t.text2}
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
                placeholderTextColor={t.text3}
              />

              <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Content (markdown)</Text>
              <TextInput
                style={[styles.editBodyInput, { minHeight: 200 }]}
                value={newBody}
                onChangeText={setNewBody}
                multiline
                textAlignVertical="top"
                placeholder="Write freely — headings, lists, whatever holds the thread."
                placeholderTextColor={t.text3}
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

      {/* Detail view — full-page overlay (was a sliding modal pre-2026-05-06).
          Brief explicitly called for: full-page canvas, breadcrumb '← All
          Spaces' at top, markdown body, Edit + Share at bottom. Same
          edit/save/share state and handlers; only the chrome changed. */}
      {selectedPage ? (
        <KeyboardAvoidingView
          style={styles.detailFullPage}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable onPress={closeModal} style={styles.detailBreadcrumb} hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color={t.brand} />
            <Text style={styles.detailBreadcrumbLabel}>All Spaces</Text>
          </Pressable>

          <View style={styles.detailHeader}>
            <View style={styles.detailIconChip}>
              <Ionicons
                name={categoryIcon(selectedPage.category)}
                size={20}
                color={t.brand}
              />
            </View>
            {isEditing ? (
              <TextInput
                style={styles.editTitleInput}
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Space title"
                placeholderTextColor={t.text3}
              />
            ) : (
              <View style={{ flex: 1 }}>
                <Text style={styles.detailCategory}>{selectedPage.category}</Text>
                <Text style={styles.detailTitle}>{selectedPage.title}</Text>
              </View>
            )}
          </View>

          {isEditing ? (
            <TextInput
              style={styles.editBodyInput}
              value={editBody}
              onChangeText={setEditBody}
              multiline
              textAlignVertical="top"
              placeholder="Markdown content…"
              placeholderTextColor={t.text3}
            />
          ) : selectedPage.category === 'document' && firstAttachedDocumentIsPdf(selectedPage) ? (
            // Native PDF view — react-native-pdf renders the original
            // pages from GET /api/spaces/:id/document. OCR'd body_markdown
            // is reachable via Edit. Requires EAS build (config plugin).
            <View style={styles.pdfHost}>
              <PdfViewer spaceId={selectedPage.id} idx={0} />
            </View>
          ) : (
            <ScrollView
              style={styles.detailScroll}
              contentContainerStyle={{ paddingBottom: spacing['2xl'] }}
            >
              {/* Plain-text fallback for document Spaces without an
                  attached PDF (e.g. .txt sources, or ingest pre-dating
                  the persistOriginal hookup). Skips markdown parsing
                  to avoid the crash class where embedded HTML / pdf.js
                  worker references blew up react-native-markdown-display. */}
              {selectedPage.category === 'document' ? (
                <Text style={pdfFallbackStyles.body}>
                  {selectedPage.body_markdown || ''}
                </Text>
              ) : (
                <Markdown style={markdownStyles}>
                  {selectedPage.body_markdown || ''}
                </Markdown>
              )}
            </ScrollView>
          )}

          <View style={styles.detailActions}>
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
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

function makeStyles(t: Tokens) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  loadingText: {
    color: t.text2,
    fontSize: 15,
    fontFamily: t.uiRegular,
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
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
  },
  chipActive: {
    backgroundColor: t.brandSoft,
    borderColor: t.brand,
  },
  chipLabel: {
    fontSize: 11,
    fontFamily: t.mono,
    color: t.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipLabelActive: {
    color: t.brand,
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

  // Grid
  grid: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  featureCard: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: 36,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.border,
  },
  featureGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: t.brandSoft,
    opacity: 0.35,
  },
  featureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  featureIconChip: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: t.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCategory: {
    fontSize: 10,
    fontFamily: t.mono,
    color: t.brand,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  featureTitle: {
    fontSize: 34,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
    lineHeight: 38,
  },
  featurePreview: {
    fontSize: 15,
    fontFamily: t.serifItalic,
    color: t.text2,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  featureFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  featureFooterText: {
    fontSize: 11,
    fontFamily: t.mono,
    color: t.brand,
    letterSpacing: 0.5,
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
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    padding: 22,
    minHeight: 140,
    borderWidth: 1,
    borderColor: t.border,
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
    fontFamily: t.mono,
    color: t.brand,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  gridTitle: {
    fontSize: 21,
    fontFamily: t.serif,
    color: t.text,
    marginBottom: spacing.xs + 2,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  gridPreview: {
    fontSize: 12,
    fontFamily: t.uiRegular,
    color: t.text2,
    lineHeight: 17,
  },

  // ---- Full-page Space detail (was a sliding modal pre-2026-05-06) ----
  detailFullPage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.bg,
    paddingTop: Platform.OS === 'android' ? 24 : 56,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  detailBreadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
  },
  detailBreadcrumbLabel: {
    fontSize: 15,
    fontFamily: t.ui,
    color: t.brand,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  detailIconChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: t.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCategory: {
    fontSize: 11,
    fontFamily: t.mono,
    color: t.brand,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  detailTitle: {
    fontSize: 28,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
    marginTop: 2,
  },
  detailScroll: {
    flex: 1,
  },
  pdfHost: {
    flex: 1,
    marginVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  detailActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },

  // Legacy modal styles (still referenced by the create-Space modal below).
  modalOverlay: {
    flex: 1,
    backgroundColor: t.scrim,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: t.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    height: '88%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
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
    backgroundColor: t.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  modalCategory: {
    fontSize: 10,
    fontFamily: t.mono,
    color: t.brand,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  modalTitle: {
    fontSize: 22,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
    lineHeight: 28,
  },
  editTitleInput: {
    flex: 1,
    fontSize: 22,
    fontFamily: t.serif,
    color: t.text,
    letterSpacing: -0.5,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: t.border,
  },
  modalScroll: {
    flex: 1,
  },
  editBodyInput: {
    flex: 1,
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
    fontSize: 15,
    color: t.text,
    fontFamily: t.uiRegular,
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
    backgroundColor: t.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },

  fieldLabel: {
    fontSize: 10,
    fontFamily: t.mono,
    color: t.brand,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
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
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: t.border,
  },
  categoryChipActive: {
    backgroundColor: t.brandSoft,
    borderColor: t.brand,
  },
  categoryChipLabel: {
    fontSize: 11,
    fontFamily: t.mono,
    color: t.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryChipLabelActive: {
    color: t.brand,
  },
  canvasCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
  },
  canvasCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasCtaTitle: {
    fontSize: 15,
    fontFamily: t.serif,
    color: t.text,
  },
  canvasCtaHint: {
    fontSize: 12.5,
    color: t.text2,
    marginTop: 2,
    fontFamily: t.uiRegular,
  },
  canvasModalBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  canvasModalHint: {
    fontSize: 13,
    color: t.text2,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: t.uiRegular,
  },
  canvasQrWrap: {
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasUrlText: {
    fontSize: 12,
    color: t.text3,
    fontFamily: t.mono,
    textAlign: 'center',
  },
  canvasModalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  canvasShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: t.brand,
  },
  canvasShareBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: t.ui,
  },
  });
}

// Plain-text fallback for document-category Spaces. Uses the serif
// reading family so OCR'd PDF text reads close to the original tone.
// Theme-aware factory — invoked via useMemo at the call site.
function makePdfFallbackStyles(t: Tokens) {
  return StyleSheet.create({
    body: {
      fontSize: 15,
      fontFamily: t.serifRegular,
      color: t.text,
      lineHeight: 24,
    },
  });
}

function makeMarkdownStyles(t: Tokens) {
  return StyleSheet.create({
  body: {
    fontSize: 15,
    lineHeight: 24,
    color: t.text,
    fontFamily: t.serifRegular,
  },
  heading1: {
    fontSize: 28,
    fontFamily: t.serif,
    color: t.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    letterSpacing: -0.5,
  },
  heading2: {
    fontSize: 22,
    fontFamily: t.serif,
    color: t.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    letterSpacing: -0.5,
  },
  heading3: {
    fontSize: 18,
    fontFamily: t.serif,
    color: t.text2,
    marginTop: spacing.sm,
  },
  paragraph: {
    marginBottom: spacing.sm,
  },
  listItem: {
    marginBottom: spacing.xs,
  },
  link: {
    color: t.brand,
  },
  code_inline: {
    backgroundColor: t.surfaceAlt,
    color: t.brand,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    fontFamily: t.mono,
  },
  blockquote: {
    backgroundColor: t.surfaceAlt,
    borderLeftWidth: 3,
    borderLeftColor: t.brand,
    borderRadius: radius.sm,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
  },
  });
}
