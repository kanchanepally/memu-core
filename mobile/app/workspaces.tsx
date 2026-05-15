/**
 * Build Spec 1 Story 5.3 — Workspace switcher UI (mobile).
 *
 * Lists every Collective the caller is an active member of, exposes a
 * detail modal per workspace (showing role + projects + an inline
 * create-project form + a "Switch to this workspace" affordance), and
 * a create-workspace sheet behind the "+" button.
 *
 * Honest scope today:
 *  - The Switch button writes activeWorkspaceId to AsyncStorage-backed
 *    prefs only. The server still scopes non-project endpoints (Today,
 *    Chat, Lists) to the caller's home Collective. Story 3.2 is the
 *    backend half — once that ships, the same prefs entry will start
 *    threading through to per-request scope, and the toast wording
 *    becomes obsolete.
 *  - 'household' is filtered out of the create-type picker — the
 *    backend rejects it with reason 'household_reserved'.
 *  - Children get a disabled "+" affordance. The backend would refuse
 *    anyway; we hide the dead-end interaction.
 *
 * Out of scope (per spec): auto-creating personal workspace on signup
 * (Story 5.2 / 3.3), edit/delete workspaces, PWA surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '../components/ui/Text';
import { Card } from '../components/ui/Card';
import ScreenContainer from '../components/ScreenContainer';
import ScreenHeader from '../components/ScreenHeader';
import Masthead from '../components/Masthead';
import GradientButton from '../components/GradientButton';
import { useToast } from '../components/Toast';
import { colors, radius, spacing, typography } from '../lib/tokens';
import { getActiveWorkspaceId, setActiveWorkspaceId } from '../lib/prefs';
import {
  CREATABLE_WORKSPACE_TYPES,
  type Workspace,
  type WorkspaceProject,
  type WorkspaceType,
  createProject,
  createWorkspace,
  fetchSelfRole,
  listProjects,
  listWorkspaces,
} from '../lib/api';
import {
  findHomeWorkspaceId,
  isChildRole,
  validateWorkspaceCreateInput,
  workspaceCreateErrorMessage,
  workspaceRoleLabel,
  workspaceSwitchedToastMessage,
  workspaceTypeLabel,
} from '../lib/workspaces';

interface SelfRole {
  role: string | null;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function WorkspacesScreen() {
  const router = useRouter();
  const toast = useToast();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selfRole, setSelfRole] = useState<SelfRole>({ role: null });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Workspace | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Pull the caller's own role from /api/family/profiles (the row with
  // is_self=true). Used only to disable the "+" affordance for children.
  // If the request fails we leave role=null and treat the user as adult —
  // the backend is the source of truth and will refuse anyway.
  const loadSelfRole = useCallback(async () => {
    try {
      const r = await fetchSelfRole();
      setSelfRole({ role: r });
    } catch {
      setSelfRole({ role: null });
    }
  }, []);

  const load = useCallback(async () => {
    const res = await listWorkspaces();
    if (res.data) setWorkspaces(res.data.workspaces);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    loadSelfRole();
    getActiveWorkspaceId().then(setActiveId);
  }, [load, loadSelfRole]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const homeId = useMemo(() => findHomeWorkspaceId(workspaces), [workspaces]);
  const childGated = isChildRole(selfRole.role);

  const handleSwitch = useCallback(
    async (workspace: Workspace) => {
      await setActiveWorkspaceId(workspace.id);
      setActiveId(workspace.id);
      toast.show(workspaceSwitchedToastMessage(workspace.name), 'success');
    },
    [toast],
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Workspaces" onRightPress={() => router.back()} rightIcon="close" />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading workspaces…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Workspaces" onRightPress={() => router.back()} rightIcon="close" />
      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        <Masthead
          eyebrow="Multi-Collective"
          headline="Every workspace you belong to."
        />

        <View style={styles.introNote}>
          <Text style={styles.introText}>
            Your home Collective drives Today, Chat and Lists. Other workspaces are spaces you co-own — open
            one to browse its projects. Switching here is informational for now; cross-workspace
            browsing of Today / Chat / Lists is on its way.
          </Text>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            style={({ pressed }) => [
              styles.addButton,
              childGated && styles.addButtonDisabled,
              pressed && !childGated && { opacity: 0.7 },
            ]}
            onPress={() => !childGated && setCreateOpen(true)}
            disabled={childGated}
            accessibilityLabel="Create a new workspace"
            accessibilityState={{ disabled: childGated }}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.addButtonLabel}>New workspace</Text>
          </Pressable>
          {childGated ? (
            <Text style={styles.childHint}>Adults manage workspaces.</Text>
          ) : null}
        </View>

        {workspaces.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="briefcase-outline" size={26} color={colors.tertiary} />
            <Text style={styles.emptyTitle}>No workspaces yet.</Text>
            <Text style={styles.emptyHint}>
              You should always see at least your household — if not, the backend may not have run the
              registration migration yet.
            </Text>
          </View>
        ) : (
          workspaces.map(w => (
            <WorkspaceRow
              key={w.id}
              workspace={w}
              isHome={w.id === homeId}
              isActive={w.id === activeId}
              onOpen={() => setDetail(w)}
            />
          ))
        )}
      </ScreenContainer>

      <CreateWorkspaceModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async w => {
          setCreateOpen(false);
          toast.show(`Created "${w.name}".`, 'success');
          await load();
        }}
      />

      <WorkspaceDetailModal
        workspace={detail}
        isHome={detail ? detail.id === homeId : false}
        isActive={detail ? detail.id === activeId : false}
        onClose={() => setDetail(null)}
        onSwitch={handleSwitch}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function WorkspaceRow({
  workspace,
  isHome,
  isActive,
  onOpen,
}: {
  workspace: Workspace;
  isHome: boolean;
  isActive: boolean;
  onOpen: () => void;
}) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityLabel={`Open ${workspace.name}`}
      style={({ pressed }) => [styles.rowPressable, pressed && { opacity: 0.7 }]}
    >
      <Card padding="md" style={styles.workspaceCard}>
        <View style={styles.workspaceLeft}>
          <View style={styles.workspaceTitleRow}>
            <Text
              variant="ui"
              size="body"
              weight="medium"
              color="onSurface"
              style={styles.workspaceName}
              numberOfLines={1}
            >
              {workspace.name}
            </Text>
            {isHome ? (
              <View style={styles.homeIndicator}>
                <Ionicons name="home" size={11} color={colors.primary} />
                <Text style={styles.homeIndicatorLabel}>Home</Text>
              </View>
            ) : null}
            {isActive && !isHome ? (
              <View style={styles.currentIndicator}>
                <Text style={styles.currentIndicatorLabel}>Current</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.chipRow}>
            <View style={[styles.chip, styles.typeChip]}>
              <Text style={styles.chipText}>{workspaceTypeLabel(workspace.type)}</Text>
            </View>
            <View style={[styles.chip, roleChipStyle(workspace.role)]}>
              <Text style={styles.chipText}>{workspaceRoleLabel(workspace.role)}</Text>
            </View>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.outline} />
      </Card>
    </Pressable>
  );
}

function roleChipStyle(role: string) {
  switch (role) {
    case 'owner':
      return styles.roleChipOwner;
    case 'admin':
      return styles.roleChipAdmin;
    case 'child':
      return styles.roleChipChild;
    default:
      return styles.roleChipAdult;
  }
}

// ---------------------------------------------------------------------------
// Create-workspace modal (sheet)
// ---------------------------------------------------------------------------

function CreateWorkspaceModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (w: Workspace) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<WorkspaceType | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName('');
      setType('');
      setError(null);
      setSaving(false);
    }
  }, [visible]);

  const handleSave = async () => {
    setError(null);
    const validation = validateWorkspaceCreateInput({ name, type });
    if (!validation.ok) {
      setError(workspaceCreateErrorMessage(validation.reason));
      return;
    }
    setSaving(true);
    const res = await createWorkspace({ name: validation.name, type: validation.type });
    setSaving(false);
    if (res.error) {
      // The backend returns 400 with { error: <reason> } — surface the
      // mapped message inline instead of an alert so the user can
      // correct the form without losing context.
      setError(workspaceCreateErrorMessage(res.error));
      return;
    }
    if (res.data?.workspace) {
      await onCreated(res.data.workspace);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} accessibilityLabel="Cancel">
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>New workspace</Text>
          <Pressable onPress={handleSave} disabled={saving} accessibilityLabel="Create workspace">
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.modalSave}>Create</Text>
            )}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={t => {
              setName(t);
              setError(null);
            }}
            placeholder="Side project, Book club, Research…"
            placeholderTextColor={colors.outline}
            maxLength={120}
          />
          <Text style={styles.helperText}>1–120 characters.</Text>

          <Text style={styles.fieldLabel}>Type</Text>
          {CREATABLE_WORKSPACE_TYPES.map(t => {
            const selected = type === t;
            return (
              <Pressable
                key={t}
                style={[styles.optionRow, selected && styles.optionRowActive]}
                onPress={() => {
                  setType(t);
                  setError(null);
                }}
                accessibilityLabel={`Type ${workspaceTypeLabel(t)}`}
                accessibilityState={{ selected }}
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? colors.primary : colors.outline}
                />
                <Text style={styles.optionLabel}>{workspaceTypeLabel(t)}</Text>
              </Pressable>
            );
          })}
          <Text style={styles.helperText}>
            Household workspaces are created automatically when you register — you can't pick one here.
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Workspace detail modal — projects + switch
// ---------------------------------------------------------------------------

function WorkspaceDetailModal({
  workspace,
  isHome,
  isActive,
  onClose,
  onSwitch,
}: {
  workspace: Workspace | null;
  isHome: boolean;
  isActive: boolean;
  onClose: () => void;
  onSwitch: (w: Workspace) => Promise<void>;
}) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    const res = await listProjects(workspace.id);
    if (res.data) setProjects(res.data.projects);
    setLoading(false);
  }, [workspace]);

  useEffect(() => {
    if (workspace) {
      setNewProjectName('');
      setProjectError(null);
      load();
    }
  }, [workspace, load]);

  if (!workspace) return null;

  const handleCreateProject = async () => {
    setProjectError(null);
    const trimmed = newProjectName.trim();
    if (!trimmed) {
      setProjectError('Give your project a name.');
      return;
    }
    setCreating(true);
    const res = await createProject(workspace.id, { name: trimmed });
    setCreating(false);
    if (res.error) {
      // Backend reasons: name_required / slug_invalid / slug_conflict.
      // Map them inline.
      const map: Record<string, string> = {
        name_required: 'Give your project a name.',
        slug_invalid: 'That name produced an invalid slug — try another.',
        slug_conflict: 'A project with that slug already exists in this workspace.',
      };
      setProjectError(map[res.error] ?? res.error);
      return;
    }
    setNewProjectName('');
    await load();
  };

  const handleSwitchPress = async () => {
    if (isActive) {
      Alert.alert('Already current', 'This workspace is already the one you switched to.');
      return;
    }
    await onSwitch(workspace);
    onClose();
  };

  return (
    <Modal
      visible={!!workspace}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} accessibilityLabel="Close">
            <Text style={styles.modalCancel}>Close</Text>
          </Pressable>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {workspace.name}
          </Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView contentContainerStyle={styles.modalBody}>
          <View style={styles.chipRow}>
            <View style={[styles.chip, styles.typeChip]}>
              <Text style={styles.chipText}>{workspaceTypeLabel(workspace.type)}</Text>
            </View>
            <View style={[styles.chip, roleChipStyle(workspace.role)]}>
              <Text style={styles.chipText}>{workspaceRoleLabel(workspace.role)}</Text>
            </View>
            {isHome ? (
              <View style={[styles.chip, styles.homeChip]}>
                <Ionicons name="home" size={11} color={colors.primary} />
                <Text style={[styles.chipText, { color: colors.primary, marginLeft: 4 }]}>Home</Text>
              </View>
            ) : null}
            {isActive && !isHome ? (
              <View style={[styles.chip, styles.currentChip]}>
                <Text style={[styles.chipText, { color: colors.primary }]}>Current</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>Projects</Text>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
          ) : projects.length === 0 ? (
            <Text style={styles.helperText}>No projects yet. Create the first one below.</Text>
          ) : (
            projects.map(p => (
              <View key={p.id} style={styles.projectCard}>
                <Text style={styles.projectName}>{p.name}</Text>
                {p.description ? (
                  <Text style={styles.projectDescription}>{p.description}</Text>
                ) : null}
                <Text style={styles.projectMeta}>
                  {p.slug} · {p.status}
                </Text>
              </View>
            ))
          )}

          <Text style={styles.fieldLabel}>Create a project</Text>
          <TextInput
            style={styles.input}
            value={newProjectName}
            onChangeText={t => {
              setNewProjectName(t);
              setProjectError(null);
            }}
            placeholder="What is this project called?"
            placeholderTextColor={colors.outline}
            maxLength={120}
          />
          <Pressable
            style={({ pressed }) => [
              styles.addButton,
              (creating || !newProjectName.trim()) && styles.addButtonDisabled,
              pressed && !creating && newProjectName.trim() && { opacity: 0.7 },
            ]}
            onPress={handleCreateProject}
            disabled={creating || !newProjectName.trim()}
            accessibilityLabel="Add project"
          >
            {creating ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            )}
            <Text style={styles.addButtonLabel}>Add project</Text>
          </Pressable>
          {projectError ? <Text style={styles.errorText}>{projectError}</Text> : null}

          <View style={styles.switchSection}>
            <Text style={styles.sectionLabel}>Active workspace</Text>
            <Text style={styles.helperText}>
              Switching is a client-side bookmark today — it remembers the workspace you last opened.
              When the server-side scope (Story 3.2) ships, the same setting will start driving
              Today, Chat and Lists too.
            </Text>
            <GradientButton
              label={isActive ? 'Already current' : 'Switch to this workspace'}
              onPress={handleSwitchPress}
              variant={isActive ? 'secondary' : 'primary'}
              disabled={isActive}
              full
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  loadingText: {
    color: colors.onSurfaceVariant,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
  },
  introNote: { paddingHorizontal: spacing.md, marginTop: spacing.lg },
  introText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    lineHeight: 21,
  },
  actionRow: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
    minHeight: 44,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.primary,
    fontWeight: '600',
  },
  childHint: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
  },
  empty: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.lg,
    gap: spacing.xs,
  },
  emptyTitle: {
    marginTop: spacing.sm,
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
  },
  emptyHint: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  rowPressable: { marginTop: spacing.sm },
  workspaceCard: {
    marginHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 44,
  },
  workspaceLeft: { flex: 1, gap: spacing.xs },
  workspaceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  workspaceName: {
    fontSize: typography.sizes.body,
    flexShrink: 1,
  },
  homeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryContainer + '40',
  },
  homeIndicatorLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  currentIndicator: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  currentIndicatorLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  // Type chip: muted neutral. The type is descriptive, not status-bearing —
  // so it stays in the calm secondary-container palette rather than carrying
  // distinct colour per type (which would push the rail into a colourful
  // palette decision Hareesh may want to revisit).
  typeChip: {
    backgroundColor: colors.surfaceContainer,
  },
  // Role chips: owner gets the strongest signal (it's a permission), admin a
  // softer indigo, adult neutral, child tertiary (the privacy-aware tone).
  roleChipOwner: {
    backgroundColor: colors.primaryContainer + '60',
  },
  roleChipAdmin: {
    backgroundColor: colors.secondaryContainer,
  },
  roleChipAdult: {
    backgroundColor: colors.surfaceContainer,
  },
  roleChipChild: {
    backgroundColor: colors.tertiaryContainer,
  },
  homeChip: {
    backgroundColor: colors.primaryContainer + '40',
  },
  currentChip: {
    borderWidth: 1,
    borderColor: colors.primary,
  },

  // Modal
  modalContainer: { flex: 1, backgroundColor: colors.surface },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceVariant,
    minHeight: 56,
  },
  modalCancel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    minWidth: 60,
  },
  modalTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  modalSave: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.primary,
    fontWeight: '600',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    minWidth: 60,
    textAlign: 'right',
  },
  modalBody: { padding: spacing.md, gap: spacing.xs, paddingBottom: spacing.xl * 2 },
  fieldLabel: {
    marginTop: spacing.md,
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  helperText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: 4,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    backgroundColor: colors.surfaceVariant,
    marginTop: spacing.xs,
    minHeight: 44,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    minHeight: 44,
  },
  optionRowActive: {
    backgroundColor: colors.surfaceVariant,
  },
  optionLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  errorText: {
    marginTop: spacing.sm,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.error,
  },
  sectionLabel: {
    marginTop: spacing.xl,
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  projectCard: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
    gap: 2,
  },
  projectName: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    fontWeight: '600',
  },
  projectDescription: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  projectMeta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.tertiary,
  },
  switchSection: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
});
