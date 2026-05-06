import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, FlatList, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, ActionSheetIOS, Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
// `expo-file-system` v19 moved the flat read/write functions to a /legacy
// subpath while introducing a new class-based File API at the top level.
// The legacy API is stable, well-documented, and gives us
// readAsStringAsync({ encoding: Base64 }) directly. The class API would
// require fetching as Blob then base64-encoding manually — same behaviour,
// more code. Stick with legacy until there's a reason to migrate.
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import {
  sendMessage, sendVision, sendDocument, getChatHistory,
  listConversations, type ConversationSummary, type ChatMessageSpaceRef,
  type Visibility,
} from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import { useToast } from '../../components/Toast';

interface Message {
  id: string;
  text: string;
  fromMemu: boolean;
  timestamp: Date;
  channel?: string;
  spaces?: ChatMessageSpaceRef[];
  /**
   * Server-tagged type. 'briefing' marks the morning briefing assistant
   * message, rendered with elevated AI-Insight-Card styling inline. Plain
   * turns leave this null.
   */
  type?: 'briefing' | null;
}

interface DaySeparator {
  kind: 'separator';
  id: string;
  label: string;
}
type ChatItem = (Message & { kind: 'msg' }) | DaySeparator;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function daySeparatorLabel(d: Date): string {
  const today = new Date();
  if (dayKey(d) === dayKey(today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function withDaySeparators(messages: Message[]): ChatItem[] {
  const out: ChatItem[] = [];
  let lastDay: string | null = null;
  for (const m of messages) {
    const key = dayKey(m.timestamp);
    if (key !== lastDay) {
      out.push({ kind: 'separator', id: `sep-${key}`, label: daySeparatorLabel(m.timestamp) });
      lastDay = key;
    }
    out.push({ kind: 'msg', ...m });
  }
  return out;
}

const WELCOME: Message = {
  id: 'welcome',
  text:
    "Hey — I'm Memu, your private AI. Tell me what's on your mind and I'll start learning. " +
    "Everything you share stays on your device. When I talk to the AI, your names and personal " +
    "details are replaced with anonymous labels first. You can check exactly what was sent any " +
    "time in the Privacy Ledger.",
  fromMemu: true,
  timestamp: new Date(),
};

function expandHistoryRows(rows: Array<{ id: string; userMessage: string | null; memuResponse: string; timestamp: string; channel: string; spaces?: ChatMessageSpaceRef[]; type?: 'briefing' | null }>): Message[] {
  // Two row shapes: full turns (user + memu) and assistant-only (briefing).
  // Briefings carry no user message — render just the memu bubble.
  return rows.flatMap(msg => {
    const memuBubble: Message = {
      id: `hist-memu-${msg.id}`,
      text: msg.memuResponse,
      fromMemu: true,
      timestamp: new Date(msg.timestamp),
      channel: msg.channel,
      spaces: msg.spaces,
      type: msg.type ?? null,
    };
    if (!msg.userMessage) return [memuBubble];
    return [
      {
        id: `hist-user-${msg.id}`,
        text: msg.userMessage,
        fromMemu: false,
        timestamp: new Date(msg.timestamp),
        channel: msg.channel,
      },
      memuBubble,
    ];
  });
}

function formatThreadDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function ChatScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [layer, setLayer] = useState<Visibility>('family');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const toast = useToast();

  const loadConversation = useCallback(async (conversationId?: string) => {
    setLoadingHistory(true);
    const { data } = await getChatHistory(100, conversationId);
    if (data?.messages && data.messages.length > 0) {
      setMessages(expandHistoryRows(data.messages));
      setActiveConversationId(data.conversationId ?? conversationId ?? null);
    } else {
      setMessages([WELCOME]);
      setActiveConversationId(conversationId ?? null);
    }
    setLoadingHistory(false);
  }, []);

  const loadConversations = useCallback(async () => {
    const { data } = await listConversations();
    if (data?.conversations) setConversations(data.conversations);
  }, []);

  // Chat-as-home (2026-05-06): auto-load the most recent conversation on
  // open so the user lands on something live — typically today's briefing
  // for the morning push, or the most recent thread otherwise. The "blank
  // chat with threads on the left" flow remains available via the New chat
  // button. First-use users (no conversations yet) see the welcome bubble.
  useEffect(() => {
    loadConversation();
    loadConversations();
  }, [loadConversation, loadConversations]);

  const handlePickConversation = useCallback(async (id: string) => {
    setHistoryOpen(false);
    if (id === activeConversationId) return;
    await loadConversation(id);
  }, [activeConversationId, loadConversation]);

  const handleNewConversation = useCallback(() => {
    setHistoryOpen(false);
    setMessages([WELCOME]);
    setActiveConversationId(null);
    // Backend rolls a new conversation automatically when there's a 30-min gap
    // OR no active conversation — sending the next message creates one.
  }, []);

  const sendImage = useCallback(async (base64: string, mimeType: string, caption: string) => {
    const userMsg = {
      id: `user-img-${Date.now()}`,
      text: caption ? `📷 ${caption}` : '📷 Photo',
      fromMemu: false,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    const { data, error } = await sendVision(base64, mimeType, caption);
    setSending(false);

    if (error) toast.show(`Couldn't send photo — ${error}`, 'error');

    const memuMsg = {
      id: `memu-img-${Date.now()}`,
      text: error ? `Couldn't send photo: ${error}` : (data?.response || 'No response.'),
      fromMemu: true,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, memuMsg]);
  }, [toast]);

  const handlePhotoPicked = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    try {
      const caption = input.trim();
      setInput('');
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) {
        toast.show("Couldn't read that photo.", 'error');
        return;
      }
      await sendImage(manipulated.base64, 'image/jpeg', caption);
    } catch (err) {
      toast.show('Photo processing failed.', 'error');
    }
  }, [input, sendImage, toast]);

  const pickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.show('Photo library permission is required.', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      await handlePhotoPicked(result.assets[0]);
    }
  }, [handlePhotoPicked, toast]);

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      toast.show('Camera permission is required.', 'error');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      await handlePhotoPicked(result.assets[0]);
    }
  }, [handlePhotoPicked, toast]);

  // Document upload — kitchen reality is "PDF arrived in email or in
  // Downloads, send it to Memu." Document picker opens the OS file
  // browser; user picks a PDF or .txt. Same chat-input-as-caption pattern
  // as photos: whatever the user has typed becomes the caption.
  // Constraints: max 25MB inbound (same as backend cap). PDF + plain
  // text only; .docx / mammoth deferred. Images caught here are routed
  // back to the photo flow with a one-line note rather than failing.
  const pickDocument = useCallback(async () => {
    if (sending) return;
    try {
      const caption = input.trim();
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > 25 * 1024 * 1024) {
        toast.show('File too large (max 25MB).', 'error');
        return;
      }

      const fileName = asset.name || 'document';
      const declaredMime = asset.mimeType || 'application/octet-stream';
      // expo-document-picker returns a content:// or file:// URI on
      // Android, file:// on iOS. expo-file-system reads either.
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!base64) {
        toast.show("Couldn't read the file.", 'error');
        return;
      }

      // Show what the user said (or a fallback marker) immediately, then
      // route to /api/document. Same UX shape as sendImage.
      setInput('');
      const userMsg = {
        id: `user-doc-${Date.now()}`,
        text: caption ? `📄 ${fileName} — ${caption}` : `📄 ${fileName}`,
        fromMemu: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMsg]);
      setSending(true);

      const { data, error } = await sendDocument(base64, fileName, declaredMime);
      setSending(false);

      let memuText: string;
      if (error || !data) {
        toast.show(`Couldn't process document — ${error ?? 'unknown error'}`, 'error');
        memuText = `Couldn't process that document: ${error ?? 'unknown error'}.`;
      } else {
        const truncatedNote = data.truncated ? ' (truncated for processing)' : '';
        const cardNote = data.streamCardCount > 0
          ? ` and ${data.streamCardCount} stream card${data.streamCardCount === 1 ? '' : 's'} on your today screen`
          : '';
        memuText =
          `Got it. Saved as a Space — **${data.spaceTitle}** ` +
          `(${data.docType.replace(/_/g, ' ')}, ${data.charCount.toLocaleString()} chars${truncatedNote})${cardNote}.`;
      }
      const memuMsg = {
        id: `memu-doc-${Date.now()}`,
        text: memuText,
        fromMemu: true,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, memuMsg]);
    } catch (err) {
      setSending(false);
      const message = err instanceof Error ? err.message : 'Document upload failed';
      toast.show(message, 'error');
    }
  }, [input, sending, toast]);

  const handleAttach = useCallback(() => {
    if (sending) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take photo', 'Choose from library', 'Pick a document'],
          cancelButtonIndex: 0,
        },
        idx => {
          if (idx === 1) takePhoto();
          else if (idx === 2) pickFromLibrary();
          else if (idx === 3) pickDocument();
        },
      );
    } else {
      Alert.alert('Add attachment', 'What from?', [
        { text: 'Camera', onPress: takePhoto },
        { text: 'Photo library', onPress: pickFromLibrary },
        { text: 'Document (PDF / text)', onPress: pickDocument },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [sending, takePhoto, pickFromLibrary, pickDocument]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg = {
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

    const memuMsg = {
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

  const renderMessage = useCallback(({ item }: { item: ChatItem }) => {
    if (item.kind === 'separator') {
      return (
        <View style={styles.separatorRow}>
          <View style={styles.separatorRule} />
          <Text style={styles.separatorLabel}>{item.label}</Text>
          <View style={styles.separatorRule} />
        </View>
      );
    }
    const isWhatsApp = item.channel === 'whatsapp';
    const isBriefing = item.fromMemu && item.type === 'briefing';

    // Briefing messages get a wider container + the AI-Insight-Card glow
    // treatment inline. They take the full content width (not the 78%
    // bubble cap) and surface the "Today's brief" eyebrow above the text
    // so they read as a hero artefact within the conversation.
    if (isBriefing) {
      return (
        <View style={styles.briefingRow}>
          <View style={styles.briefingCard}>
            <View style={styles.briefingGlow} pointerEvents="none" />
            <View style={styles.briefingHeader}>
              <View style={styles.avatar}>
                <Ionicons name="sparkles" size={14} color={colors.tertiary} />
              </View>
              <Text style={styles.briefingEyebrow}>Today's brief</Text>
            </View>
            <Text selectable={true} style={styles.briefingBody}>
              {item.text}
            </Text>
            <Text style={styles.timestamp}>{formatTime(item.timestamp)}</Text>
          </View>
        </View>
      );
    }

    return (
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
          {isWhatsApp && !item.fromMemu && (
            <View style={styles.contextBadge}>
              <Ionicons name="logo-whatsapp" size={12} color="#25D366" />
              <Text style={styles.contextBadgeText}>From WhatsApp</Text>
            </View>
          )}
          {isWhatsApp && item.fromMemu && (
            <View style={styles.contextBadge}>
              <Ionicons name="pencil" size={12} color={colors.outline} />
              <Text style={styles.contextBadgeText}>WhatsApp Draft</Text>
            </View>
          )}

          <View style={[styles.bubble, item.fromMemu ? styles.bubbleMemu : styles.bubbleUser]}>
            <Text
              selectable={true}
              style={[styles.bubbleText, item.fromMemu ? styles.textMemu : styles.textUser]}
            >
              {item.text}
            </Text>
          </View>

          {item.fromMemu && item.spaces && item.spaces.length > 0 ? (
            <View style={styles.artefactStack}>
              {item.spaces.map(sp => (
                <Pressable
                  key={sp.id}
                  style={({ pressed }) => [styles.artefactChip, pressed && { opacity: 0.6 }]}
                  onPress={() => router.push(`/(tabs)/spaces?focus=${sp.slug}` as any)}
                >
                  <Ionicons name="document-text-outline" size={14} color={colors.tertiary} />
                  <Text style={styles.artefactText} numberOfLines={1}>{sp.name}</Text>
                  <Ionicons name="chevron-forward" size={12} color={colors.outline} />
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.metaRow}>
            <Text style={styles.timestamp}>{formatTime(item.timestamp)}</Text>
            {isWhatsApp && item.fromMemu && (
              <Pressable 
                onPress={() => {
                  Clipboard.setStringAsync(item.text);
                  toast.show('Draft copied to clipboard', 'success');
                }}
                style={styles.copyButton}
              >
                <Ionicons name="copy-outline" size={12} color={colors.primary} />
                <Text style={styles.copyText}>Copy</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    );
  }, [toast]);

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={activeConversation?.title || 'New chat'}
        rightIcon="time-outline"
        onRightPress={() => setHistoryOpen(true)}
      />

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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={withDaySeparators(messages)}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={loadingHistory ? (
            <View style={styles.typingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.typingText}>Loading conversation…</Text>
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
              <Pressable
                style={({ pressed }) => [
                  styles.attachButton,
                  sending && styles.sendDisabled,
                  pressed && { transform: [{ scale: 0.95 }] },
                ]}
                onPress={handleAttach}
                disabled={sending}
                accessibilityLabel="Attach photo"
              >
                <Ionicons name="camera-outline" size={20} color={colors.primary} />
              </Pressable>
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

      {/* Conversations panel — slides in from the left, lists past
          conversations with previews + dates. "New chat" at the top
          resets the screen to the blank welcome state. */}
      <Modal
        visible={historyOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setHistoryOpen(false)}
      >
        <Pressable style={styles.historyBackdrop} onPress={() => setHistoryOpen(false)} />
        <View style={styles.historyPanel}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Conversations</Text>
            <Pressable onPress={() => setHistoryOpen(false)} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          <Pressable
            style={({ pressed }) => [styles.newChatRow, pressed && { opacity: 0.6 }]}
            onPress={handleNewConversation}
          >
            <Ionicons name="create-outline" size={18} color={colors.primary} />
            <Text style={styles.newChatText}>New chat</Text>
          </Pressable>

          <View style={styles.historyDivider} />

          <FlatList
            data={conversations}
            keyExtractor={c => c.id}
            ListEmptyComponent={
              <View style={styles.historyEmpty}>
                <Text style={styles.historyEmptyText}>No conversations yet.</Text>
                <Text style={styles.historyEmptyHint}>Send your first message to start one.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isActive = item.id === activeConversationId;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.historyRow,
                    isActive && styles.historyRowActive,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => handlePickConversation(item.id)}
                >
                  <Text style={styles.historyRowTitle} numberOfLines={1}>
                    {item.title || 'New conversation'}
                  </Text>
                  <View style={styles.historyRowMeta}>
                    <Text style={styles.historyRowDate}>
                      {formatThreadDate(item.lastMessageAt || item.startedAt)}
                    </Text>
                    {item.messageCount > 0 ? (
                      <Text style={styles.historyRowCount}>{item.messageCount}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
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

  // ---- Day separator within a thread — "Today" / "Yesterday" / "Mon 4 May" ----
  separatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  separatorRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.outlineVariant,
    opacity: 0.35,
  },
  separatorLabel: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.wide,
  },

  // ---- Briefing-typed Memu message — elevated AI-Insight-Card render ----
  briefingRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: 0,
    width: '100%',
    marginBottom: spacing.md,
  },
  briefingCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    overflow: 'hidden',
    position: 'relative',
    ...shadows.high,
  },
  briefingGlow: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.tertiaryContainer,
    opacity: 0.45,
  },
  briefingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  briefingEyebrow: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  briefingBody: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },

  timestamp: {
    fontSize: 10,
    color: colors.outline,
    fontFamily: typography.families.label,
    letterSpacing: typography.tracking.wide,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 6,
    gap: 12,
  },
  contextBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    paddingHorizontal: 6,
  },
  contextBadgeText: {
    fontSize: 10,
    color: colors.outline,
    fontFamily: typography.families.label,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.sm,
  },
  copyText: {
    fontSize: 10,
    color: colors.primary,
    fontFamily: typography.families.label,
    textTransform: 'uppercase',
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
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
    backgroundColor: 'transparent',
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

  // ---- Inline Space artefacts (chips below Memu's bubble) ----
  artefactStack: {
    marginTop: 6,
    gap: 4,
    alignSelf: 'flex-start',
  },
  artefactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.tertiaryContainer,
    borderRadius: radius.md,
    maxWidth: 280,
  },
  artefactText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onTertiaryContainer,
  },

  // ---- Conversations panel (left slide-in) ----
  historyBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,17,40,0.45)',
  },
  historyPanel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '82%',
    maxWidth: 320,
    backgroundColor: colors.surface,
    paddingTop: Platform.OS === 'android' ? 32 : 56,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    ...shadows.medium,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  historyTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.headline,
    color: colors.onSurface,
    letterSpacing: typography.tracking.tight,
  },
  newChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    marginVertical: spacing.sm,
  },
  newChatText: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
  },
  historyDivider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    marginVertical: spacing.sm,
    marginHorizontal: spacing.sm,
  },
  historyRow: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    marginBottom: 2,
  },
  historyRowActive: {
    backgroundColor: colors.surfaceContainerLow,
  },
  historyRowTitle: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.body,
    color: colors.onSurface,
  },
  historyRowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  historyRowDate: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.label,
    color: colors.onSurfaceVariant,
  },
  historyRowCount: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.label,
    color: colors.outline,
  },
  historyEmpty: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  historyEmptyText: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  historyEmptyHint: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.outline,
    marginTop: 4,
  },
});
