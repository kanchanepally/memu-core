import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, FlatList,
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  sendMessageStreaming, sendVision, sendDocument, getChatHistory,
  type ChatMessageSpaceRef,
  type Visibility,
  type StreamHandle,
  type RetrievalState,
} from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import ThinkingPill, { type PillStage } from '../../components/ThinkingPill';
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
  /**
   * BUG-15 honesty signal. 'empty' = no Spaces/recall/fallback fed this
   * reply → Memu is answering from training only; bubble shows an
   * "Unsourced" caption so the reader knows. 'sourced' / 'fallback' /
   * null leave the bubble plain.
   */
  retrievalState?: RetrievalState | null;
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

function expandHistoryRows(rows: Array<{ id: string; userMessage: string | null; memuResponse: string; timestamp: string; channel: string; spaces?: ChatMessageSpaceRef[]; type?: 'briefing' | null; retrievalState?: RetrievalState | null }>): Message[] {
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
      retrievalState: msg.retrievalState ?? null,
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

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams() as { conversationId?: string; new?: string };
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [layer, setLayer] = useState<Visibility>('family');
  const consumedParamRef = useRef<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const toast = useToast();

  const loadConversation = useCallback(async (conversationId?: string) => {
    setLoadingHistory(true);
    const { data } = await getChatHistory(100, conversationId);
    if (data?.messages && data.messages.length > 0) {
      setMessages(expandHistoryRows(data.messages));
    } else {
      setMessages([WELCOME]);
    }
    setLoadingHistory(false);
  }, []);

  // Chat-as-home (2026-05-06): auto-load the most recent conversation on
  // first mount. Subsequent navigations from the side drawer carry either
  // ?conversationId=<id> (open that thread) or ?new=1 (blank welcome).
  // consumedParamRef de-dups so re-render of the same param doesn't loop.
  useEffect(() => {
    const key = params.new === '1' ? 'NEW' : (params.conversationId ?? 'LATEST');
    if (consumedParamRef.current === key) return;
    consumedParamRef.current = key;
    // Bug F — composer state is per-conversation. Clear any draft from
    // the prior thread so the next one opens blank.
    setInput('');
    if (key === 'NEW') {
      setMessages([WELCOME]);
      setLoadingHistory(false);
      return;
    }
    loadConversation(key === 'LATEST' ? undefined : key);
  }, [params.conversationId, params.new, loadConversation]);

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

  // Streaming send (Fix 4 — status ticker).
  //
  // /api/message/stream emits SSE events as the pipeline runs. We drive a
  // small state machine for the "thinking pill" so the user sees Memu's
  // current step in real time — Twin guard → retrieval → routing → tool
  // calls (web search, findSpaces, …) → synthesis → done. The pill morphs
  // in place; the final reply lands when `done` arrives. Replaces the
  // 30-90 second silent block of the old blocking POST.
  const [pillStage, setPillStage] = useState<PillStage | null>(null);
  const [pillTool, setPillTool] = useState<string | undefined>();
  const [pillProvider, setPillProvider] = useState<string | undefined>();
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamHandleRef = useRef<StreamHandle | null>(null);

  // Cancel any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      streamHandleRef.current?.cancel();
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    };
  }, []);

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

    // Optimistic pill within 200ms — UX research is clear: first feedback
    // on screen within ~200ms is what makes the experience feel responsive
    // even when total latency is 30s+. We don't wait for the first SSE
    // event to land before showing something.
    setPillStage('thinking');
    setPillTool(undefined);
    setPillProvider(undefined);

    // After 15s without a final reply, swap pill copy to the "slow" set
    // ("Still on it — this one's worth getting right"). Replaces the
    // "I gave up, came back later" failure mode in the original report.
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    slowTimerRef.current = setTimeout(() => {
      setPillStage(curr => (curr && curr !== 'thinking' ? curr : 'slow'));
    }, 15000);

    let finalised = false;
    const finalise = (
      memuText: string,
      isError = false,
      retrievalState?: RetrievalState | null,
      retrievedSpaces?: ChatMessageSpaceRef[],
    ) => {
      if (finalised) return;
      finalised = true;
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
      setPillStage(null);
      setSending(false);
      streamHandleRef.current = null;
      if (isError) toast.show(`Couldn't reach Memu — ${memuText}`, 'error');
      setMessages(prev => [
        ...prev,
        {
          id: `memu-${Date.now()}`,
          text: memuText,
          fromMemu: true,
          timestamp: new Date(),
          retrievalState: retrievalState ?? null,
          spaces: retrievedSpaces,
        },
      ]);
    };

    streamHandleRef.current = sendMessageStreaming(
      text,
      layer,
      (event) => {
        switch (event.name) {
          case 'twin_check':
            setPillStage('twin_check');
            return;
          case 'retrieving':
            setPillStage('retrieving');
            return;
          case 'routing':
            setPillStage('routing');
            setPillProvider((event.data as { provider?: string }).provider);
            return;
          case 'tool_use':
            setPillStage('tool_use');
            setPillTool((event.data as { tool?: string }).tool);
            return;
          case 'synthesising':
            setPillStage('synthesising');
            setPillTool(undefined);
            return;
          case 'done': {
            const payload = event.data as {
              response?: string;
              retrievalState?: RetrievalState;
              retrievedSpaces?: ChatMessageSpaceRef[];
            };
            finalise(
              payload.response || 'No response.',
              false,
              payload.retrievalState ?? null,
              payload.retrievedSpaces,
            );
            return;
          }
          case 'error': {
            const errMsg = (event.data as { error?: string }).error || 'Pipeline failed';
            finalise(`Couldn't reach Memu: ${errMsg}`, true);
            return;
          }
        }
      },
      (errMsg) => {
        finalise(`Couldn't reach Memu: ${errMsg}`, true);
      },
    );
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

          {/* BUG-15 honesty signal — render an "Unsourced" caption when this
              Memu turn had no Spaces, no recall, no fallback context to draw
              from. The user sees that the reply is from training, not their
              notes. Hidden for non-Memu bubbles, briefings, sourced/fallback
              replies, and legacy (null) messages. */}
          {item.fromMemu && item.retrievalState === 'empty' ? (
            <View style={styles.unsourcedRow}>
              <Ionicons name="information-circle-outline" size={12} color={colors.onSurfaceVariant} />
              <Text style={styles.unsourcedText}>
                Memu had no notes for this — answered from general knowledge.
              </Text>
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

  return (
    <View style={styles.container}>
      <ScreenHeader title="Chat" />

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
            pillStage ? (
              <ThinkingPill
                stage={pillStage}
                tool={pillTool}
                provider={pillProvider}
              />
            ) : (
              <View style={styles.typingRow}>
                <View style={styles.thinkingDot} />
                <Text style={styles.typingText}>Memu is thinking…</Text>
              </View>
            )
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
  // BUG-15 honesty caption — subtle, low-contrast, info icon. Sits below the
  // Memu bubble when retrievalState === 'empty'. Designed to inform without
  // alarming; the goal is "user knows the reply was unsourced", not "Memu is
  // broken" panic.
  unsourcedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 2,
    alignSelf: 'flex-start',
    maxWidth: 320,
  },
  unsourcedText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
    flexShrink: 1,
  },

});
