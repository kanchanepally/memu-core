import Anthropic from '@anthropic-ai/sdk';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeCallInput {
  model: string;
  system?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content:
      | string
      | Array<
          | { type: 'text'; text: string }
          | {
              type: 'image';
              source: { type: 'base64'; media_type: string; data: string };
            }
        >;
  }>;
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
}

export interface ClaudeCallResult {
  text: string;
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
    return {
      text: `[Dummy Mode: No API Key] I am the Chief of Staff. I hear you saying: "${userPrompt}". My anonymity is guaranteed.`,
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
    messages: input.messages as any,
  });

  const latency = Date.now() - start;
  const first = msg.content[0] as any;
  const text = first?.type === 'text' ? first.text : "I'm sorry, I couldn't form a response.";

  return {
    text,
    tokensIn: msg.usage?.input_tokens ?? 0,
    tokensOut: msg.usage?.output_tokens ?? 0,
    latencyMs: latency,
    model: input.model,
    dummy: false,
  };
}

