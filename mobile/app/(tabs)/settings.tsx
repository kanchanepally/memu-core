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
} from '../../lib/api';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenContainer from '../../components/ScreenContainer';
import Masthead from '../../components/Masthead';
import GradientButton from '../../components/GradientButton';

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
  const [exporting, setExporting] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);

  const refresh = useCallback(async () => {
    const [authState, loadedPrefs] = await Promise.all([loadAuthState(), loadPrefs()]);
    setAuth({ serverUrl: authState.serverUrl, displayName: authState.displayName });
    setPrefs(loadedPrefs);
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
    const { data, error } = await getGoogleAuthUrl();
    if (error) return Alert.alert('Could not start auth', error);
    if (data?.url) await Linking.openURL(data.url);
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
            subtitle="Connect to sync events"
            onPress={handleConnectCalendar}
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
});
