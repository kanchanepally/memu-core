import { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import { loadAuthState } from '../lib/auth';

interface ImportResult {
  totalMessages: number;
  substantiveMessages: number;
  chunksProcessed: number;
  factsExtracted: number;
  duplicatesSkipped: number;
}

async function callImport(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ data?: ImportResult; error?: string }> {
  try {
    const auth = await loadAuthState();
    const res = await fetch(`${auth.serverUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Import failed' }));
      return { error: err.error || `HTTP ${res.status}` };
    }
    return { data: await res.json() };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Network error' };
  }
}

export default function ImportScreen() {
  const [mode, setMode] = useState<'whatsapp' | 'file' | null>(null);
  const [content, setContent] = useState('');
  const [chatName, setChatName] = useState('');
  const [filename, setFilename] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!content.trim()) {
      setError('Paste the file content first');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    let res;
    if (mode === 'whatsapp') {
      res = await callImport('/api/import/whatsapp', {
        content: content.trim(),
        chatName: chatName.trim() || 'WhatsApp Chat',
      });
    } else {
      res = await callImport('/api/import/file', {
        content: content.trim(),
        filename: filename.trim() || 'imported-file.txt',
      });
    }

    setLoading(false);

    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setResult(res.data);
    }
  };

  const reset = () => {
    setMode(null);
    setContent('');
    setChatName('');
    setFilename('');
    setResult(null);
    setError(null);
  };

  // Result screen
  if (result) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        <View style={styles.resultCard}>
          <Ionicons name="checkmark-circle" size={48} color={colors.success} />
          <Text style={styles.resultTitle}>Import complete</Text>

          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Messages parsed</Text>
            <Text style={styles.statValue}>{result.totalMessages}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Substantive messages</Text>
            <Text style={styles.statValue}>{result.substantiveMessages}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Chunks processed</Text>
            <Text style={styles.statValue}>{result.chunksProcessed}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Facts extracted</Text>
            <Text style={[styles.statValue, { color: colors.accent, fontWeight: '700' }]}>
              {result.factsExtracted}
            </Text>
          </View>
          {result.duplicatesSkipped > 0 && (
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Duplicates skipped</Text>
              <Text style={styles.statValue}>{result.duplicatesSkipped}</Text>
            </View>
          )}

          <Text style={styles.resultHint}>
            Memu now knows {result.factsExtracted} new things about you. Try chatting — it'll use them.
          </Text>
        </View>

        <Pressable style={styles.secondaryButton} onPress={reset}>
          <Text style={styles.secondaryButtonText}>Import more</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Mode selection
  if (!mode) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Import context</Text>
        <Text style={styles.subheading}>
          Give Memu a head start by importing your existing conversations, notes, or documents. You can re-import anytime — duplicates are skipped.
        </Text>

        <Pressable style={styles.optionCard} onPress={() => setMode('whatsapp')}>
          <View style={styles.optionIcon}>
            <Ionicons name="logo-whatsapp" size={28} color="#25D366" />
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>WhatsApp export</Text>
            <Text style={styles.optionBody}>
              Export a chat from WhatsApp (tap chat name {'>'} Export chat {'>'} Without media), then paste the .txt content here.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <Pressable style={styles.optionCard} onPress={() => setMode('file')}>
          <View style={styles.optionIcon}>
            <Ionicons name="document-text-outline" size={28} color={colors.sourceDocument} />
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Notes or documents</Text>
            <Text style={styles.optionBody}>
              Paste content from Obsidian notes, text files, journal entries, or any document you want Memu to learn from.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </ScrollView>
    );
  }

  // Import form
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.backRow} onPress={reset}>
          <Ionicons name="arrow-back" size={18} color={colors.textMuted} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Text style={styles.heading}>
          {mode === 'whatsapp' ? 'Import WhatsApp chat' : 'Import notes or documents'}
        </Text>

        {mode === 'whatsapp' ? (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Chat name (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Family Group"
              placeholderTextColor={colors.textMuted}
              value={chatName}
              onChangeText={setChatName}
            />
          </View>
        ) : (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Filename (helps Memu organise)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. garden-plans.md"
              placeholderTextColor={colors.textMuted}
              value={filename}
              onChangeText={setFilename}
            />
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>
            {mode === 'whatsapp'
              ? 'Paste the exported .txt content'
              : 'Paste the file content'}
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={mode === 'whatsapp'
              ? '12/03/2026, 09:15 - Hareesh: ...'
              : 'Paste your notes here...'}
            placeholderTextColor={colors.textMuted}
            value={content}
            onChangeText={(t) => { setContent(t); setError(null); }}
            multiline
            textAlignVertical="top"
          />
          {content.length > 0 && (
            <Text style={styles.charCount}>
              {content.length.toLocaleString()} characters
            </Text>
          )}
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={[styles.primaryButton, loading && styles.buttonDisabled]}
          onPress={handleImport}
          disabled={loading}
        >
          {loading ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.primaryButtonText}>Extracting facts...</Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Import</Text>
            </>
          )}
        </Pressable>

        {loading && (
          <Text style={styles.loadingHint}>
            This can take a minute for large files. Memu is reading through everything and extracting what matters.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingTop: spacing.xl },

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

  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  optionIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.accentLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionText: { flex: 1 },
  optionTitle: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.text,
    marginBottom: 2,
  },
  optionBody: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  backText: { fontSize: typography.sizes.sm, color: colors.textMuted },

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
  textArea: {
    minHeight: 200,
    maxHeight: 400,
    textAlignVertical: 'top',
    paddingTop: spacing.md,
  },
  charCount: {
    fontSize: typography.sizes.xs,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing.xs,
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
    marginTop: spacing.sm,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
  buttonDisabled: { opacity: 0.6 },
  loadingHint: {
    fontSize: typography.sizes.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 20,
  },

  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  resultTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.text,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statLabel: { fontSize: typography.sizes.body, color: colors.textSecondary },
  statValue: { fontSize: typography.sizes.body, color: colors.text, fontWeight: typography.weights.semibold },
  resultHint: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.sm,
  },

  secondaryButton: {
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
});
