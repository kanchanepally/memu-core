import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ConversationMessage } from './claude';

export interface GeminiCallInput {
  model: string;
  systemInstruction?: string;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GeminiCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
  dummy: boolean;
}

function resolveKey(override?: string): string | null {
  const k = override || process.env.GEMINI_API_KEY;
  if (!k || k === 'your_gemini_api_key_here') return null;
  return k;
}

export async function callGemini(input: GeminiCallInput): Promise<GeminiCallResult> {
  const start = Date.now();
  const key = resolveKey(input.apiKey);

  if (!key) {
    const lastUser = [...input.contents].reverse().find(c => c.role === 'user');
    const userPrompt = lastUser?.parts[0]?.text ?? '';
    return {
      text: `[Dummy Mode: No Gemini Key] I am the Chief of Staff. I hear you saying: "${userPrompt}". My anonymity is guaranteed.`,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - start,
      model: input.model,
      dummy: true,
    };
  }

  const genAI = new GoogleGenerativeAI(key);
  const generationConfig: { temperature?: number; maxOutputTokens?: number } = {};
  if (input.temperature !== undefined) generationConfig.temperature = input.temperature;
  if (input.maxTokens !== undefined) generationConfig.maxOutputTokens = input.maxTokens;

  const model = genAI.getGenerativeModel({
    model: input.model,
    ...(input.systemInstruction ? { systemInstruction: input.systemInstruction } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  });

  const result = await model.generateContent({ contents: input.contents });
  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata;
  const latency = Date.now() - start;

  return {
    text: text || "I'm sorry, I couldn't form a response.",
    tokensIn: usage?.promptTokenCount ?? 0,
    tokensOut: usage?.candidatesTokenCount ?? 0,
    latencyMs: latency,
    model: input.model,
    dummy: false,
  };
}

// Helper to adapt ConversationMessage[] + current user prompt into Gemini's content shape.
export function toGeminiContents(
  prompt: string,
  history: ConversationMessage[] = [],
): GeminiCallInput['contents'] {
  return [
    ...history.map(h => ({
      role: h.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: h.content }],
    })),
    { role: 'user' as const, parts: [{ text: prompt }] },
  ];
}
