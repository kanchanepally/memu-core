/**
 * Memu API Client
 * Connects to the memu-core Fastify backend.
 * Uses auth credentials from SecureStore.
 */

import { loadAuthState } from './auth';

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

/**
 * Get the current server URL and API key from stored auth state.
 * Falls back to env var / localhost for development.
 */
async function getConfig() {
  const auth = await loadAuthState();
  return {
    baseUrl: auth.serverUrl || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3100',
    apiKey: auth.apiKey,
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const { baseUrl, apiKey } = await getConfig();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      ...((options?.headers as Record<string, string>) || {}),
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Request failed' }));
      return { error: body.error || `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { error: message };
  }
}

// ==========================================
// Registration (no auth needed)
// ==========================================

export interface RegisterResponse {
  id: string;
  displayName: string;
  email: string;
  apiKey: string;
}

export async function register(
  serverUrl: string,
  name: string,
  email: string,
  familyNames: string
): Promise<ApiResponse<RegisterResponse>> {
  try {
    const res = await fetch(`${serverUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, familyNames }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Registration failed' }));
      return { error: body.error || `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { error: message };
  }
}

// Google Sign-In — exchange a Google ID token for a Memu profile + API key
export async function signInWithGoogle(
  serverUrl: string,
  idToken: string
): Promise<ApiResponse<RegisterResponse>> {
  try {
    const res = await fetch(`${serverUrl}/api/auth/google/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Sign-in failed' }));
      return { error: body.error || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { error: message };
  }
}

// Health check (no auth needed)
export async function checkServerHealth(serverUrl: string): Promise<ApiResponse<{ status: string }>> {
  try {
    const res = await fetch(`${serverUrl}/health`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Cannot reach server';
    return { error: message };
  }
}

// ==========================================
// Authenticated endpoints
// ==========================================

// Chat with Memu
export interface ChatResponse {
  response: string;
}

export type Visibility = 'personal' | 'family';

export async function sendMessage(
  content: string,
  visibility: Visibility = 'family',
): Promise<ApiResponse<ChatResponse>> {
  return request<ChatResponse>('/api/message', {
    method: 'POST',
    body: JSON.stringify({ content, visibility }),
  });
}

// Send a photo to Memu. Base64-encoded image body (no data: prefix).
export interface VisionCard {
  cardType: string;
  title: string;
  body: string;
}
export interface VisionResponse {
  response: string;
  cards: VisionCard[];
}

export async function sendVision(
  imageBase64: string,
  mimeType: string,
  caption?: string,
): Promise<ApiResponse<VisionResponse>> {
  return request<VisionResponse>('/api/vision', {
    method: 'POST',
    body: JSON.stringify({ image: imageBase64, mimeType, caption: caption ?? '' }),
  });
}

// Document ingestion — same shape as the backend's /api/document
// response. Adults-only (children blocked server-side → 403). The
// backend writes a `document` Space and any time-sensitive stream
// cards; mobile renders the result as a chat bubble.
export interface DocumentResponse {
  ok: true;
  spaceUri: string;
  spaceTitle: string;
  docType: string;
  charCount: number;
  truncated: boolean;
  streamCardCount: number;
}

export async function sendDocument(
  fileBase64: string,
  fileName: string,
  mimeType: string,
): Promise<ApiResponse<DocumentResponse>> {
  return request<DocumentResponse>('/api/document', {
    method: 'POST',
    body: JSON.stringify({ file: fileBase64, fileName, mimeType }),
  });
}

// Google Calendar OAuth
export async function getGoogleAuthUrl(source: string = 'pwa'): Promise<ApiResponse<{ url: string }>> {
  return request<{ url: string }>(`/api/auth/google?format=json&source=${encodeURIComponent(source)}`);
}

export async function disconnectGoogleCalendar() {
  return request<{ success: boolean }>('/api/auth/google', {
    method: 'DELETE',
  });
}

// Today's briefing
export interface BriefEvent {
  title: string;
  startTime: string | null;
  endTime: string | null;
}

// Persisted action types on stream_cards.actions[]. Briefing skill emits
// add_to_list / add_calendar_event / update_space / reply_draft. Reflection
// emits dismiss / open_space. Care standards emit standard_complete.
export type StreamCardAction =
  | { kind: 'add_to_list'; label: string; payload: { list: 'shopping' | 'task'; items: string[] } }
  | { kind: 'add_calendar_event'; label: string; payload: { title: string; start_iso: string; end_iso: string; location?: string; notes?: string } }
  | { kind: 'update_space'; label: string; payload: { slug: string; category: string; body_markdown: string } }
  | { kind: 'reply_draft'; label: string; payload: { to_anonymous_label?: string; draft_text: string } }
  | { type: 'dismiss'; label: string }
  | { type: 'open_space'; label: string; uri: string }
  | { type: 'standard_complete'; label: string; standardId: string };

export interface StreamCard {
  id: string;
  card_type: string;
  title: string;
  body: string;
  source: string;
  status: string;
  actions: StreamCardAction[] | null;
  created_at: string;
}

export interface BriefResponse {
  events: BriefEvent[];
  todayEvents: BriefEvent[];
  futureEvents: BriefEvent[];
  streamCards: StreamCard[];
  shoppingItems: StreamCard[];
  isCalendarConnected: boolean;
}

export async function getTodayBrief(): Promise<ApiResponse<BriefResponse>> {
  return request<BriefResponse>('/api/dashboard/brief');
}

export async function getSynthesis(): Promise<ApiResponse<{ synthesis: string | null }>> {
  return request<{ synthesis: string | null }>('/api/dashboard/synthesis');
}

// Stream card actions
export async function resolveCard(cardId: string) {
  return request<{ success: boolean }>('/api/stream/resolve', {
    method: 'POST',
    body: JSON.stringify({ cardId }),
  });
}

export async function cardToShopping(cardId: string) {
  return request<{ success: boolean }>('/api/stream/to-shopping', {
    method: 'POST',
    body: JSON.stringify({ cardId }),
  });
}

export async function addToCalendar(cardId: string) {
  return request<{ success: boolean }>('/api/calendar/add', {
    method: 'POST',
    body: JSON.stringify({ cardId }),
  });
}

export async function dismissCard(cardId: string) {
  return request<{ success: boolean }>('/api/stream/dismiss', {
    method: 'POST',
    body: JSON.stringify({ cardId }),
  });
}

export async function editCard(cardId: string, title: string, body: string) {
  return request<{ success: boolean; card: StreamCard }>('/api/stream/edit', {
    method: 'POST',
    body: JSON.stringify({ cardId, title, body }),
  });
}

// Briefing-action handlers — execute the persisted payload at index `actionIndex`.
export async function executeAddToListAction(cardId: string, actionIndex: number) {
  return request<{ success: boolean; added: number }>('/api/stream/action/add-to-list', {
    method: 'POST',
    body: JSON.stringify({ cardId, actionIndex }),
  });
}

export async function executeAddCalendarEventAction(cardId: string, actionIndex: number) {
  return request<{ success: boolean; eventId: string; htmlLink: string | null }>('/api/stream/action/add-calendar-event', {
    method: 'POST',
    body: JSON.stringify({ cardId, actionIndex }),
  });
}

export async function executeUpdateSpaceAction(cardId: string, actionIndex: number) {
  return request<{ success: boolean; uri: string }>('/api/stream/action/update-space', {
    method: 'POST',
    body: JSON.stringify({ cardId, actionIndex }),
  });
}

export async function ackReplyDraftAction(cardId: string, actionIndex: number) {
  return request<{ success: boolean }>('/api/stream/action/reply-draft', {
    method: 'POST',
    body: JSON.stringify({ cardId, actionIndex }),
  });
}

export async function completeCareStandard(standardId: string) {
  return request<{ success: boolean }>(`/api/care-standards/${encodeURIComponent(standardId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// Manually trigger a briefing for the calling profile. channel='app' surfaces
// it as a Today-tab card; channel='push' fires the Expo push pipeline (used
// to verify push tokens + Expo connectivity from Settings).
export async function runBriefingNow(channel: 'app' | 'push' = 'app') {
  return request<{ success: boolean; briefing: string | null; channel: string }>('/api/briefing/run-now', {
    method: 'POST',
    body: JSON.stringify({ channel }),
  });
}

// Push notification diagnostics — surfaced in Settings → Notifications. Lets
// the user verify whether their device has actually been registered for push
// (until 2026-04-29 the registration path swallowed errors silently and zero
// users had tokens, so morning briefings never delivered).
export interface PushTokenSummary {
  suffix: string;
  platform: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export async function getPushDiagnostics() {
  return request<{ tokenCount: number; tokens: PushTokenSummary[] }>('/api/push/diagnose');
}

export async function sendTestPush() {
  return request<{ success: boolean; attempted: number }>('/api/push/test', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// Brief preferences — per-profile customisation of the morning briefing.
// Backed by profiles.brief_preferences JSONB (migration 030).
export interface BriefLocation {
  lat: number;
  lon: number;
  placeName: string;
}

export interface BriefPreferences {
  location?: BriefLocation;
  newsSources: string[];
  topics: string[];
  thinkingPromptEnabled: boolean;
}

export interface NewsSourceOption {
  id: string;
  label: string;
}

export async function getBriefPreferences() {
  return request<{ preferences: BriefPreferences; availableSources: NewsSourceOption[] }>(
    '/api/preferences/brief',
  );
}

export interface BriefPreferencesPatch {
  placeName?: string;
  location?: BriefLocation;
  newsSources?: string[];
  topics?: string[];
  thinkingPromptEnabled?: boolean;
}

export async function updateBriefPreferences(patch: BriefPreferencesPatch) {
  return request<{ preferences: BriefPreferences }>('/api/preferences/brief', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

// Structured news feed — Today screen + PWA news block. Same source list
// as the briefing (per profile prefs); typed items with thumbnails + links.
export interface NewsItem {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceLabel: string;
  thumbnailUrl?: string;
  publishedAt?: string;
}

export interface NewsFeedPayload {
  items: NewsItem[];
  fetchedAt: string;
  sources: Array<{ id: string; label: string; count: number }>;
}

export async function getNewsFeed(perSourceMax?: number) {
  const query = perSourceMax ? `?perSourceMax=${perSourceMax}` : '';
  return request<NewsFeedPayload>(`/api/news${query}`);
}

// ─── Streaming chat (Fix 4 — status ticker) ─────────────────────────────────
//
// /api/message/stream emits SSE events as the pipeline progresses (twin_check
// / retrieving / routing / tool_use / synthesising / done). React Native's
// older fetch implementations don't expose chunked streaming cleanly, so we
// drive it via XMLHttpRequest.onprogress — each progress event delivers the
// accumulated responseText, we track how much we've parsed and emit complete
// SSE frames to the caller.

export type StreamEvent =
  | { name: 'twin_check'; data: Record<string, unknown> }
  | { name: 'retrieving'; data: Record<string, unknown> }
  | { name: 'routing'; data: { provider?: string; model?: string } }
  | { name: 'tool_use'; data: { tool?: string } }
  | { name: 'synthesising'; data: Record<string, unknown> }
  | { name: 'done'; data: { response?: string } }
  | { name: 'error'; data: { error?: string } };

export interface StreamHandle {
  /** Cancel the underlying XHR; further events will not fire. */
  cancel: () => void;
}

export function sendMessageStreaming(
  content: string,
  layer: Visibility,
  onEvent: (event: StreamEvent) => void,
  onError: (message: string) => void,
): StreamHandle {
  let cancelled = false;
  const xhr = new XMLHttpRequest();
  let lastParsedLength = 0;

  // Detach this so a sync throw inside getConfig doesn't escape — XHR isn't
  // promise-shaped, so we resolve config asynchronously and kick off the
  // request once we have it.
  (async () => {
    const auth = await loadAuthState();
    const baseUrl = auth.serverUrl || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3100';
    const apiKey = auth.apiKey;
    if (cancelled) return;

    xhr.open('POST', `${baseUrl}/api/message/stream`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('ngrok-skip-browser-warning', 'true');
    if (apiKey) xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);

    xhr.onprogress = () => {
      if (cancelled) return;
      const fresh = xhr.responseText.slice(lastParsedLength);
      lastParsedLength = xhr.responseText.length;
      const events = parseSseChunks(fresh);
      for (const ev of events) {
        if (cancelled) return;
        onEvent(ev);
      }
    };
    xhr.onerror = () => {
      if (cancelled) return;
      onError('Network error');
    };
    xhr.onload = () => {
      if (cancelled) return;
      // Flush any tail that didn't trigger an onprogress event (rare —
      // most platforms fire onprogress for the last chunk too, but be
      // defensive).
      const fresh = xhr.responseText.slice(lastParsedLength);
      lastParsedLength = xhr.responseText.length;
      const events = parseSseChunks(fresh);
      for (const ev of events) onEvent(ev);
      // 4xx/5xx — surface as error if not already.
      if (xhr.status >= 400) {
        onError(`Server returned ${xhr.status}`);
      }
    };

    xhr.send(JSON.stringify({ content, visibility: layer }));
  })().catch(err => {
    if (!cancelled) onError(err instanceof Error ? err.message : 'Connect failed');
  });

  return {
    cancel: () => {
      cancelled = true;
      try { xhr.abort(); } catch { /* swallow */ }
    },
  };
}

// Split an SSE chunk into event objects. SSE frames are separated by a
// blank line; each frame has an optional `event:` line and one or more
// `data:` lines. We support both single-line and multi-line data.
function parseSseChunks(raw: string): StreamEvent[] {
  // SSE frames terminate on a blank line. Buffer remainder across calls
  // would be ideal — but XHR.responseText is cumulative and we already
  // dedupe by `lastParsedLength`. So we just split on \n\n here; partial
  // frames at the tail will be picked up on the next onprogress when the
  // blank-line separator arrives.
  const frames = raw.split('\n\n');
  const out: StreamEvent[] = [];
  for (const frame of frames) {
    if (!frame.trim()) continue;
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      } else if (line.startsWith(':')) {
        // Keep-alive comment — ignore.
      }
    }
    if (dataLines.length === 0) continue;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch {
      // Malformed data line — skip.
      continue;
    }
    out.push({ name: eventName, data } as StreamEvent);
  }
  return out;
}

// Onboarding — conversational seed-context flow.
//
// Mobile screens (people, rhythm, focus, preview, channels) call these to
// fetch personalised copy and persist each answer. The backend uses
// autolearn on every answer to create person / routine / commitment Spaces
// so Day 0 ends with real content rather than the audit-flagged blank state.
export type OnboardingStep = 'people' | 'rhythm' | 'focus' | 'preview' | 'channels';
export type OnboardingStepStatus = 'pending' | 'answered' | 'skipped';

export interface OnboardingStepCopy {
  prompt: string;
  placeholder: string;
  helper: string;
  skipLabel: string;
}

export interface OnboardingState {
  people: OnboardingStepStatus;
  rhythm: OnboardingStepStatus;
  focus: OnboardingStepStatus;
  preview: OnboardingStepStatus;
  channels: OnboardingStepStatus;
  completedAt: string | null;
  answers: Partial<Record<OnboardingStep, string>>;
}

export interface OnboardingStateResponse {
  state: OnboardingState;
  nextStep: OnboardingStep | null;
  complete: boolean;
  stepOrder: OnboardingStep[];
  copy: OnboardingStepCopy | null;
}

export interface OnboardingAnswerResponse {
  state: OnboardingState;
  acknowledgement: string;
  learnedNames: string[];
  observationCount: number;
  spacesAffected: { uri: string; name: string; category: string; created: boolean }[];
}

export async function getOnboardingState() {
  return request<OnboardingStateResponse>('/api/onboarding/state');
}

export async function submitOnboardingAnswer(step: OnboardingStep, answer: string) {
  return request<OnboardingAnswerResponse>('/api/onboarding/answer', {
    method: 'POST',
    body: JSON.stringify({ step, answer }),
  });
}

export async function skipOnboardingStep(step: OnboardingStep) {
  return request<{ state: OnboardingState }>('/api/onboarding/skip', {
    method: 'POST',
    body: JSON.stringify({ step }),
  });
}

export async function completeOnboarding() {
  return request<{ state: OnboardingState }>('/api/onboarding/complete', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// Lists (shopping / task / custom)
export type ListItemType = 'shopping' | 'task' | 'custom';
export type ListItemStatus = 'pending' | 'done';

export interface ListItem {
  id: string;
  family_id: string;
  list_type: ListItemType;
  list_name: string | null;
  item_text: string;
  note: string | null;
  status: ListItemStatus;
  source: string | null;
  source_message_id: string | null;
  source_stream_card_id: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  /** Optional deadline. ISO date string when set, null otherwise. */
  due_at: string | null;
}

export async function getLists(params?: {
  listType?: ListItemType;
  status?: ListItemStatus;
  limit?: number;
}): Promise<ApiResponse<{ items: ListItem[] }>> {
  const qs = new URLSearchParams();
  if (params?.listType) qs.set('list_type', params.listType);
  if (params?.status) qs.set('status', params.status);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<{ items: ListItem[] }>(`/api/lists${suffix}`);
}

export async function addListItemApi(
  listType: ListItemType,
  itemText: string,
  opts?: { note?: string | null; listName?: string | null; dueAt?: string | null },
): Promise<ApiResponse<{ success: boolean; item: ListItem }>> {
  return request<{ success: boolean; item: ListItem }>('/api/lists', {
    method: 'POST',
    body: JSON.stringify({
      list_type: listType,
      item_text: itemText,
      note: opts?.note ?? null,
      list_name: opts?.listName ?? null,
      due_at: opts?.dueAt ?? null,
      source: 'mobile',
    }),
  });
}

export async function completeListItemApi(id: string) {
  return request<{ success: boolean; item: ListItem }>(`/api/lists/${id}/complete`, {
    method: 'POST',
  });
}

export async function reopenListItemApi(id: string) {
  return request<{ success: boolean; item: ListItem }>(`/api/lists/${id}/reopen`, {
    method: 'POST',
  });
}

export async function updateListItemApi(
  id: string,
  patch: {
    itemText?: string;
    note?: string | null;
    listName?: string | null;
    dueAt?: string | null;
  },
) {
  return request<{ success: boolean; item: ListItem }>(`/api/lists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      item_text: patch.itemText,
      note: patch.note,
      list_name: patch.listName,
      due_at: patch.dueAt,
    }),
  });
}

export async function deleteListItemApi(id: string) {
  return request<{ success: boolean }>(`/api/lists/${id}`, {
    method: 'DELETE',
  });
}

// Chat history
export interface ChatMessageSpaceRef {
  id: string;
  name: string;
  slug: string;
  category?: string;
}

export interface ChatHistoryMessage {
  id: string;
  conversationId?: string;
  /**
   * NULL for server-generated assistant-only messages (briefings) where
   * there is no paired user prompt. Renderers should fall through to a
   * single Memu bubble in that case.
   */
  userMessage: string | null;
  memuResponse: string;
  channel: string;
  timestamp: string;
  spaces?: ChatMessageSpaceRef[];
  /**
   * Server-tagged type. 'briefing' marks the morning briefing turn for
   * elevated rendering. Plain turns leave this null/absent.
   */
  type?: 'briefing' | null;
}

export interface ChatHistoryResponse {
  messages: ChatHistoryMessage[];
  conversationId?: string | null;
}

export interface ConversationSummary {
  id: string;
  startedAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  title: string | null;
  preview: string | null;
}

export interface ConversationListResponse {
  conversations: ConversationSummary[];
}

export async function getChatHistory(
  limit: number = 100,
  conversationId?: string,
): Promise<ApiResponse<ChatHistoryResponse>> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (conversationId) qs.set('conversationId', conversationId);
  return request<ChatHistoryResponse>(`/api/chat/history?${qs.toString()}`);
}

export async function listConversations(): Promise<ApiResponse<ConversationListResponse>> {
  return request<ConversationListResponse>('/api/chat/conversations');
}

// Privacy Ledger
export interface LedgerEntry {
  id: string;
  content_original: string;
  content_translated: string;
  content_response_raw: string;
  content_response_translated: string;
  entity_translations: Array<{ real: string; anonymous: string }>;
  channel: string;
  cloud_tokens_in: number;
  cloud_tokens_out: number;
  created_at: string;
}

export async function getLedger(): Promise<ApiResponse<LedgerEntry[]>> {
  return request<LedgerEntry[]>('/api/ledger');
}

// Synthesis Spaces
export interface SynthesisPage {
  id: string;
  category: string;
  title: string;
  slug?: string;            // deep-link target for chat artefact chips
  body_markdown: string;
  last_updated_at: string;
}

export async function getSpaces(): Promise<ApiResponse<{ spaces: SynthesisPage[] }>> {
  return request<{ spaces: SynthesisPage[] }>('/api/dashboard/spaces');
}

export async function createSpace(title: string, category: string, body_markdown: string) {
  return request<{ space: SynthesisPage }>('/api/spaces', {
    method: 'POST',
    body: JSON.stringify({ title, category, body_markdown }),
  });
}

export async function updateSpace(id: string, title: string, body_markdown: string) {
  return request<{ space: SynthesisPage }>(`/api/spaces/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title, body_markdown }),
  });
}

export async function deleteSpace(id: string) {
  return request<{ success: boolean }>(`/api/spaces/${id}`, {
    method: 'DELETE',
  });
}

export async function extractListCommand(content: string) {
  return request<{ success: boolean }>('/api/extract', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

// Profile management
export async function updateProfile(displayName: string) {
  return request<{ success: boolean; profile: { id: string; display_name: string; role: string } }>(
    '/api/profile',
    {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    },
  );
}

export async function clearChatHistory() {
  return request<{ success: boolean }>('/api/chat/clear', {
    method: 'POST',
  });
}

// BYOK — bring-your-own-key for LLM providers
export interface BYOKKeyStatus {
  provider: 'anthropic' | 'gemini' | 'openai';
  hasKey: boolean;
  enabled: boolean;
  keyHint?: string;
  updatedAt?: string;
}

export async function getBYOKStatus() {
  return request<{ keys: BYOKKeyStatus[]; reason?: string }>('/api/profile/byok');
}

export async function setBYOKKey(provider: 'anthropic' | 'gemini' | 'openai', apiKey: string) {
  return request<{ success: boolean }>('/api/profile/byok', {
    method: 'POST',
    body: JSON.stringify({ provider, apiKey }),
  });
}

export async function revokeBYOKKey(provider: 'anthropic' | 'gemini' | 'openai') {
  return request<{ success: boolean }>(`/api/profile/byok?provider=${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
}

export async function toggleBYOKKey(provider: 'anthropic' | 'gemini' | 'openai', enabled: boolean) {
  return request<{ success: boolean }>('/api/profile/byok/toggle', {
    method: 'POST',
    body: JSON.stringify({ provider, enabled }),
  });
}

// Twin registry — real↔anonymous entity mappings
export interface TwinEntity {
  id: string;
  entity_type: string;
  real_name: string;
  anonymous_label: string;
  detected_by: string;
  confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export async function getTwinRegistry() {
  return request<{ entities: TwinEntity[] }>('/api/twin/registry');
}

export async function addTwinEntity(params: {
  entityType: string;
  realName: string;
  anonymousLabel: string;
}) {
  return request<{ success: boolean; entity: TwinEntity }>('/api/twin/registry', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function updateTwinEntity(
  id: string,
  updates: { realName?: string; anonymousLabel?: string; entityType?: string; confirmed?: boolean },
) {
  return request<{ success: boolean; entity: TwinEntity }>(`/api/twin/registry/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteTwinEntity(id: string) {
  return request<{ success: boolean }>(`/api/twin/registry/${id}`, {
    method: 'DELETE',
  });
}

// ==========================================
// Collective members + Pod grants (Story 3.4)
// ==========================================

export type MemberStatus = 'invited' | 'active' | 'leaving' | 'left';
export type LeavePolicy = 'retain_attributed' | 'anonymise' | 'remove';

export interface CollectiveMember {
  id: string;
  collectiveAdminProfileId: string;
  memberWebid: string;
  memberDisplayName: string;
  internalProfileId: string | null;
  invitedByProfileId: string;
  status: MemberStatus;
  leavePolicyForEmergent: LeavePolicy;
  gracePeriodDays: number;
  invitedAt: string;
  joinedAt: string | null;
  leaveInitiatedAt: string | null;
  leaveGraceUntil: string | null;
  leftAt: string | null;
}

export interface PodGrant {
  id: string;
  memberId: string;
  spaceUrl: string;
  status: 'active' | 'revoked';
  grantedAt: string;
  revokedAt: string | null;
  lastSyncedAt: string | null;
  lastEtag: string | null;
  lastModifiedHeader: string | null;
}

export interface CachedExternalSpace {
  id: string;
  memberId: string;
  spaceUrl: string;
  uri: string;
  category: string;
  slug: string;
  name: string;
  description: string;
  bodyMarkdown: string;
  remoteLastUpdated: string | null;
  fetchedAt: string;
}

export interface SyncReport {
  memberId: string;
  spaceUrl: string;
  outcome:
    | { kind: 'fetched'; cache: CachedExternalSpace }
    | { kind: 'not_modified'; cache: CachedExternalSpace | null }
    | { kind: 'error'; reason: string; message: string };
}

export async function listCollectiveMembers(includeLeft = false) {
  const qs = includeLeft ? '?includeLeft=true' : '';
  return request<{ members: CollectiveMember[] }>(`/api/households/members${qs}`);
}

export async function inviteCollectiveMember(params: {
  memberWebid: string;
  memberDisplayName: string;
  internalProfileId?: string | null;
  leavePolicyForEmergent?: LeavePolicy;
  gracePeriodDays?: number;
}) {
  return request<{ member: CollectiveMember }>('/api/households/members', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function acceptCollectiveInvite(memberId: string) {
  return request<{ member: CollectiveMember }>(`/api/households/members/${memberId}/accept`, {
    method: 'POST',
  });
}

export async function leaveCollective(
  memberId: string,
  opts: { policyOverride?: LeavePolicy; gracePeriodDaysOverride?: number } = {},
) {
  return request<{ member: CollectiveMember }>(`/api/households/members/${memberId}/leave`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function cancelCollectiveLeave(memberId: string) {
  return request<{ member: CollectiveMember }>(`/api/households/members/${memberId}/cancel-leave`, {
    method: 'POST',
  });
}

export async function removeCollectiveMember(memberId: string) {
  return request<{ member: CollectiveMember }>(`/api/households/members/${memberId}`, {
    method: 'DELETE',
  });
}

export async function listMemberGrants(memberId: string, includeRevoked = false) {
  const qs = includeRevoked ? '?includeRevoked=true' : '';
  return request<{ grants: PodGrant[] }>(`/api/households/members/${memberId}/grants${qs}`);
}

export async function recordMemberGrant(memberId: string, spaceUrl: string) {
  return request<{ grant: PodGrant }>(`/api/households/members/${memberId}/grants`, {
    method: 'POST',
    body: JSON.stringify({ spaceUrl }),
  });
}

export async function revokeMemberGrant(memberId: string, spaceUrl: string) {
  return request<{ success: boolean }>(
    `/api/households/members/${memberId}/grants?spaceUrl=${encodeURIComponent(spaceUrl)}`,
    { method: 'DELETE' },
  );
}

export async function syncMemberGrantsNow(
  memberId: string,
  opts: { accessToken?: string; forceRefetch?: boolean } = {},
) {
  return request<{ reports: SyncReport[] }>(`/api/households/members/${memberId}/grants/sync`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function listCachedMemberSpaces(memberId: string) {
  return request<{ spaces: CachedExternalSpace[] }>(`/api/households/members/${memberId}/grants/cached`);
}

// Data export — returns JSON archive text
export async function exportData(): Promise<ApiResponse<string>> {
  try {
    const { baseUrl, apiKey } = await (async () => {
      const auth = await loadAuthState();
      return {
        baseUrl: auth.serverUrl || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3100',
        apiKey: auth.apiKey,
      };
    })();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/api/export`, { headers });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await res.text();
    return { data: text };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Network error' };
  }
}
