import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard,
} from 'react-native';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sendMessage, getChatHistory } from '../../lib/api';
import { colors, spacing, radius, typography } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';

interface Message {
  id: string;
  text: string;
  fromMemu: boolean;
  timestamp: Date;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      text: "Good to see you. Ask me anything about your family's day, or tell me something to remember.",
      fromMemu: true,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  // Load chat history from server on mount
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
        // Replace the welcome message with real history
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

    const { data, error } = await sendMessage(text);
    setSending(false);

    const responseText = error
      ? `Something went wrong: ${error}`
      : data?.response || 'No response received.';

    const memuMsg: Message = {
      id: `memu-${Date.now()}`,
      text: responseText,
      fromMemu: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, memuMsg]);
  }, [input, sending]);

  // Scroll to bottom when messages change
  useEffect(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length, sending]);

  // Enter key sends on mobile (not shift+enter)
  const handleKeyPress = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key === 'Enter' && !sending) {
      e.preventDefault?.();
      handleSend();
    }
  }, [handleSend, sending]);

  const formatMessageTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <View style={[styles.messageRow, item.fromMemu ? styles.messageRowMemu : styles.messageRowUser]}>
      {item.fromMemu && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>M</Text>
        </View>
      )}
      <View style={styles.bubbleWrap}>
        <View style={[styles.bubble, item.fromMemu ? styles.bubbleMemu : styles.bubbleUser]}>
          <Text style={[styles.bubbleText, item.fromMemu ? styles.textMemu : styles.textUser]}>
            {item.text}
          </Text>
        </View>
        <Text style={[styles.timestamp, item.fromMemu ? styles.timestampLeft : styles.timestampRight]}>
          {formatMessageTime(item.timestamp)}
        </Text>
      </View>
    </View>
  ), []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScreenHeader title="Chat" />
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.messageList}
        ListHeaderComponent={loadingHistory ? (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.typingText}>Loading conversation...</Text>
          </View>
        ) : null}
        ListFooterComponent={sending ? (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.typingText}>Memu is thinking...</Text>
          </View>
        ) : null}
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Ask Memu anything..."
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          blurOnSubmit={false}
          multiline={true}
          scrollEnabled={true}
          maxLength={10000}
          editable={!sending}
        />
        <Pressable
          style={[styles.sendButton, (!input.trim() || sending) && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Ionicons name="send" size={18} color={colors.textInverse} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  messageList: {
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  messageRowMemu: {
    justifyContent: 'flex-start',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: typography.weights.bold,
    color: colors.accent,
  },
  bubbleWrap: {
    maxWidth: '78%',
  },
  bubble: {
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  bubbleMemu: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleUser: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: radius.sm,
  },
  timestamp: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 3,
    paddingHorizontal: 4,
  },
  timestampLeft: {
    textAlign: 'left',
  },
  timestampRight: {
    textAlign: 'right',
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  textMemu: {
    color: colors.text,
  },
  textUser: {
    color: colors.textInverse,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  typingText: {
    fontSize: typography.sizes.sm,
    color: colors.textMuted,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  sendDisabled: {
    opacity: 0.4,
  },
});
