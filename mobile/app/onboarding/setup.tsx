import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../../lib/tokens';
import { checkServerHealth, register, signInWithGoogle } from '../../lib/api';
import { saveAuthState } from '../../lib/auth';
import { useGoogleSignIn, GOOGLE_ENABLED } from '../../lib/googleAuth';

// Server URL baked in at build time via eas.json `env.EXPO_PUBLIC_API_URL`.
// When present, the setup flow skips the "enter server address" step entirely
// so non-technical users (e.g. Rach) see a clean "what's your name" screen.
const BAKED_SERVER_URL = process.env.EXPO_PUBLIC_API_URL || '';

export default function SetupScreen() {
  const router = useRouter();

  const [serverUrl, setServerUrl] = useState(BAKED_SERVER_URL);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [familyNames, setFamilyNames] = useState('');
  const [step, setStep] = useState<'server' | 'profile'>(
    BAKED_SERVER_URL ? 'profile' : 'server'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverVerified, setServerVerified] = useState(!!BAKED_SERVER_URL);
  const [googleLoading, setGoogleLoading] = useState(false);

  const { request: googleRequest, signIn: googleSignIn } = useGoogleSignIn();

  // If the URL is baked in, silently health-check it on mount so we fail fast
  // with a clear error ("can't reach home server — is Tailscale on?").
  useEffect(() => {
    if (!BAKED_SERVER_URL) return;
    (async () => {
      const { data, error: err } = await checkServerHealth(BAKED_SERVER_URL);
      if (err || data?.status !== 'ok') {
        setError(
          `Can't reach ${BAKED_SERVER_URL}. Check that Tailscale is connected and the home server is running.`
        );
        setServerVerified(false);
      }
    })();
  }, []);

  const normalizeUrl = (url: string) => {
    let u = url.trim();
    // Add protocol if missing
    if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
      u = `https://${u}`;
    }
    // Remove trailing slash
    return u.replace(/\/+$/, '');
  };

  const handleVerifyServer = async () => {
    const url = normalizeUrl(serverUrl);
    if (!url) {
      setError('Enter your Memu server address');
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: err } = await checkServerHealth(url);

    setLoading(false);

    if (err || data?.status !== 'ok') {
      setError(`Can't reach server at ${url}. Check the address and try again.`);
      return;
    }

    setServerUrl(url);
    setServerVerified(true);
    setStep('profile');
  };

  const handleRegister = async () => {
    if (!name.trim()) {
      setError('Enter your name');
      return;
    }

    setLoading(true);
    setError(null);

    const url = normalizeUrl(serverUrl);
    const { data, error: err } = await register(url, name.trim(), email.trim(), familyNames.trim());

    setLoading(false);

    if (err || !data) {
      setError(err || 'Registration failed. Try again.');
      return;
    }

    // Save credentials securely
    await saveAuthState({
      serverUrl: url,
      apiKey: data.apiKey,
      profileId: data.id,
      displayName: data.displayName,
    });

    // Navigate to channels setup
    router.replace('/onboarding/channels');
  };

  const handleGoogleSignIn = async () => {
    if (!serverVerified) {
      setError('Connect to your server first');
      return;
    }
    setGoogleLoading(true);
    setError(null);
    try {
      const idToken = await googleSignIn();
      if (!idToken) {
        setGoogleLoading(false);
        return; // user cancelled
      }
      const url = normalizeUrl(serverUrl);
      const { data, error: err } = await signInWithGoogle(url, idToken);
      if (err || !data) {
        setError(err || 'Google sign-in failed. Try again.');
        setGoogleLoading(false);
        return;
      }
      await saveAuthState({
        serverUrl: url,
        apiKey: data.apiKey,
        profileId: data.id,
        displayName: data.displayName,
      });
      setGoogleLoading(false);
      router.replace('/onboarding/channels');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed');
      setGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Progress */}
        <View style={styles.progress}>
          <View style={[styles.dot, styles.dotActive]} />
          <View style={[styles.dot, step === 'profile' ? styles.dotActive : null]} />
          <View style={styles.dot} />
        </View>

        {step === 'server' ? (
          <>
            <Text style={styles.heading}>Connect to your server</Text>
            <Text style={styles.subheading}>
              Enter the address of your Memu server. Your beta invite email has this.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Server address</Text>
              <TextInput
                style={styles.input}
                placeholder="api.memu.digital"
                placeholderTextColor={colors.textMuted}
                value={serverUrl}
                onChangeText={(t) => { setServerUrl(t); setError(null); }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={handleVerifyServer}
              />
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleVerifyServer}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Connect</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.heading}>Create your profile</Text>
            <Text style={styles.subheading}>
              This is how Memu will know you. Adding your household names here helps the Digital Twin aggressively anonymise them. The cloud AI never learns your real names.
            </Text>

            <View style={styles.serverConfirm}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={styles.serverConfirmText}>
                {BAKED_SERVER_URL ? 'Connected to your home server' : `Connected to ${serverUrl}`}
              </Text>
            </View>

            {GOOGLE_ENABLED && (
              <>
                <Pressable
                  style={[styles.googleButton, (googleLoading || !googleRequest) && styles.buttonDisabled]}
                  onPress={handleGoogleSignIn}
                  disabled={googleLoading || !googleRequest}
                >
                  {googleLoading ? (
                    <ActivityIndicator color={colors.text} size="small" />
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={18} color={colors.text} />
                      <Text style={styles.googleButtonText}>Continue with Google</Text>
                    </>
                  )}
                </Pressable>

                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or set up manually</Text>
                  <View style={styles.dividerLine} />
                </View>
              </>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Your name</Text>
              <TextInput
                style={styles.input}
                placeholder="Hareesh"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={(t) => { setName(t); setError(null); }}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Family names (comma separated)</Text>
              <TextInput
                style={styles.input}
                placeholder="Rach, Robin"
                placeholderTextColor={colors.textMuted}
                value={familyNames}
                onChangeText={(t) => { setFamilyNames(t); setError(null); }}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email (optional — for beta updates)</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(null); }}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="go"
                onSubmitEditing={handleRegister}
              />
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Create profile</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </Pressable>

            {!BAKED_SERVER_URL && (
              <Pressable style={styles.backLink} onPress={() => { setStep('server'); setError(null); }}>
                <Ionicons name="arrow-back" size={14} color={colors.textMuted} />
                <Text style={styles.backLinkText}>Change server</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingTop: spacing['2xl'] },

  progress: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 24,
    borderRadius: 4,
  },

  heading: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subheading: {
    fontSize: typography.sizes.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },

  serverConfirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#f0fdf4',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  serverConfirmText: {
    fontSize: typography.sizes.sm,
    color: colors.success,
    fontWeight: typography.weights.medium,
  },

  inputGroup: { marginBottom: spacing.md },
  label: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: typography.sizes.body,
    color: colors.text,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#fef2f2',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { color: colors.error, fontSize: typography.sizes.sm, flex: 1 },

  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
  buttonDisabled: { opacity: 0.6 },

  googleButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  googleButtonText: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: typography.sizes.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  backLinkText: {
    fontSize: typography.sizes.sm,
    color: colors.textMuted,
  },
});
