/**
 * DeepSeek provider — OpenAI-compatible chat completion API.
 *
 * Why DeepSeek:
 *   - DeepSeek-V3 (`deepseek-chat`) is roughly an order of magnitude cheaper
 *     than Claude Sonnet for similar text-quality tasks (synthesis, autolearn,
 *     briefing, reflection, document_ingestion). The Twin guard runs ahead
 *     of dispatch so DeepSeek never sees real names — privacy posture is
 *     preserved by architecture, not provider trust.
 *   - DeepSeek-R1 (`deepseek-reasoner`) is the reasoning variant — cheaper
 *     than Claude Sonnet for multi-step reasoning where the chain-of-thought
 *     itself is the value (rare in Memu skills today, but kept available).
 *
 * What DeepSeek does NOT do (per Apr 2026):
 *   - No vision (text-only). `vision` skill must stay on Claude Sonnet.
 *   - No tool-use compatible with Anthropic's `web_search_20260209` server-
 *     side tool. `interactive_query` must stay on Claude until we either
 *     build a Claude-microservice for search or wait for DeepSeek to add
 *     a comparable surface.
 *
 * Implementation: bare fetch — no SDK dep, the surface is small enough
 * that a SDK would be overhead. Mirrors the shape of `gemini.ts` so the
 * router can drop it in without special cases.
 */

import type { ConversationMessage } from './claude';

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekCallInput {
  model: string;
  systemPrompt?: string;
  messages: DeepSeekMessage[];
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface DeepSeekCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
  dummy: boolean;
}

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

function resolveKey(override?: string): string | null {
  const k = override || process.env.DEEPSEEK_API_KEY;
  if (!k || k === 'your_deepseek_api_key_here') return null;
  return k;
}

export async function callDeepSeek(input: DeepSeekCallInput): Promise<DeepSeekCallResult> {
  const start = Date.now();
  const key = resolveKey(input.apiKey);

  if (!key) {
    const lastUser = [...input.messages].reverse().find(m => m.role === 'user');
    return {
      text: `[Dummy Mode: No DeepSeek Key] I am Memu running without DeepSeek. Last user prompt: "${lastUser?.content ?? ''}".`,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - start,
      model: input.model,
      dummy: true,
    };
  }

  // OpenAI-compatible: system messages live in the same array as user/
  // assistant turns. Prepend systemPrompt as a system message if provided.
  const messages: DeepSeekMessage[] = input.systemPrompt
    ? [{ role: 'system', content: input.systemPrompt }, ...input.messages]
    : [...input.messages];

  const body: Record<string, unknown> = { model: input.model, messages };
  if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;
  if (input.temperature !== undefined) body.temperature = input.temperature;

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`DeepSeek API ${res.status}: ${errBody.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? "I'm sorry, I couldn't form a response.";
  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;

  return {
    text,
    tokensIn,
    tokensOut,
    latencyMs: Date.now() - start,
    model: input.model,
    dummy: false,
  };
}

/**
 * Adapt the orchestrator's ConversationMessage[] + a current user prompt
 * into DeepSeek's flat message list. Mirrors `toGeminiContents` in shape
 * so the router treats both providers symmetrically.
 */
export function toDeepSeekMessages(
  prompt: string,
  history: ConversationMessage[] = [],
): DeepSeekMessage[] {
  const out: DeepSeekMessage[] = history.map(h => ({
    role: h.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: h.content,
  }));
  out.push({ role: 'user', content: prompt });
  return out;
}
