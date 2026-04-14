import { Component, type ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import { recordCrash } from '../lib/crashlog';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    recordCrash(error);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleEmail = async () => {
    const err = this.state.error;
    const stack = (err?.stack || err?.message || 'No details').slice(0, 1200);
    const subject = encodeURIComponent('Memu crash — mobile app');
    const body = encodeURIComponent(
      `Hi Hareesh,\n\nMemu just crashed on me. Here's what happened:\n\n---\n${stack}\n---\n\nContext (what I was doing):\n\n\n— Sent from the Memu app`,
    );
    const url = `mailto:hareesh@memu.digital?subject=${subject}&body=${body}`;
    try {
      await Linking.openURL(url);
    } catch {
      // If mailto isn't handled we can't do much else — just reset.
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.iconWrap}>
            <View style={styles.iconGlow} />
            <Ionicons name="leaf-outline" size={28} color={colors.tertiary} />
          </View>

          <Text style={styles.eyebrow}>Something slipped</Text>
          <Text style={styles.title}>Memu hit an unexpected edge.</Text>
          <Text style={styles.body}>
            Nothing left your device. We kept a short note of what happened so you can send it
            to Hareesh if you'd like him to fix it.
          </Text>

          {this.state.error ? (
            <View style={styles.errorBlock}>
              <Text style={styles.errorLabel}>Technical detail</Text>
              <Text style={styles.errorText} numberOfLines={6}>
                {this.state.error.message}
              </Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.85 }]}
            onPress={this.handleReset}
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
            onPress={this.handleEmail}
          >
            <Ionicons name="mail-outline" size={15} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Email Hareesh</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconGlow: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.tertiaryContainer,
    opacity: 0.45,
  },
  eyebrow: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    textAlign: 'center',
  },
  title: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  errorBlock: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.low,
  },
  errorLabel: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
    marginBottom: 4,
  },
  errorText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    letterSpacing: typography.tracking.wide,
  },
  secondaryButton: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
  },
});
