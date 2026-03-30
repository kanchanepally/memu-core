import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, typography } from '../../lib/tokens';

interface SettingRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
}

function SettingRow({ icon, title, subtitle, onPress, rightElement }: SettingRowProps) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {rightElement || <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Connection */}
      <Text style={styles.sectionLabel}>Connection</Text>
      <View style={styles.section}>
        <SettingRow
          icon="server-outline"
          title="Server"
          subtitle="localhost:3100"
        />
        <SettingRow
          icon="logo-google"
          title="Google Calendar"
          subtitle="Connect to sync events"
        />
      </View>

      {/* Privacy */}
      <Text style={styles.sectionLabel}>Privacy</Text>
      <View style={styles.section}>
        <SettingRow
          icon="shield-checkmark-outline"
          title="What Claude Saw"
          subtitle="View the Privacy Ledger"
          onPress={() => router.push('/ledger')}
        />
        <SettingRow
          icon="download-outline"
          title="Export My Data"
          subtitle="Download everything as JSON"
        />
      </View>

      {/* AI */}
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
          subtitle="v0.1.0 — Your family's Chief of Staff"
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
  rowContent: { flex: 1 },
  rowTitle: { fontSize: typography.sizes.body, color: colors.text },
  rowSubtitle: { fontSize: typography.sizes.sm, color: colors.textMuted, marginTop: 1 },

  footer: {
    textAlign: 'center', fontSize: typography.sizes.sm,
    color: colors.textMuted, paddingVertical: spacing.xl,
  },
});
