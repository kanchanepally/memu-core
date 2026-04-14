import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { sendMessage, getChatHistory, type Visibility } from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import { useToast } from '../../components/Toast';

interface Message {
  id: string;
  text: string;
  fromMemu: boolean;
  timestamp: Date;
}

const WELCOME: Message = {
  id: 'welcome',
  text: "I'm here. Ask me anything — a reminder, a question, or just think out loud.",
  fromMemu: true,
  timestamp: new Date(),
};

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [layer, setLayer] = useState<Visibility>('family');
  const flatListRef = useRef<FlatList>(null);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      const { data } = await getChatHistory();
      if (data?.messages && data.messages.length > 0) {
        const restored: Message[] = [];
        for (const msg of data.messages) {
          restored.push({
            id: `hist-user-${msg.id}`,
            text: msg.userMessage,
            fromMemu: false,
            timestamp: new Date(msg.timestamp),
          });
          restored.push({
            id: `hist-memu-${msg.id}`,
            text: msg.memuResponse,
            fromMemu: true,
            timestamp: new Date(msg.timestamp),
          });
        }
        setMessages(restored);
      }
      setLoadingHistory(false);
    })();
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      text,
      fromMemu: false,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    const { data, error } = await sendMessage(text, layer);
    setSending(false);

    if (error) {
      toast.show(`Couldn't reach Memu — ${error}`, 'error');
    }

    const memuMsg: Message = {
      id: `memu-${Date.now()}`,
      text: error ? `Couldn't reach Memu: ${error}` : (data?.response || 'No response.'),
      fromMemu: true,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, memuMsg]);
  }, [input, sending, layer, toast]);

  useEffect(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length, sending]);

  const handleKeyPress = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key === 'Enter' && !sending) {
      e.preventDefault?.();
      handleSend();
    }
  }, [handleSend, sending]);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <View style={[styles.row, item.fromMemu ? styles.rowMemu : styles.rowUser]}>
      {item.fromMemu ? (
        <View style={styles.avatarWrap}>
          <View style={styles.avatarGlow} />
          <View style={styles.avatar}>
            <Ionicons name="sparkles" size={14} color={colors.tertiary} />
          </View>
        </View>
      ) : null}

      <View style={[styles.bubbleWrap, item.fromMemu ? { alignItems: 'flex-start' } : { alignItems: 'flex-end' }]}>
        <View style={[styles.bubble, item.fromMemu ? styles.bubbleMemu : styles.bubbleUser]}>
          <Text style={[styles.bubbleText, item.fromMemu ? styles.textMemu : styles.textUser]}>
            {item.text}
          </Text>
        </View>
        <Text style={styles.timestamp}>{formatTime(item.timestamp)}</Text>
      </View>
    </View>
  ), []);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Chat" statusLabel="Private" statusPulse={false} />

      <View style={styles.layerStrip}>
        <View style={styles.layerSegment}>
          <Pressable
            style={[styles.layerOption, layer === 'family' && styles.layerOptionActive]}
            onPress={() => setLayer('family')}
            accessibilityLabel="Use family context"
          >
            <Ionicons
              name="people-outline"
              size={13}
              color={layer === 'family' ? colors.onPrimary : colors.onSurfaceVariant}
            />
            <Text style={[styles.layerText, layer === 'family' && styles.layerTextActive]}>
              Family
            </Text>
          </Pressable>
          <Pressable
            style={[styles.layerOption, layer === 'personal' && styles.layerOptionActivePersonal]}
            onPress={() => setLayer('personal')}
            accessibilityLabel="Use personal context only"
          >
            <Ionicons
              name="person-outline"
              size={13}
              color={layer === 'personal' ? colors.onTertiaryContainer : colors.onSurfaceVariant}
            />
            <Text style={[styles.layerText, layer === 'personal' && styles.layerTextActivePersonal]}>
              Personal
            </Text>
          </Pressable>
        </View>
        <Text style={styles.layerHint}>
          {layer === 'personal'
            ? 'Only facts you own are in context.'
            : 'Shared family memory is in context.'}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={loadingHistory ? (
            <View style={styles.typingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.typingText}>Loading your conversation…</Text>
            </View>
          ) : null}
          ListFooterComponent={sending ? (
            <View style={styles.typingRow}>
              <View style={styles.thinkingDot} />
              <Text style={styles.typingText}>Memu is thinking…</Text>
            </View>
          ) : null}
        />

        <View style={styles.inputBarWrap}>
          <BlurView intensity={40} tint="light" style={styles.inputBarBlur}>
            <View style={styles.inputBar}>
              <TextInput
                style={styles.input}
                placeholder="Ask Memu…"
                placeholderTextColor={colors.outline}
                value={input}
                onChangeText={setInput}
                onKeyPress={handleKeyPress}
                blurOnSubmit={false}
                multiline
                scrollEnabled
                maxLength={10000}
                editable={!sending}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.sendButton,
                  (!input.trim() || sending) && styles.sendDisabled,
                  pressed && { transform: [{ scale: 0.95 }] },
                ]}
                onPress={handleSend}
                disabled={!input.trim() || sending}
                accessibilityLabel="Send message"
              >
                <Ionicons name="arrow-up" size={18} color={colors.onPrimary} />
              </Pressable>
            </View>
          </BlurView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  list: {
    padding: spacing.md,
    paddingBottom: 140,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  rowMemu: { justifyContent: 'flex-start' },
  rowUser: { justifyContent: 'flex-end' },

  avatarWrap: {
    width: 32,
    height: 32,
    marginBottom: 18,
    position: 'relative',
  },
  avatarGlow: {
    position: 'absolute',
    top: -4,
    left: -4,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.tertiaryContainer,
    opacity: 0.5,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.tertiaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },

  bubbleWrap: {
    maxWidth: '78%',
  },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  bubbleMemu: {
    backgroundColor: colors.surfaceContainerLowest,
    borderBottomLeftRadius: radius.sm,
    ...shadows.low,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.sm,
  },
  bubbleText: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    lineHeight: 22,
  },
  textMemu: {
    color: colors.onSurface,
  },
  textUser: {
    color: colors.onPrimary,
  },
  timestamp: {
    fontSize: 10,
    color: colors.outline,
    marginTop: 4,
    paddingHorizontal: 6,
    fontFamily: typography.families.label,
    letterSpacing: typography.tracking.wide,
  },

  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  typingText: {
    fontSize: typography.sizes.sm,
    color: colors.onSurfaceVariant,
    fontFamily: typography.families.body,
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.tertiary,
    opacity: 0.6,
  },

  inputBarWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: Platform.OS === 'ios' ? 100 : 92,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.medium,
  },
  inputBarBlur: {
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  sendDisabled: {
    opacity: 0.35,
  },

  layerStrip: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: 6,
  },
  layerSegment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.pill,
    padding: 3,
    alignSelf: 'flex-start',
    gap: 2,
  },
  layerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  layerOptionActive: {
    backgroundColor: colors.primary,
  },
  layerOptionActivePersonal: {
    backgroundColor: colors.tertiaryContainer,
  },
  layerText: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },
  layerTextActive: {
    color: colors.onPrimary,
  },
  layerTextActivePersonal: {
    color: colors.onTertiaryContainer,
  },
  layerHint: {
    fontSize: 10,
    fontFamily: typography.families.label,
    color: colors.outline,
    letterSpacing: typography.tracking.wide,
    paddingLeft: 2,
  },
});
