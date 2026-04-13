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

export async function sendMessage(content: string): Promise<ApiResponse<ChatResponse>> {
  return request<ChatResponse>('/api/message', {
    method: 'POST',
    body: JSON.stringify({ content }),
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

export async function extractListCommand(content: string) {
  return request<{ success: boolean }>('/api/extract', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}
