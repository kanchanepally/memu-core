import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, StyleSheet, TextInput, Pressable, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator, ActionSheetIOS, Alert,
 } from 'react-native';
import { Text } from '../../components/ui/Text';
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
import { spacing, radius } from '../../lib/tokens';
import { useTokens } from '../../lib/theme';
import type { Tokens } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import ThinkingPill, { type PillStage } from '../../components/ThinkingPill';
import { useToast } from '../../components/Toast';
import InlineActionNudge, { type NudgeResolutionState } from '../../components/InlineActionNudge';
import { defaultActionsForCardType, type RawCardAction } from '../../lib/cardActions';

interface Message {
  id: string;
  text: string;
  fromMemu: boolean;
  timestamp: Date;
  channel?: string;
  spaces?: ChatMessageSpaceRef[];
  /**
   * Server-tagged type. 'briefing' marks the morning briefing assistant
   * message, rendered with elevated AI-Insight-Card styling inline.
   * 'action_nudge' marks a stream-card surface (Canvas timeline, Phase A.1/A.2):
   * the bubble renders InlineActionNudge with the card's actions. Plain
   * turns leave this null.
   */
  type?: 'briefing' | 'action_nudge' | null;
  /**
   * BUG-16 — this turn failed mid-pipeline. The text field holds an
   * italic placeholder; the renderer styles the bubble as
   * error-toned so the user knows it wasn't a real Memu reply and
   * they should consider retrying. Survives refresh.
   */
  error?: boolean;
  /**
   * Card linkage — present on 'action_nudge' messages. Used by the
   * renderer to dispatch InlineActionNudge and by action handlers to
   * call the right /api/stream/* endpoint.
   */
  streamCardId?: string | null;
  cardTitle?: string | null;
  cardBody?: string | null;
  cardActions?: RawCardAction[] | null;
  /**
   * stream_cards.card_type — used by the renderer to pick an eyebrow
   * label and tone for the nudge bubble. Null when not a card-linked
   * message (normal chat turns).
   */
  cardType?: string | null;
  /**
   * stream_cards.status — 'active'|'resolved'|'dismissed'. Drives the
   * initial nudge state so a card the user resolved on Today still
   * renders as resolved when they scroll back through chat history.
   */
  cardStatus?: string | null;
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

function expandHistoryRows(rows: Array<{
  id: string;
  userMessage: string | null;
  memuResponse: string;
  timestamp: string;
  channel: string;
  spaces?: ChatMessageSpaceRef[];
  type?: 'briefing' | 'action_nudge' | null;
  streamCardId?: string | null;
  cardTitle?: string | null;
  cardBody?: string | null;
  cardActions?: Array<Record<string, unknown>> | null;
  cardType?: string | null;
  cardStatus?: string | null;
  retrievalState?: RetrievalState | null;
  error?: boolean;
}>): Message[] {
  // Three row shapes:
  //   - full turns (user + memu, plain text)
  //   - assistant-only briefings (memu bubble, no paired user prompt)
  //   - assistant-only action nudges (Canvas Phase A — card surface
  //     messages from extraction / reflection / document ingestion;
  //     no paired user prompt either)
  return rows.flatMap(msg => {
    const memuBubble: Message = {
      id: `hist-memu-${msg.id}`,
      text: msg.memuResponse,
      fromMemu: true,
      timestamp: new Date(msg.timestamp),
      channel: msg.channel,
      spaces: msg.spaces,
      type: msg.type ?? null,
      streamCardId: msg.streamCardId ?? null,
      cardTitle: msg.cardTitle ?? null,
      cardBody: msg.cardBody ?? null,
      cardActions: (msg.cardActions ?? null) as RawCardAction[] | null,
      cardType: msg.cardType ?? null,
      cardStatus: msg.cardStatus ?? null,
      retrievalState: msg.retrievalState ?? null,
      error: msg.error === true,
    };
    // Briefings AND action nudges arrive without a paired user message
    // — they're server-generated assistant turns. Render just the bubble.
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
  const t = useTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const params = useLocalSearchParams() as { conversationId?: string; new?: string; seed?: string };
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [layer, setLayer] = useState<Visibility>('family');
  const consumedParamRef = useRef<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const toast = useToast();

  // Resolution state for inline action nudges, keyed by streamCardId.
  // Local-only — the server is the source of truth (status flips on
  // /api/stream/{resolve|dismiss}/action/*). This map is the optimistic
  // mirror so the bubble transitions immediately, then a subsequent
  // history reload confirms persistence. On first paint of a fresh
  // message, the entry is absent → renderer treats it as 'open'.
  const [nudgeStates, setNudgeStates] = useState<Record<string, NudgeResolutionState>>({});

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
    // Phase A.9 — if a `seed` param is present (from Dashboard's
    // "What I'm thinking" starter cards), prefill the input instead of
    // clearing it. The user lands ready-to-send.
    if (typeof params.seed === 'string' && params.seed.length > 0) {
      setInput(params.seed);
    } else {
      setInput('');
    }
    if (key === 'NEW') {
      setMessages([WELCOME]);
      setLoadingHistory(false);
      return;
    }
    loadConversation(key === 'LATEST' ? undefined : key);
  }, [params.conversationId, params.new, params.seed, loadConversation]);

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
          <Text variant="ui" size="xs" color="onSurfaceVariant" style={styles.separatorLabel}>{item.label}</Text>
          <View style={styles.separatorRule} />
        </View>
      );
    }
    const isWhatsApp = item.channel === 'whatsapp';
    const isBriefing = item.fromMemu && item.type === 'briefing';
    // A nudge is anything from Memu that's linked to a stream_card and
    // tagged as an action surface. We no longer require a non-empty
    // cardActions array — empty arrays (backfilled cards, producers
    // that forgot to attach explicit actions) fall back to default
    // Mark done / Dismiss buttons so the bubble never dead-ends.
    const isActionNudge = item.fromMemu
      && item.type === 'action_nudge'
      && !!item.streamCardId;

    // Action-nudge messages (Canvas Phase A.5): the bubble shape stays
    // the same as a normal Memu reply — same avatar, same alignment —
    // but the body is the InlineActionNudge component with a type
    // eyebrow, title + body, and action buttons. Resolution state lives
    // in nudgeStates, keyed by streamCardId, seeded from the server's
    // stream_cards.status so resolved/dismissed cards stay that way.
    if (isActionNudge) {
      const cardId = item.streamCardId!;
      const rawActions = Array.isArray(item.cardActions) && item.cardActions.length > 0
        ? (item.cardActions as RawCardAction[])
        : defaultActionsForCardType(item.cardType);
      const seededState: NudgeResolutionState =
        item.cardStatus === 'resolved'
          ? { kind: 'resolved' }
          : item.cardStatus === 'dismissed'
            ? { kind: 'dismissed' }
            : { kind: 'open' };
      const state = nudgeStates[cardId] ?? seededState;
      return (
        <View style={[styles.row, styles.rowMemu]}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatarGlow} />
            <View style={styles.avatar}>
              <Ionicons name="sparkles" size={14} color={t.brand} />
            </View>
          </View>
          <View style={[styles.bubbleWrap, { alignItems: 'flex-start' }]}>
            <View style={[styles.bubble, styles.bubbleMemu, styles.bubbleNudge]}>
              <InlineActionNudge
                cardId={cardId}
                title={item.cardTitle ?? ''}
                body={item.cardBody ?? ''}
                actions={rawActions}
                cardType={item.cardType}
                state={state}
                onState={(next) => {
                  setNudgeStates(prev => ({ ...prev, [cardId]: next }));
                  if (next.kind === 'resolved' && next.outcome) {
                    toast.show(next.outcome, 'success');
                  }
                }}
                onError={(msg) => toast.show(msg, 'error')}
                onOpenSpace={() => router.push('/(tabs)/spaces' as any)}
              />
            </View>
            <Text variant="ui" size="xs" color="outline" style={styles.timestamp}>{formatTime(item.timestamp)}</Text>
          </View>
        </View>
      );
    }

    // Briefing messages get a wider container + the AI-Insight-Card glow
    // treatment inline. They take the full content width (not the 78%
    // bubble cap) and surface the "Today's brief" eyebrow above the text
    // so they read as a hero artefact within the conversation.
    if (isBriefing) {
      // Phase A.3 — briefings carry suggested_actions in metadata.cardActions.
      // Render an InlineActionNudge below the briefing body so the user can
      // act on the brief inline (Add to calendar / Add to shopping / Update
      // Space / Draft reply) without leaving the chat thread.
      const briefingActions = item.cardActions ?? null;
      const briefingCardId = item.streamCardId ?? null;
      const hasBriefingActions =
        briefingCardId && Array.isArray(briefingActions) && briefingActions.length > 0;
      const briefingState: NudgeResolutionState =
        nudgeStates[briefingCardId ?? ''] ?? { kind: 'open' };
      return (
        <View style={styles.briefingRow}>
          <View style={styles.briefingCard}>
            <View style={styles.briefingGlow} pointerEvents="none" />
            <View style={styles.briefingHeader}>
              <View style={styles.avatar}>
                <Ionicons name="sparkles" size={14} color={t.brand} />
              </View>
              <Text variant="ui" size="xs" color="tertiary" style={styles.briefingEyebrow}>Today's brief</Text>
            </View>
            <Text variant="reading" size="body" color="onSurface" selectable={true} style={styles.briefingBody}>
              {item.text}
            </Text>
            {hasBriefingActions ? (
              <View style={styles.briefingActionsRow}>
                <InlineActionNudge
                  cardId={briefingCardId!}
                  title=""
                  body=""
                  actions={briefingActions as RawCardAction[]}
                  state={briefingState}
                  onState={(next) => {
                    setNudgeStates(prev => ({ ...prev, [briefingCardId!]: next }));
                    if (next.kind === 'resolved' && next.outcome) {
                      toast.show(next.outcome, 'success');
                    }
                  }}
                  onError={(msg) => toast.show(msg, 'error')}
                  onOpenSpace={() => router.push('/(tabs)/spaces' as any)}
                />
              </View>
            ) : null}
            <Text variant="ui" size="xs" color="outline" style={styles.timestamp}>{formatTime(item.timestamp)}</Text>
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
              <Ionicons name="sparkles" size={14} color={t.brand} />
            </View>
          </View>
        ) : null}

        <View style={[styles.bubbleWrap, item.fromMemu ? { alignItems: 'flex-start' } : { alignItems: 'flex-end' }]}>
          {isWhatsApp && !item.fromMemu && (
            <View style={styles.contextBadge}>
              <Ionicons name="logo-whatsapp" size={12} color="#25D366" />
              <Text variant="ui" size="xs" color="outline" style={styles.contextBadgeText}>From WhatsApp</Text>
            </View>
          )}
          {isWhatsApp && item.fromMemu && (
            <View style={styles.contextBadge}>
              <Ionicons name="pencil" size={12} color={t.text3} />
              <Text variant="ui" size="xs" color="outline" style={styles.contextBadgeText}>WhatsApp Draft</Text>
            </View>
          )}

          <View
            style={[
              styles.bubble,
              item.fromMemu ? styles.bubbleMemu : styles.bubbleUser,
              // BUG-16 — error-state bubble. Subtle amber tint so the user
              // can see this WAS a turn they tried but Memu couldn't reach
              // through, not a real reply they should trust.
              item.fromMemu && item.error && styles.bubbleError,
            ]}
          >
            <Text variant="reading" size="body" selectable={true} style={[styles.bubbleText, 
                item.fromMemu ? styles.textMemu : styles.textUser,
                item.fromMemu && item.error && styles.textError,
              ]}>
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
                  <Ionicons name="document-text-outline" size={14} color={t.brand} />
                  <Text variant="ui" size="sm" weight="medium" color="onTertiaryContainer" numberOfLines={1} style={styles.artefactText}>{sp.name}</Text>
                  <Ionicons name="chevron-forward" size={12} color={t.text3} />
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
              <Ionicons name="information-circle-outline" size={12} color={t.text2} />
              <Text variant="ui" size="xs" color="onSurfaceVariant" style={styles.unsourcedText}>
                Memu had no notes for this — answered from general knowledge.
              </Text>
            </View>
          ) : null}

          <View style={styles.metaRow}>
            <Text variant="ui" size="xs" color="outline" style={styles.timestamp}>{formatTime(item.timestamp)}</Text>
            {isWhatsApp && item.fromMemu && (
              <Pressable 
                onPress={() => {
                  Clipboard.setStringAsync(item.text);
                  toast.show('Draft copied to clipboard', 'success');
                }}
                style={styles.copyButton}
              >
                <Ionicons name="copy-outline" size={12} color={t.brand} />
                <Text variant="ui" size="xs" color="primary" style={styles.copyText}>Copy</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    );
    // nudgeStates is in the dep array so InlineActionNudge re-renders
    // when an action transitions (open → busy → resolved). router is in
    // the dep array because the onOpenSpace handler closes over it.
  }, [toast, nudgeStates, router]);

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
              color={layer === 'family' ? '#FFFFFF' : t.text2}
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
              color={layer === 'personal' ? t.brand : t.text2}
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
              <ActivityIndicator size="small" color={t.brand} />
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
          <BlurView intensity={40} tint={t.name === 'dark' ? 'dark' : 'light'} style={styles.inputBarBlur}>
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
                <Ionicons name="camera-outline" size={20} color={t.brand} />
              </Pressable>
              <TextInput
                style={styles.input}
                placeholder="Ask Memu…"
                placeholderTextColor={t.text3}
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
                <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </BlurView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(t: Tokens) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
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
    backgroundColor: t.brandSoft,
    opacity: 0.5,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.brandSoft,
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
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderBottomLeftRadius: radius.sm,
  },
  // Nudge bubbles need a touch more breathing room than a plain reply —
  // the eyebrow + action row stack vertically, and the type icon needs
  // room next to the eyebrow text. Same visual register as a Memu reply
  // overall; the difference is the left rule + eyebrow inside.
  bubbleNudge: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  bubbleUser: {
    backgroundColor: t.brand,
    borderBottomRightRadius: radius.sm,
  },
  // BUG-16 — pipeline-failure bubble. Subtle amber border + tinted
  // background so the eye picks it up as "something happened here" but
  // it doesn't feel alarming. The italic placeholder text is what tells
  // the user what specifically failed.
  bubbleError: {
    backgroundColor: t.amberBg,
    borderWidth: 1,
    borderColor: t.amber,
  },
  bubbleText: {
    lineHeight: 22,
  },
  textMemu: {
    color: t.text,
  },
  textUser: {
    color: '#FFFFFF',
  },
  textError: {
    color: t.amber,
    fontStyle: 'italic',
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
    backgroundColor: t.border,
    opacity: 0.55,
  },
  separatorLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: t.mono,
    color: t.text3,
  },

  // ---- Briefing-typed Memu message — elevated AI-Insight-Card render ----
  briefingRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: 0,
    width: '100%',
    marginBottom: spacing.md,
  },
  briefingCard: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.border,
    borderLeftWidth: 3,
    borderLeftColor: t.brand,
    padding: spacing.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  briefingGlow: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: t.brandSoft,
    opacity: 0.45,
  },
  briefingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  briefingEyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: t.mono,
    color: t.brand,
  },
  briefingBody: {
    lineHeight: 22,
    marginBottom: spacing.sm,
    fontFamily: t.serifItalic,
    color: t.text,
  },
  // Phase A.3 — separates the briefing prose from the inline action
  // buttons. Top border subtly partitions them; preserves the briefing's
  // hero feel while making the actions feel actionable, not decorative.
  briefingActionsRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },

  timestamp: {
    letterSpacing: 0.5,
    fontFamily: t.mono,
    color: t.text3,
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
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: t.brandSoft,
    borderRadius: radius.sm,
  },
  copyText: {
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
    fontSize: 13,
    color: t.text2,
    fontFamily: t.uiRegular,
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.brand,
    opacity: 0.6,
  },

  inputBarWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: Platform.OS === 'ios' ? 100 : 92,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.border,
  },
  inputBarBlur: {
    backgroundColor: t.surface,
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
    fontSize: 15,
    fontFamily: t.uiRegular,
    color: t.text,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: t.brand,
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
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: t.border,
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
    backgroundColor: t.brand,
  },
  layerOptionActivePersonal: {
    backgroundColor: t.brandSoft,
  },
  layerText: {
    fontSize: 11,
    fontFamily: t.mono,
    color: t.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  layerTextActive: {
    color: '#FFFFFF',
  },
  layerTextActivePersonal: {
    color: t.brand,
  },
  layerHint: {
    fontSize: 10,
    fontFamily: t.mono,
    color: t.text3,
    letterSpacing: 0.5,
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
    backgroundColor: t.brandSoft,
    borderRadius: radius.md,
    maxWidth: 280,
  },
  artefactText: {
    flex: 1,
    color: t.brand,
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
    fontStyle: 'italic',
    flexShrink: 1,
    color: t.text3,
  },

  });
}
