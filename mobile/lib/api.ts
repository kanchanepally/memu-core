/**
 * Memu API Client
 * Connects to the memu-core Fastify backend.
 */

// In development, this is your local machine.
// In production, this will be the family's memu-core server.
const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3100';

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true', // Skip ngrok interstitial in dev
        ...options?.headers,
      },
      ...options,
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

// Health check
export async function checkHealth() {
  return request<{ status: string; service: string; timestamp: string }>('/health');
}

// Chat with Memu
export interface ChatResponse {
  response: string;
}

export async function sendMessage(content: string, profileId: string = 'adult-default'): Promise<ApiResponse<ChatResponse>> {
  return request<ChatResponse>('/api/message', {
    method: 'POST',
    body: JSON.stringify({ content, profileId }),
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

// Chat history (persists across app restarts)
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

export async function getChatHistory(profileId: string = 'adult-default', limit: number = 50): Promise<ApiResponse<ChatHistoryResponse>> {
  return request<ChatHistoryResponse>(`/api/chat/history?profileId=${profileId}&limit=${limit}`);
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
