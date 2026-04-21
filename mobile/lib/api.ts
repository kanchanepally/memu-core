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

export interface StreamCard {
  id: string;
  card_type: string;
  title: string;
  body: string;
  source: string;
  status: string;
  actions: unknown[];
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
  note?: string | null,
): Promise<ApiResponse<{ success: boolean; item: ListItem }>> {
  return request<{ success: boolean; item: ListItem }>('/api/lists', {
    method: 'POST',
    body: JSON.stringify({ list_type: listType, item_text: itemText, note, source: 'mobile' }),
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
  patch: { itemText?: string; note?: string | null },
) {
  return request<{ success: boolean; item: ListItem }>(`/api/lists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ item_text: patch.itemText, note: patch.note }),
  });
}

export async function deleteListItemApi(id: string) {
  return request<{ success: boolean }>(`/api/lists/${id}`, {
    method: 'DELETE',
  });
}

// Chat history
export interface ChatHistoryMessage {
  id: string;
  userMessage: string;
  memuResponse: string;
  channel: string;
  timestamp: string;
}

export interface ChatHistoryResponse {
  messages: ChatHistoryMessage[];
}

export async function getChatHistory(limit: number = 50): Promise<ApiResponse<ChatHistoryResponse>> {
  return request<ChatHistoryResponse>(`/api/chat/history?limit=${limit}`);
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
// Household members + Pod grants (Story 3.4)
// ==========================================

export type MemberStatus = 'invited' | 'active' | 'leaving' | 'left';
export type LeavePolicy = 'retain_attributed' | 'anonymise' | 'remove';

export interface HouseholdMember {
  id: string;
  householdAdminProfileId: string;
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

export async function listHouseholdMembers(includeLeft = false) {
  const qs = includeLeft ? '?includeLeft=true' : '';
  return request<{ members: HouseholdMember[] }>(`/api/households/members${qs}`);
}

export async function inviteHouseholdMember(params: {
  memberWebid: string;
  memberDisplayName: string;
  internalProfileId?: string | null;
  leavePolicyForEmergent?: LeavePolicy;
  gracePeriodDays?: number;
}) {
  return request<{ member: HouseholdMember }>('/api/households/members', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function acceptHouseholdInvite(memberId: string) {
  return request<{ member: HouseholdMember }>(`/api/households/members/${memberId}/accept`, {
    method: 'POST',
  });
}

export async function leaveHousehold(
  memberId: string,
  opts: { policyOverride?: LeavePolicy; gracePeriodDaysOverride?: number } = {},
) {
  return request<{ member: HouseholdMember }>(`/api/households/members/${memberId}/leave`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function cancelHouseholdLeave(memberId: string) {
  return request<{ member: HouseholdMember }>(`/api/households/members/${memberId}/cancel-leave`, {
    method: 'POST',
  });
}

export async function removeHouseholdMember(memberId: string) {
  return request<{ member: HouseholdMember }>(`/api/households/members/${memberId}`, {
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
