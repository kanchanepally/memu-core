import Anthropic from '@anthropic-ai/sdk';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | Array<{ type: 'text'; text: string }>;
      is_error?: boolean;
    }
  // Anthropic server-side tools (e.g. web_search). Claude emits these in
  // its response when it invokes a managed tool; Anthropic resolves the
  // call server-side and includes the result in the same response. Memu's
  // router does NOT execute these locally — they're already done by the
  // time we see them.
  | {
      type: 'server_tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'web_search_tool_result';
      tool_use_id: string;
      // Either an array of result items or an error object. We don't
      // structurally type either deeply — the router only needs to
      // distinguish ok-shape from error-shape for the footer.
      content: unknown;
    };

export interface ClaudeToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Anthropic-managed server-side tools (web_search and friends). Sent
 * alongside local-function tools in the same `tools` array on the API
 * call. Distinguished by the `type` field — local tools have no `type`.
 *
 * Today only `web_search_20260209` is wired. Adding others (e.g. code
 * execution when GA) is a one-liner — extend the union and add to the
 * `interactiveQueryServerTools` array in tools.ts.
 */
export type ClaudeServerSideTool = {
  type: 'web_search_20260209';
  name: 'web_search';
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
  user_location?: {
    type: 'approximate';
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
};

export type ClaudeAnyTool = ClaudeToolSchema | ClaudeServerSideTool;

export interface ClaudeCallInput {
  model: string;
  system?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | ClaudeContentBlock[];
  }>;
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  tools?: ClaudeAnyTool[];
  toolChoice?: 'auto' | 'any' | 'none' | { type: 'tool'; name: string };
}

export type ClaudeStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | null;

export interface ClaudeCallResult {
  text: string;
  content: ClaudeContentBlock[];
  stopReason: ClaudeStopReason;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
  dummy: boolean;
}

function resolveKey(override?: string): string | null {
  const k = override || process.env.ANTHROPIC_API_KEY;
  if (!k || k === 'your_anthropic_api_key_here') return null;
  return k;
}

export async function callClaude(input: ClaudeCallInput): Promise<ClaudeCallResult> {
  const start = Date.now();
  const key = resolveKey(input.apiKey);

  if (!key) {
    const userPrompt = (() => {
      const last = input.messages[input.messages.length - 1];
      if (!last) return '';
      if (typeof last.content === 'string') return last.content;
      const t = last.content.find(c => c.type === 'text') as { type: 'text'; text: string } | undefined;
      return t?.text ?? '';
    })();
    const text = `[Dummy Mode: No API Key] I am the Chief of Staff. I hear you saying: "${userPrompt}". My anonymity is guaranteed.`;
    return {
      text,
      content: [{ type: 'text', text }],
      stopReason: 'end_turn',
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - start,
      model: input.model,
      dummy: true,
    };
  }

  const client = new Anthropic({ apiKey: key });

  const msg = await client.messages.create({
    model: input.model,
    max_tokens: input.maxTokens ?? 1024,
    ...(input.system ? { system: input.system } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.tools && input.tools.length > 0 ? { tools: input.tools as any } : {}),
    ...(input.toolChoice ? { tool_choice: input.toolChoice as any } : {}),
    messages: input.messages as any,
  });

  const latency = Date.now() - start;
  const content = msg.content as ClaudeContentBlock[];
  const firstText = content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
  const text = firstText?.text ?? '';

  return {
    text,
    content,
    stopReason: msg.stop_reason as ClaudeStopReason,
    tokensIn: msg.usage?.input_tokens ?? 0,
    tokensOut: msg.usage?.output_tokens ?? 0,
    latencyMs: latency,
    model: input.model,
    dummy: false,
  };
}
