import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Linking, Alert,
  Modal, TextInput, KeyboardAvoidingView, Platform, Share,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import { loadAuthState, clearAuthState, saveDisplayName } from '../../lib/auth';
import { loadPrefs, setAIMode, setBriefingEnabled, setBriefingTime, type AIMode, type Prefs } from '../../lib/prefs';
import {
  updateProfile, clearChatHistory, exportData, getGoogleAuthUrl,
  getBYOKStatus, setBYOKKey, revokeBYOKKey, toggleBYOKKey,
  runBriefingNow,
  type BYOKKeyStatus,
} from '../../lib/api';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import Masthead from '../../components/Masthead';
import GradientButton from '../../components/GradientButton';
import { useToast } from '../../components/Toast';

interface RowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}

function Row({ icon, title, subtitle, onPress, right, destructive, disabled }: RowProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && { opacity: 0.7 },
        disabled && { opacity: 0.4 },
      ]}
      onPress={onPress}
      disabled={disabled || !onPress}
    >
      <View style={[styles.rowIcon, destructive && styles.rowIconDestructive]}>
        <Ionicons name={icon} size={18} color={destructive ? colors.error : colors.primary} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowTitle, destructive && styles.rowTitleDestructive]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right !== undefined
        ? right
        : onPress
          ? <Ionicons name="chevron-forward" size={16} color={colors.outline} />
          : null}
    </Pressable>
  );
}

const AI_MODE_LABELS: Record<AIMode, { label: string; subtitle: string }> = {
  active: { label: 'Active', subtitle: 'Memu responds in every conversation' },
  quiet: { label: 'Quiet', subtitle: 'Only when directly addressed' },
  off: { label: 'Off', subtitle: 'Stays silent until you ask' },
};

export default function SettingsScreen() {
  const router = useRouter();
  const [auth, setAuth] = useState<{ serverUrl: string | null; displayName: string | null }>({
    serverUrl: null, displayName: null,
  });
  const [prefs, setPrefs] = useState<Prefs>({
    aiMode: 'active', briefingEnabled: true, briefingTime: '07:00',
  });

  // Modal state
  const [nameModal, setNameModal] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [aiModeModal, setAiModeModal] = useState(false);
  const [briefingModal, setBriefingModal] = useState(false);
  const [editedTime, setEditedTime] = useState('07:00');
  const [sendingTest, setSendingTest] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);

  const toast = useToast();

  // Calendar state
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // BYOK state
  const [byokAnthropic, setByokAnthropic] = useState<BYOKKeyStatus | null>(null);
  const [byokIsChild, setByokIsChild] = useState(false);
  const [byokModal, setByokModal] = useState(false);
  const [byokInput, setByokInput] = useState('');
  const [byokSaving, setByokSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [authState, loadedPrefs, byok, brief] = await Promise.all([
      loadAuthState(),
      loadPrefs(),
      getBYOKStatus(),
      import('../../lib/api').then(m => m.getTodayBrief()),
    ]);
    setAuth({ serverUrl: authState.serverUrl, displayName: authState.displayName });
    setPrefs(loadedPrefs);
    
    if (byok.data) {
      setByokIsChild(!!byok.data.reason);
      const anthropic = byok.data.keys.find(k => k.provider === 'anthropic');
      setByokAnthropic(anthropic ?? { provider: 'anthropic', hasKey: false, enabled: false });
    }

    if (brief.data) {
      setIsCalendarConnected(brief.data.isCalendarConnected);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openNameEditor = () => {
    setEditedName(auth.displayName || '');
    setNameModal(true);
  };

  const handleSaveName = async () => {
    const trimmed = editedName.trim();
    if (!trimmed) return;
    setSavingName(true);
    const { data, error } = await updateProfile(trimmed);
    setSavingName(false);
    if (error) {
      Alert.alert('Could not update', error);
      return;
    }
    if (data?.profile) {
      await saveDisplayName(data.profile.display_name);
      setAuth(prev => ({ ...prev, displayName: data.profile.display_name }));
    }
    setNameModal(false);
  };

  const handleSetAIMode = async (mode: AIMode) => {
    await setAIMode(mode);
    setPrefs(p => ({ ...p, aiMode: mode }));
    setAiModeModal(false);
  };

  const openBriefingEditor = () => {
    setEditedTime(prefs.briefingTime);
    setBriefingModal(true);
  };

  const handleSendTestPush = async () => {
    setSendingTest(true);
    const { error } = await runBriefingNow('push');
    setSendingTest(false);
    if (error) {
      toast.show(error.length > 80 ? 'Could not send test briefing' : error, 'error');
      return;
    }
    toast.show('Test briefing sent — check your notifications');
  };

  const handleSaveBriefing = async (enabled: boolean, time: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) {
      Alert.alert('Invalid time', 'Use HH:MM format, e.g. 07:00');
      return;
    }
    const h = Math.min(23, Math.max(0, parseInt(match[1], 10)));
    const m = Math.min(59, Math.max(0, parseInt(match[2], 10)));
    const normalised = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    await Promise.all([setBriefingTime(normalised), setBriefingEnabled(enabled)]);
    setPrefs(p => ({ ...p, briefingTime: normalised, briefingEnabled: enabled }));
    setBriefingModal(false);
  };

  const handleConnectCalendar = async () => {
    const { data, error } = await getGoogleAuthUrl('mobile');
    if (error) return Alert.alert('Could not start auth', error);
    if (data?.url) await Linking.openURL(data.url);
  };

  const handleDisconnectCalendar = async () => {
    Alert.alert(
      'Disconnect Google Calendar?',
      'Memu will no longer be able to see or manage your events.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnecting(true);
            const { error } = await import('../../lib/api').then(m => m.disconnectGoogleCalendar());
            setDisconnecting(false);
            if (error) {
              Alert.alert('Could not disconnect', error);
            } else {
              setIsCalendarConnected(false);
              Alert.alert('Disconnected', 'Google Calendar has been un-linked.');
            }
          },
        },
      ]
    );
  };

  const handleExportData = async () => {
    setExporting(true);
    const { data, error } = await exportData();
    setExporting(false);
    if (error) return Alert.alert('Export failed', error);
    if (data) {
      await Share.share({
        title: 'Memu data export',
        message: data,
      });
    }
  };

  const handleClearChat = () => {
    Alert.alert(
      'Clear chat history?',
      'This removes all chat messages from the server. Spaces, lists, and calendar remain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setClearingChat(true);
            const { error } = await clearChatHistory();
            setClearingChat(false);
            if (error) Alert.alert('Could not clear', error);
          },
        },
      ]
    );
  };

  const openBYOKEditor = () => {
    setByokInput('');
    setByokModal(true);
  };

  const handleSaveBYOK = async () => {
    const trimmed = byokInput.trim();
    if (trimmed.length < 10) {
      Alert.alert('Invalid key', 'That doesn\u2019t look like a valid API key.');
      return;
    }
    setByokSaving(true);
    const { error } = await setBYOKKey('anthropic', trimmed);
    setByokSaving(false);
    if (error) {
      Alert.alert('Could not save', error);
      return;
    }
    setByokModal(false);
    setByokInput('');
    await refresh();
  };

  const handleRevokeBYOK = () => {
    Alert.alert(
      'Remove your Anthropic key?',
      'Your queries will fall back to the deployment key. You can paste a new one anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await revokeBYOKKey('anthropic');
            if (error) {
              Alert.alert('Could not remove', error);
              return;
            }
            setByokModal(false);
            await refresh();
          },
        },
      ]
    );
  };

  const handleToggleBYOK = async (enabled: boolean) => {
    const { error } = await toggleBYOKKey('anthropic', enabled);
    if (error) {
      Alert.alert('Could not update', error);
      return;
    }
    await refresh();
  };

  const handleFeedback = () => {
    const subject = encodeURIComponent('Memu feedback');
    const body = encodeURIComponent(
      `App version: 0.1.0\nPlatform: ${Platform.OS}\n\n`,
    );
    Linking.openURL(`mailto:hareesh@memu.digital?subject=${subject}&body=${body}`);
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign out',
      'Removes your connection to this server. You can sign back in anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await clearAuthState();
            router.replace('/onboarding/welcome');
          },
        },
      ]
    );
  };

  const aiModeInfo = AI_MODE_LABELS[prefs.aiMode];

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Settings"
        statusLabel="Your node"
        statusPulse={false}
        onRightPress={() => router.back()}
        rightIcon="close"
      />
      <ScreenContainer>
        <Masthead
          eyebrow="Your sanctuary"
          headline="Quiet controls, kept local."
          accent="kept local"
        />

        {/* Profile */}
        <Text style={styles.sectionLabel}>Profile</Text>
        <View style={styles.section}>
          <Row
            icon="person-outline"
            title={auth.displayName || 'Set your name'}
            subtitle="How Memu addresses you"
            onPress={openNameEditor}
          />
        </View>

        {/* Connection */}
        <Text style={styles.sectionLabel}>Connection</Text>
        <View style={styles.section}>
          <Row
            icon="server-outline"
            title="Memu server"
            subtitle={auth.serverUrl || 'Not connected'}
          />
          <Row
            icon="logo-google"
            title="Google Calendar"
            subtitle={isCalendarConnected ? 'Connected (Syncing events)' : 'Connect to sync events'}
            onPress={isCalendarConnected ? handleDisconnectCalendar : handleConnectCalendar}
            destructive={isCalendarConnected}
            disabled={disconnecting}
            right={disconnecting ? <ActivityIndicator size="small" color={colors.error} /> : undefined}
          />
        </View>

        {/* Intelligence */}
        <Text style={styles.sectionLabel}>Intelligence</Text>
        <View style={styles.section}>
          <Row
            icon="radio-outline"
            title="AI Mode"
            subtitle={aiModeInfo.label + ' · ' + aiModeInfo.subtitle}
            onPress={() => setAiModeModal(true)}
          />
          <Row
            icon="sunny-outline"
            title="Morning briefing"
            subtitle={prefs.briefingEnabled ? `${prefs.briefingTime} · every day` : 'Off'}
            onPress={openBriefingEditor}
          />
        </View>

        {/* AI Provider — BYOK (hidden for children) */}
        {!byokIsChild && (
          <>
            <Text style={styles.sectionLabel}>AI provider</Text>
            <View style={styles.section}>
              <Row
                icon="key-outline"
                title="Anthropic API key"
                subtitle={
                  byokAnthropic?.hasKey
                    ? byokAnthropic.enabled
                      ? `Using your key \u00b7 ${byokAnthropic.keyHint ?? ''}`
                      : `Disabled \u00b7 ${byokAnthropic.keyHint ?? ''}`
                    : 'Using deployment key \u00b7 tap to use your own'
                }
                onPress={openBYOKEditor}
              />
            </View>
          </>
        )}

        {/* Context */}
        <Text style={styles.sectionLabel}>Context</Text>
        <View style={styles.section}>
          <Row
            icon="cloud-upload-outline"
            title="Import context"
            subtitle="WhatsApp export, notes, documents"
            onPress={() => router.push('/import')}
          />
          <Row
            icon="library-outline"
            title="Family memory"
            subtitle="Compounded context graph"
            onPress={() => router.push('/memory')}
          />
        </View>

        {/* Household */}
        <Text style={styles.sectionLabel}>Household</Text>
        <View style={styles.section}>
          <Row
            icon="people-outline"
            title="People in this household"
            subtitle="Join, leave, share Spaces from another Pod"
            onPress={() => router.push('/household')}
          />
        </View>

        {/* Privacy */}
        <Text style={styles.sectionLabel}>Privacy</Text>
        <View style={styles.section}>
          <Row
            icon="eye-outline"
            title="Privacy Ledger"
            subtitle="Exactly what the AI received"
            onPress={() => router.push('/ledger')}
          />
          <Row
            icon="shield-checkmark-outline"
            title="Twin Registry"
            subtitle="Names Memu never shares"
            onPress={() => router.push('/twin-registry')}
          />
          <Row
            icon="download-outline"
            title="Export my data"
            subtitle={exporting ? 'Preparing…' : 'Everything you own, as JSON'}
            onPress={handleExportData}
            disabled={exporting}
            right={exporting ? <ActivityIndicator size="small" color={colors.primary} /> : undefined}
          />
          <Row
            icon="trash-outline"
            title="Clear chat history"
            subtitle={clearingChat ? 'Clearing…' : 'Keep spaces and lists'}
            onPress={handleClearChat}
            disabled={clearingChat}
          />
        </View>

        {/* About */}
        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.section}>
          <Row
            icon="information-circle-outline"
            title="Memu"
            subtitle="v0.1.0 — Intelligence without surveillance"
          />
          <Row
            icon="logo-github"
            title="Source code"
            subtitle="AGPLv3 · github.com/kanchanepally/memu-core"
            onPress={() => Linking.openURL('https://github.com/kanchanepally/memu-core')}
          />
          <Row
            icon="globe-outline"
            title="memu.digital"
            onPress={() => Linking.openURL('https://memu.digital')}
          />
          <Row
            icon="mail-outline"
            title="Send feedback"
            subtitle="Tell Hareesh what's broken or missing"
            onPress={handleFeedback}
          />
        </View>

        {/* Account */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.section}>
          <Row
            icon="log-out-outline"
            title="Sign out"
            subtitle="Disconnect from this server"
            onPress={handleLogout}
            destructive
          />
        </View>

        <Text style={styles.footer}>
          Your family's data belongs to your family.
        </Text>
      </ScreenContainer>

      {/* Name editor modal */}
      <Modal visible={nameModal} animationType="slide" transparent onRequestClose={() => setNameModal(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Your name</Text>
            <Text style={styles.modalHint}>Used when Memu greets you.</Text>
            <TextInput
              style={styles.modalInput}
              value={editedName}
              onChangeText={setEditedName}
              placeholder="Your name"
              placeholderTextColor={colors.outline}
              autoFocus
              maxLength={80}
            />
            <View style={styles.modalActions}>
              <GradientButton label="Cancel" variant="ghost" onPress={() => setNameModal(false)} />
              <GradientButton
                label={savingName ? 'Saving…' : 'Save'}
                loading={savingName}
                onPress={handleSaveName}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* AI Mode modal */}
      <Modal visible={aiModeModal} animationType="slide" transparent onRequestClose={() => setAiModeModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>AI Mode</Text>
            <Text style={styles.modalHint}>How much Memu participates in your chats.</Text>
            <View style={styles.optionStack}>
              {(['active', 'quiet', 'off'] as AIMode[]).map(mode => {
                const info = AI_MODE_LABELS[mode];
                const selected = prefs.aiMode === mode;
                return (
                  <Pressable
                    key={mode}
                    style={[styles.optionRow, selected && styles.optionRowSelected]}
                    onPress={() => handleSetAIMode(mode)}
                  >
                    <View style={[styles.optionRadio, selected && styles.optionRadioSelected]}>
                      {selected ? <View style={styles.optionRadioDot} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                        {info.label}
                      </Text>
                      <Text style={styles.optionSubtitle}>{info.subtitle}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.modalActions}>
              <GradientButton label="Done" onPress={() => setAiModeModal(false)} />
            </View>
          </View>
        </View>
      </Modal>

      {/* BYOK modal */}
      <Modal visible={byokModal} animationType="slide" transparent onRequestClose={() => setByokModal(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Anthropic API key</Text>
            <Text style={styles.modalHint}>
              Paste your own key to bill Claude calls to your Anthropic account. Stored encrypted on your Memu server. Remove anytime.
            </Text>

            {byokAnthropic?.hasKey ? (
              <>
                <Text style={styles.modalLabel}>Current key</Text>
                <View style={styles.byokCurrent}>
                  <Text style={styles.byokHint}>{byokAnthropic.keyHint ?? '\u2026'}</Text>
                  <Pressable
                    onPress={() => handleToggleBYOK(!byokAnthropic.enabled)}
                    style={[styles.byokToggle, byokAnthropic.enabled && styles.byokToggleOn]}
                  >
                    <Text style={[styles.byokToggleLabel, byokAnthropic.enabled && styles.byokToggleLabelOn]}>
                      {byokAnthropic.enabled ? 'Enabled' : 'Disabled'}
                    </Text>
                  </Pressable>
                </View>
                <Text style={[styles.modalLabel, { marginTop: spacing.lg }]}>Replace key</Text>
              </>
            ) : null}

            <TextInput
              style={styles.modalInput}
              value={byokInput}
              onChangeText={setByokInput}
              placeholder="sk-ant-\u2026"
              placeholderTextColor={colors.outline}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />

            <View style={styles.modalActions}>
              {byokAnthropic?.hasKey ? (
                <GradientButton label="Remove" variant="ghost" onPress={handleRevokeBYOK} />
              ) : (
                <GradientButton label="Cancel" variant="ghost" onPress={() => setByokModal(false)} />
              )}
              <GradientButton
                label={byokSaving ? 'Saving\u2026' : byokAnthropic?.hasKey ? 'Replace' : 'Save'}
                loading={byokSaving}
                onPress={handleSaveBYOK}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Briefing modal */}
      <Modal visible={briefingModal} animationType="slide" transparent onRequestClose={() => setBriefingModal(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Morning briefing</Text>
            <Text style={styles.modalHint}>
              A push notification each morning with your schedule and stream.
            </Text>
            <Text style={styles.modalLabel}>Time (HH:MM)</Text>
            <TextInput
              style={styles.modalInput}
              value={editedTime}
              onChangeText={setEditedTime}
              placeholder="07:00"
              placeholderTextColor={colors.outline}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />

            <View style={styles.testRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.testLabel}>Send a test briefing now</Text>
                <Text style={styles.testHint}>
                  Runs the full briefing pipeline and pushes it to this device.
                </Text>
              </View>
              <GradientButton
                label={sendingTest ? 'Sending…' : 'Send test'}
                variant="ghost"
                loading={sendingTest}
                onPress={handleSendTestPush}
              />
            </View>

            <View style={styles.modalActions}>
              <GradientButton
                label="Turn off"
                variant="ghost"
                onPress={() => handleSaveBriefing(false, editedTime)}
              />
              <GradientButton
                label="Save"
                onPress={() => handleSaveBriefing(true, editedTime)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },

  sectionLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  section: {
    backgroundColor: colors.surfaceContainerLowest,
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.low,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDestructive: {
    backgroundColor: colors.errorContainer,
    opacity: 0.5,
  },
  rowContent: { flex: 1 },
  rowTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
  },
  rowTitleDestructive: {
    color: colors.error,
  },
  rowSubtitle: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: 2,
    lineHeight: 16,
  },

  footer: {
    textAlign: 'center',
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(12,14,16,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing['2xl'],
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
  modalTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
    marginBottom: spacing.xs,
  },
  modalHint: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  modalLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
    marginBottom: spacing.xs,
  },
  modalInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },

  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  testLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
  },
  testHint: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: 2,
    lineHeight: 16,
  },

  optionStack: {
    gap: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  optionRowSelected: {
    backgroundColor: colors.primaryContainer,
  },
  optionRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionRadioSelected: {
    borderColor: colors.primary,
  },
  optionRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  optionLabel: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
  },
  optionLabelSelected: {
    color: colors.onPrimaryContainer,
  },
  optionSubtitle: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },

  byokCurrent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  byokHint: {
    flex: 1,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    letterSpacing: 1,
  },
  byokToggle: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  byokToggleOn: {
    backgroundColor: colors.primaryContainer,
    borderColor: colors.primary,
  },
  byokToggleLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  byokToggleLabelOn: {
    color: colors.onPrimaryContainer,
  },
});
