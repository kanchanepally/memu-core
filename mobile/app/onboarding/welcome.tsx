import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../../lib/tokens';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.iconCircle}>
          <Ionicons name="people" size={48} color={colors.accent} />
        </View>
        <Text style={styles.title}>Memu</Text>
        <Text style={styles.subtitle}>Intelligence without surveillance</Text>
      </View>

      <View style={styles.features}>
        <Feature
          icon="chatbubble-outline"
          title="Ask anything"
          body="A private AI that learns about you — without ever knowing your name."
        />
        <Feature
          icon="sunny-outline"
          title="Stay on top of your day"
          body="Morning briefings, smart reminders, and proactive suggestions."
        />
        <Feature
          icon="eye-off-outline"
          title="See what the AI sees"
          body="The Privacy Ledger shows you exactly what was sent — anonymised, every time."
        />
      </View>

      <View style={styles.bottom}>
        <Pressable style={styles.primaryButton} onPress={() => router.push('/onboarding/setup')}>
          <Text style={styles.primaryButtonText}>Get started</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

function Feature({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={22} color={colors.accent} />
      </View>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing['2xl'],
    gap: spacing.sm,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.accentLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.sizes['3xl'],
    fontWeight: typography.weights.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.sizes.body,
    color: colors.textSecondary,
  },
  features: {
    gap: spacing.lg,
    paddingVertical: spacing.xl,
  },
  feature: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  featureText: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  featureBody: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  bottom: {
    paddingBottom: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
});
