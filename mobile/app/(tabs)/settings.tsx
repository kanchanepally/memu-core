import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, typography } from '../../lib/tokens';
import { loadAuthState, clearAuthState } from '../../lib/auth';

interface SettingRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  destructive?: boolean;
}

function SettingRow({ icon, title, subtitle, onPress, rightElement, destructive }: SettingRowProps) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.rowIcon, destructive && styles.rowIconDestructive]}>
        <Ionicons name={icon} size={20} color={destructive ? colors.error : colors.accent} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowTitle, destructive && { color: colors.error }]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {rightElement || <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const [serverUrl, setServerUrl] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    (async () => {
      const auth = await loadAuthState();
      setServerUrl(auth.serverUrl || 'Not connected');
      setDisplayName(auth.displayName || 'Unknown');
    })();
  }, []);

  const handleLogout = () => {
    Alert.alert(
      'Sign out',
      'This will remove your connection to the server. You can sign back in anytime.',
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile */}
      <Text style={styles.sectionLabel}>Profile</Text>
      <View style={styles.section}>
        <SettingRow
          icon="person-outline"
          title={displayName}
          subtitle="Your profile"
        />
      </View>

      {/* Connection */}
      <Text style={styles.sectionLabel}>Connection</Text>
      <View style={styles.section}>
        <SettingRow
          icon="server-outline"
          title="Server"
          subtitle={serverUrl}
        />
        <SettingRow
          icon="logo-google"
          title="Google Calendar"
          subtitle="Connect to sync events"
        />
      </View>

      {/* Context */}
      <Text style={styles.sectionLabel}>Context</Text>
      <View style={styles.section}>
        <SettingRow
          icon="cloud-upload-outline"
          title="Import Context"
          subtitle="WhatsApp exports, Obsidian notes, documents"
          onPress={() => router.push('/import')}
        />
      </View>

      {/* Privacy */}
      <Text style={styles.sectionLabel}>Privacy</Text>
      <View style={styles.section}>
        <SettingRow
          icon="library-outline"
          title="Family Memory"
          subtitle="View compounded context graph"
          onPress={() => router.push('/memory')}
        />
        <SettingRow
          icon="eye-outline"
          title="What AI Saw"
          subtitle="View the Privacy Ledger"
          onPress={() => router.push('/ledger')}
        />
        <SettingRow
          icon="download-outline"
          title="Export My Data"
          subtitle="Download everything as JSON"
        />
      </View>

      {/* Intelligence */}
      <Text style={styles.sectionLabel}>Intelligence</Text>
      <View style={styles.section}>
        <SettingRow
          icon="volume-medium-outline"
          title="AI Mode"
          subtitle="Active"
        />
        <SettingRow
          icon="time-outline"
          title="Morning Briefing"
          subtitle="07:00 daily"
        />
      </View>

      {/* About */}
      <Text style={styles.sectionLabel}>About</Text>
      <View style={styles.section}>
        <SettingRow
          icon="information-circle-outline"
          title="Memu"
          subtitle="v0.1.0 — Intelligence without surveillance"
        />
        <SettingRow
          icon="logo-github"
          title="Source Code"
          subtitle="AGPLv3 — Open Source"
          onPress={() => Linking.openURL('https://github.com/kanchanepally/memu-core')}
        />
        <SettingRow
          icon="globe-outline"
          title="memu.digital"
          onPress={() => Linking.openURL('https://memu.digital')}
        />
      </View>

      {/* Account */}
      <Text style={styles.sectionLabel}>Account</Text>
      <View style={styles.section}>
        <SettingRow
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: spacing.xl * 2 },

  sectionLabel: {
    fontSize: typography.sizes.xs, fontWeight: typography.weights.semibold,
    color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm,
  },
  section: {
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: colors.accentLight,
    justifyContent: 'center', alignItems: 'center',
  },
  rowIconDestructive: {
    backgroundColor: '#fef2f2',
  },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: typography.sizes.body, color: colors.text },
  rowSubtitle: { fontSize: typography.sizes.sm, color: colors.textMuted, marginTop: 1 },

  footer: {
    textAlign: 'center', fontSize: typography.sizes.sm,
    color: colors.textMuted, paddingVertical: spacing.xl,
  },
});
