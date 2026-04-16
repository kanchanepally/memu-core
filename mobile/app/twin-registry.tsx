import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  getTwinRegistry,
  addTwinEntity,
  updateTwinEntity,
  deleteTwinEntity,
  type TwinEntity,
} from '../lib/api';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import ScreenHeader from '../components/ScreenHeader';
import ScreenContainer from '../components/ScreenContainer';
import Masthead from '../components/Masthead';

const ENTITY_TYPES = [
  'person',
  'school',
  'workplace',
  'medical',
  'location',
  'activity',
  'business',
  'institution',
  'other',
] as const;

type Draft = {
  id?: string;
  entityType: string;
  realName: string;
  anonymousLabel: string;
  confirmed: boolean;
};

const EMPTY_DRAFT: Draft = {
  entityType: 'person',
  realName: '',
  anonymousLabel: '',
  confirmed: true,
};

export default function TwinRegistryScreen() {
  const router = useRouter();
  const [entities, setEntities] = useState<TwinEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await getTwinRegistry();
    if (res.data) setEntities(res.data.entities);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openNew = () => {
    setDraft(EMPTY_DRAFT);
    setModalOpen(true);
  };

  const openEdit = (entity: TwinEntity) => {
    setDraft({
      id: entity.id,
      entityType: entity.entity_type,
      realName: entity.real_name,
      anonymousLabel: entity.anonymous_label,
      confirmed: entity.confirmed,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const realName = draft.realName.trim();
    const anonymousLabel = draft.anonymousLabel.trim();
    if (!realName || !anonymousLabel) {
      Alert.alert('Missing fields', 'Both the real name and anonymous label are required.');
      return;
    }
    setSaving(true);
    const res = draft.id
      ? await updateTwinEntity(draft.id, {
          realName,
          anonymousLabel,
          entityType: draft.entityType,
          confirmed: draft.confirmed,
        })
      : await addTwinEntity({ entityType: draft.entityType, realName, anonymousLabel });
    setSaving(false);
    if (res.error) {
      Alert.alert('Could not save', res.error);
      return;
    }
    setModalOpen(false);
    await load();
  };

  const handleDelete = (entity: TwinEntity) => {
    Alert.alert(
      'Remove mapping?',
      `"${entity.real_name}" will no longer be anonymised. Memu will send the real name to the cloud AI from now on.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const res = await deleteTwinEntity(entity.id);
            if (res.error) Alert.alert('Could not remove', res.error);
            await load();
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading registry…</Text>
      </View>
    );
  }

  const grouped = entities.reduce<Record<string, TwinEntity[]>>((acc, e) => {
    (acc[e.entity_type] ||= []).push(e);
    return acc;
  }, {});

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Twin Registry"
        statusLabel="Private"
        statusPulse={false}
        onRightPress={() => router.back()}
        rightIcon="close"
      />
      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        <Masthead
          eyebrow="Digital Twin"
          headline="Names Memu never shares."
          accent="never"
        />

        <View style={styles.introNote}>
          <Text style={styles.introText}>
            Every real name below is replaced with its anonymous label before any query reaches
            the cloud AI. Memu auto-detects new names as you chat, but you can add, rename, or
            remove mappings yourself here.
          </Text>
        </View>

        <Pressable style={styles.addButton} onPress={openNew}>
          <Ionicons name="add-circle" size={20} color={colors.primary} />
          <Text style={styles.addButtonLabel}>Add a mapping</Text>
        </Pressable>

        {entities.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="leaf-outline" size={26} color={colors.tertiary} />
            <Text style={styles.emptyTitle}>No mappings yet.</Text>
            <Text style={styles.emptyHint}>
              Memu will add names as it sees them in your messages. You'll be able to confirm or
              rename them here.
            </Text>
          </View>
        ) : (
          Object.keys(grouped).sort().map(type => (
            <View key={type} style={styles.group}>
              <Text style={styles.groupLabel}>{type}</Text>
              {grouped[type].map(entity => (
                <Pressable
                  key={entity.id}
                  style={styles.card}
                  onPress={() => openEdit(entity)}
                >
                  <View style={styles.cardMain}>
                    <Text style={styles.realName}>{entity.real_name}</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.outline} />
                    <Text style={styles.anonLabel}>{entity.anonymous_label}</Text>
                  </View>
                  <View style={styles.cardMeta}>
                    {!entity.confirmed ? (
                      <View style={styles.unconfirmedPill}>
                        <Text style={styles.unconfirmedText}>Auto-detected</Text>
                      </View>
                    ) : null}
                    <Pressable
                      onPress={() => handleDelete(entity)}
                      hitSlop={8}
                      style={styles.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.onSurfaceVariant} />
                    </Pressable>
                  </View>
                </Pressable>
              ))}
            </View>
          ))
        )}
      </ScreenContainer>

      <Modal visible={modalOpen} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setModalOpen(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>
              {draft.id ? 'Edit mapping' : 'New mapping'}
            </Text>
            <Pressable onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.modalSave}>Save</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.modalBody}>
            <Text style={styles.fieldLabel}>Real name</Text>
            <TextInput
              style={styles.input}
              value={draft.realName}
              onChangeText={t => setDraft(d => ({ ...d, realName: t }))}
              placeholder="e.g. Mrs. Patel"
              placeholderTextColor={colors.outline}
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>Anonymous label</Text>
            <TextInput
              style={styles.input}
              value={draft.anonymousLabel}
              onChangeText={t => setDraft(d => ({ ...d, anonymousLabel: t }))}
              placeholder="e.g. Person-4"
              placeholderTextColor={colors.outline}
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.typeRow}>
              {ENTITY_TYPES.map(type => (
                <Pressable
                  key={type}
                  onPress={() => setDraft(d => ({ ...d, entityType: type }))}
                  style={[
                    styles.typeChip,
                    draft.entityType === type && styles.typeChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.typeChipText,
                      draft.entityType === type && styles.typeChipTextActive,
                    ]}
                  >
                    {type}
                  </Text>
                </Pressable>
              ))}
            </View>

            {draft.id ? (
              <Pressable
                style={styles.confirmRow}
                onPress={() => setDraft(d => ({ ...d, confirmed: !d.confirmed }))}
              >
                <Ionicons
                  name={draft.confirmed ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={draft.confirmed ? colors.primary : colors.outline}
                />
                <Text style={styles.confirmLabel}>Confirmed by me</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
    alignSelf: 'flex-start',
  },
  addButtonLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.primary,
    fontWeight: '600',
  },
  empty: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.lg,
  },
  emptyTitle: {
    marginTop: spacing.sm,
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
  },
  emptyHint: {
    marginTop: spacing.xs,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  group: { marginTop: spacing.lg, paddingHorizontal: spacing.md },
  groupLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadows.sm,
  },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  realName: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    fontWeight: '600',
  },
  anonLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.tertiary,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  unconfirmedPill: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  unconfirmedText: {
    fontSize: 10,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  deleteBtn: { padding: 4 },
  modalContainer: { flex: 1, backgroundColor: colors.surface },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceVariant,
  },
  modalCancel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  modalTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    fontWeight: '600',
  },
  modalSave: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.primary,
    fontWeight: '600',
  },
  modalBody: { padding: spacing.md, gap: spacing.xs },
  fieldLabel: {
    marginTop: spacing.sm,
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
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
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  typeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  typeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeChipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  typeChipTextActive: { color: colors.surface, fontWeight: '600' },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  confirmLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
});
