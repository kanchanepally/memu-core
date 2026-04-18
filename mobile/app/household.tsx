import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  listHouseholdMembers,
  inviteHouseholdMember,
  acceptHouseholdInvite,
  leaveHousehold,
  cancelHouseholdLeave,
  removeHouseholdMember,
  listMemberGrants,
  recordMemberGrant,
  revokeMemberGrant,
  syncMemberGrantsNow,
  listCachedMemberSpaces,
  type HouseholdMember,
  type PodGrant,
  type CachedExternalSpace,
  type LeavePolicy,
} from '../lib/api';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import ScreenHeader from '../components/ScreenHeader';
import ScreenContainer from '../components/ScreenContainer';
import Masthead from '../components/Masthead';

const POLICY_LABELS: Record<LeavePolicy, string> = {
  retain_attributed: 'Keep with their name attached',
  anonymise: 'Keep but strip identity',
  remove: 'Delete entirely',
};

function fmtDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

function daysUntil(value: string | null, now: Date = new Date()): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now.getTime()) / (24 * 60 * 60 * 1000));
}

function statusBadge(status: HouseholdMember['status']): { label: string; tone: 'neutral' | 'warn' | 'danger' | 'ok' } {
  switch (status) {
    case 'invited':
      return { label: 'Invited', tone: 'neutral' };
    case 'active':
      return { label: 'Active', tone: 'ok' };
    case 'leaving':
      return { label: 'Leaving', tone: 'warn' };
    case 'left':
      return { label: 'Left', tone: 'danger' };
  }
}

export default function HouseholdScreen() {
  const router = useRouter();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [includeLeft, setIncludeLeft] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState<HouseholdMember | null>(null);

  const load = useCallback(async () => {
    const res = await listHouseholdMembers(includeLeft);
    if (res.data) setMembers(res.data.members);
    setLoading(false);
  }, [includeLeft]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading household…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Household"
        onRightPress={() => router.back()}
        rightIcon="close"
      />
      <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
        <Masthead
          eyebrow="Cross-household sharing"
          headline="Who is part of this household."
          accent="never"
        />

        <View style={styles.introNote}>
          <Text style={styles.introText}>
            Adults whose primary Pod lives elsewhere can be added here. Their Spaces stay on
            their Pod — this household reads them per-Space, with their consent, and stops
            reading the moment they leave.
          </Text>
        </View>

        <Pressable style={styles.addButton} onPress={() => setInviteOpen(true)}>
          <Ionicons name="person-add-outline" size={18} color={colors.primary} />
          <Text style={styles.addButtonLabel}>Invite someone</Text>
        </Pressable>

        <Pressable
          style={styles.toggleRow}
          onPress={() => setIncludeLeft(v => !v)}
        >
          <Ionicons
            name={includeLeft ? 'checkbox' : 'square-outline'}
            size={18}
            color={includeLeft ? colors.primary : colors.outline}
          />
          <Text style={styles.toggleLabel}>Show members who left</Text>
        </Pressable>

        {members.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={26} color={colors.tertiary} />
            <Text style={styles.emptyTitle}>Just you for now.</Text>
            <Text style={styles.emptyHint}>
              When a partner or other adult joins, invite them with their WebID. They keep their
              own Pod; you only see what they explicitly share.
            </Text>
          </View>
        ) : (
          members.map(m => {
            const badge = statusBadge(m.status);
            const days = daysUntil(m.leaveGraceUntil);
            return (
              <Pressable key={m.id} style={styles.card} onPress={() => setMemberOpen(m)}>
                <View style={styles.cardLeft}>
                  <Text style={styles.memberName}>{m.memberDisplayName}</Text>
                  <Text style={styles.memberWebid} numberOfLines={1}>
                    {m.memberWebid}
                  </Text>
                  {m.status === 'leaving' && days !== null ? (
                    <Text style={styles.gracePreview}>
                      Leaves in {days} day{days === 1 ? '' : 's'} · cancellable
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.statusBadge, styles[`badge_${badge.tone}`]]}>
                  <Text style={styles.statusBadgeText}>{badge.label}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScreenContainer>

      <InviteModal
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSaved={async () => {
          setInviteOpen(false);
          await load();
        }}
      />

      <MemberDetailModal
        member={memberOpen}
        onClose={() => setMemberOpen(null)}
        onChanged={async () => {
          await load();
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Invite modal
// ---------------------------------------------------------------------------

function InviteModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [webid, setWebid] = useState('');
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<LeavePolicy>('retain_attributed');
  const [graceDays, setGraceDays] = useState('30');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setWebid('');
      setName('');
      setPolicy('retain_attributed');
      setGraceDays('30');
    }
  }, [visible]);

  const handleSave = async () => {
    const trimmedWebid = webid.trim();
    const trimmedName = name.trim();
    if (!trimmedWebid || !trimmedName) {
      Alert.alert('Missing fields', 'Both WebID and display name are required.');
      return;
    }
    const grace = Number.parseInt(graceDays, 10);
    if (!Number.isInteger(grace) || grace < 0) {
      Alert.alert('Invalid grace period', 'Enter a whole number of days (0 or more).');
      return;
    }
    setSaving(true);
    const res = await inviteHouseholdMember({
      memberWebid: trimmedWebid,
      memberDisplayName: trimmedName,
      leavePolicyForEmergent: policy,
      gracePeriodDays: grace,
    });
    setSaving(false);
    if (res.error) {
      Alert.alert('Could not invite', res.error);
      return;
    }
    await onSaved();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Invite to household</Text>
          <Pressable onPress={handleSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.modalSave}>Send</Text>
            )}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.fieldLabel}>WebID</Text>
          <TextInput
            style={styles.input}
            value={webid}
            onChangeText={setWebid}
            placeholder="https://their-pod.test/people/sam#me"
            placeholderTextColor={colors.outline}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.helperText}>
            The Solid identity URL on their Pod. Must be https.
          </Text>

          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Sam"
            placeholderTextColor={colors.outline}
            autoCapitalize="words"
          />

          <Text style={styles.fieldLabel}>If they leave, their contributions</Text>
          {(Object.keys(POLICY_LABELS) as LeavePolicy[]).map(p => (
            <Pressable
              key={p}
              style={[styles.optionRow, policy === p && styles.optionRowActive]}
              onPress={() => setPolicy(p)}
            >
              <Ionicons
                name={policy === p ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={policy === p ? colors.primary : colors.outline}
              />
              <Text style={styles.optionLabel}>{POLICY_LABELS[p]}</Text>
            </Pressable>
          ))}

          <Text style={styles.fieldLabel}>Grace period when leaving (days)</Text>
          <TextInput
            style={styles.input}
            value={graceDays}
            onChangeText={setGraceDays}
            placeholder="30"
            placeholderTextColor={colors.outline}
            keyboardType="number-pad"
          />
          <Text style={styles.helperText}>
            How long after they tap "Leave" before access is fully revoked. They can cancel
            inside this window. 0 = leave immediately.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Member detail modal — grants + leave / cancel-leave / accept
// ---------------------------------------------------------------------------

function MemberDetailModal({
  member,
  onClose,
  onChanged,
}: {
  member: HouseholdMember | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [grants, setGrants] = useState<PodGrant[]>([]);
  const [cached, setCached] = useState<CachedExternalSpace[]>([]);
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [grantUrl, setGrantUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!member) return;
    setLoadingGrants(true);
    const [g, c] = await Promise.all([
      listMemberGrants(member.id),
      listCachedMemberSpaces(member.id),
    ]);
    if (g.data) setGrants(g.data.grants);
    if (c.data) setCached(c.data.spaces);
    setLoadingGrants(false);
  }, [member]);

  useEffect(() => {
    if (member) {
      setGrantUrl('');
      load();
    }
  }, [member, load]);

  const cachedByUrl = useMemo(() => {
    const map = new Map<string, CachedExternalSpace>();
    for (const c of cached) map.set(c.spaceUrl, c);
    return map;
  }, [cached]);

  if (!member) return null;
  const days = daysUntil(member.leaveGraceUntil);

  const handleAccept = async () => {
    setBusy(true);
    const res = await acceptHouseholdInvite(member.id);
    setBusy(false);
    if (res.error) {
      Alert.alert('Could not accept', res.error);
      return;
    }
    await onChanged();
    onClose();
  };

  const handleLeave = () => {
    Alert.alert(
      'Leave household?',
      `${member.memberDisplayName} will enter a ${member.gracePeriodDays}-day grace window. Their granted Spaces stay readable until the window closes; you can cancel any time before then.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Start leaving',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const res = await leaveHousehold(member.id);
            setBusy(false);
            if (res.error) {
              Alert.alert('Could not initiate leave', res.error);
              return;
            }
            await onChanged();
            onClose();
          },
        },
      ],
    );
  };

  const handleCancelLeave = async () => {
    setBusy(true);
    const res = await cancelHouseholdLeave(member.id);
    setBusy(false);
    if (res.error) {
      Alert.alert('Could not cancel', res.error);
      return;
    }
    await onChanged();
    onClose();
  };

  const handleForceRemove = () => {
    Alert.alert(
      'Remove immediately?',
      'This finalises the leave straight away with no grace period. All grants are revoked. Use sparingly — for invited members who never accepted, or accounts that need to be ended now.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove now',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const res = await removeHouseholdMember(member.id);
            setBusy(false);
            if (res.error) {
              Alert.alert('Could not remove', res.error);
              return;
            }
            await onChanged();
            onClose();
          },
        },
      ],
    );
  };

  const handleAddGrant = async () => {
    const url = grantUrl.trim();
    if (!url) return;
    setBusy(true);
    const res = await recordMemberGrant(member.id, url);
    setBusy(false);
    if (res.error) {
      Alert.alert('Could not record grant', res.error);
      return;
    }
    setGrantUrl('');
    await load();
  };

  const handleRevokeGrant = (g: PodGrant) => {
    Alert.alert(
      'Revoke this grant?',
      'This household will stop reading that Space immediately. The cached copy is dropped.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const res = await revokeMemberGrant(member.id, g.spaceUrl);
            setBusy(false);
            if (res.error) {
              Alert.alert('Could not revoke', res.error);
              return;
            }
            await load();
          },
        },
      ],
    );
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    const res = await syncMemberGrantsNow(member.id);
    setSyncing(false);
    if (res.error) {
      Alert.alert('Sync failed', res.error);
      return;
    }
    await load();
    const total = res.data?.reports.length ?? 0;
    const errors = res.data?.reports.filter(r => r.outcome.kind === 'error').length ?? 0;
    Alert.alert('Sync done', `${total} Space${total === 1 ? '' : 's'} checked, ${errors} error${errors === 1 ? '' : 's'}.`);
  };

  return (
    <Modal visible={!!member} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.modalCancel}>Close</Text>
          </Pressable>
          <Text style={styles.modalTitle}>{member.memberDisplayName}</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.fieldLabel}>WebID</Text>
          <Text style={styles.fieldValue} selectable>{member.memberWebid}</Text>

          <Text style={styles.fieldLabel}>Status</Text>
          <Text style={styles.fieldValue}>{statusBadge(member.status).label}</Text>
          {member.status === 'leaving' && days !== null ? (
            <Text style={styles.gracePreviewBig}>
              Leaves in {days} day{days === 1 ? '' : 's'} (on {fmtDate(member.leaveGraceUntil)})
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>If they leave</Text>
          <Text style={styles.fieldValue}>{POLICY_LABELS[member.leavePolicyForEmergent]}</Text>
          <Text style={styles.helperText}>Grace period: {member.gracePeriodDays} day{member.gracePeriodDays === 1 ? '' : 's'}</Text>

          {/* Lifecycle actions */}
          <View style={styles.actionRow}>
            {member.status === 'invited' ? (
              <Pressable style={styles.actionBtn} onPress={handleAccept} disabled={busy}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
                <Text style={styles.actionLabel}>Mark as joined</Text>
              </Pressable>
            ) : null}
            {member.status === 'active' ? (
              <Pressable style={styles.actionBtn} onPress={handleLeave} disabled={busy}>
                <Ionicons name="exit-outline" size={18} color={colors.warning} />
                <Text style={styles.actionLabel}>Start leaving</Text>
              </Pressable>
            ) : null}
            {member.status === 'leaving' ? (
              <Pressable style={styles.actionBtn} onPress={handleCancelLeave} disabled={busy}>
                <Ionicons name="arrow-undo-outline" size={18} color={colors.primary} />
                <Text style={styles.actionLabel}>Cancel leaving</Text>
              </Pressable>
            ) : null}
            {member.status !== 'left' ? (
              <Pressable style={[styles.actionBtn, styles.actionBtnDanger]} onPress={handleForceRemove} disabled={busy}>
                <Ionicons name="trash-outline" size={18} color={colors.surface} />
                <Text style={[styles.actionLabel, styles.actionLabelDanger]}>Remove now</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Grants */}
          <Text style={styles.sectionLabel}>Spaces shared with this household</Text>
          {loadingGrants ? (
            <ActivityIndicator color={colors.primary} />
          ) : grants.length === 0 ? (
            <Text style={styles.helperText}>No Spaces shared yet.</Text>
          ) : (
            grants.map(g => {
              const c = cachedByUrl.get(g.spaceUrl);
              return (
                <View key={g.id} style={styles.grantCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.grantTitle} numberOfLines={1}>
                      {c?.name ?? g.spaceUrl.split('/').pop() ?? g.spaceUrl}
                    </Text>
                    <Text style={styles.grantUrl} numberOfLines={1}>
                      {g.spaceUrl}
                    </Text>
                    <Text style={styles.grantMeta}>
                      {c
                        ? `Cached · last fetched ${fmtDate(c.fetchedAt)}`
                        : g.lastSyncedAt
                          ? `Last synced ${fmtDate(g.lastSyncedAt)}`
                          : 'Not yet fetched'}
                    </Text>
                  </View>
                  <Pressable onPress={() => handleRevokeGrant(g)} hitSlop={8} style={styles.deleteBtn}>
                    <Ionicons name="close-circle-outline" size={20} color={colors.onSurfaceVariant} />
                  </Pressable>
                </View>
              );
            })
          )}

          {member.status !== 'left' ? (
            <>
              <Text style={styles.fieldLabel}>Grant a new Space URL</Text>
              <TextInput
                style={styles.input}
                value={grantUrl}
                onChangeText={setGrantUrl}
                placeholder="https://their-pod.test/spaces/person/sam"
                placeholderTextColor={colors.outline}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Pressable style={styles.addButton} onPress={handleAddGrant} disabled={busy || !grantUrl.trim()}>
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={styles.addButtonLabel}>Add grant</Text>
              </Pressable>
              <Pressable style={styles.addButton} onPress={handleSyncNow} disabled={syncing}>
                {syncing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="cloud-download-outline" size={18} color={colors.primary} />
                )}
                <Text style={styles.addButtonLabel}>Sync from their Pod now</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
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
    marginTop: spacing.md,
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  toggleLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
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
  card: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadows.sm,
  },
  cardLeft: { flex: 1, marginRight: spacing.sm },
  memberName: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    fontWeight: '600',
  },
  memberWebid: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  gracePreview: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.tertiary,
    marginTop: 4,
  },
  gracePreviewBig: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.tertiary,
    marginTop: spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  badge_ok: { backgroundColor: colors.primary },
  badge_warn: { backgroundColor: colors.tertiary },
  badge_danger: { backgroundColor: colors.outline },
  badge_neutral: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outline },
  statusBadgeText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.surface,
    fontWeight: '600',
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
  modalBody: { padding: spacing.md, gap: spacing.xs, paddingBottom: spacing.xl * 2 },
  fieldLabel: {
    marginTop: spacing.md,
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  fieldValue: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    marginTop: 2,
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
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  optionRowActive: {
    backgroundColor: colors.surfaceVariant,
  },
  optionLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
  },
  actionBtnDanger: {
    backgroundColor: colors.tertiary,
  },
  actionLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.primary,
    fontWeight: '600',
  },
  actionLabelDanger: { color: colors.surface },
  sectionLabel: {
    marginTop: spacing.xl,
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  grantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  grantTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    fontWeight: '600',
  },
  grantUrl: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  grantMeta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.tertiary,
    marginTop: 2,
  },
  deleteBtn: { padding: 4 },
});
