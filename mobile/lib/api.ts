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

// Google Calendar OAuth
export async function getGoogleAuthUrl(): Promise<ApiResponse<{ url: string }>> {
  return request<{ url: string }>('/api/auth/google?format=json');
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
