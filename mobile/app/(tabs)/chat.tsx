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
import { sendMessage, sendVision, sendDocument, getChatHistory, type Visibility } from '../../lib/api';
import { colors, spacing, radius, typography, shadows } from '../../lib/tokens';
import ScreenHeader from '../../components/ScreenHeader';
import { useToast } from '../../components/Toast';

interface Message {
  id: string;
  text: string;
  fromMemu: boolean;
  timestamp: Date;
  channel?: string;
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
            channel: msg.channel,
          });
          restored.push({
            id: `hist-memu-${msg.id}`,
            text: msg.memuResponse,
            fromMemu: true,
            timestamp: new Date(msg.timestamp),
            channel: msg.channel,
          });
        }
        setMessages(restored);
      }
      setLoadingHistory(false);
    })();
  }, []);

  const sendImage = useCallback(async (base64: string, mimeType: string, caption: string) => {
    const userMsg: Message = {
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

    const memuMsg: Message = {
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
      const userMsg: Message = {
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
      const memuMsg: Message = {
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

  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isWhatsApp = item.channel === 'whatsapp';
    
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
    borderRadius: radius.xs,
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
});
