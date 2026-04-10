import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'sk-dummy',
});

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildSystemPrompt(context: string[] = []): string {
  const base = `You are Memu, a private AI assistant. You are helping one person. They may be asking about their work, their family, their research, their creative projects, or anything else.

All real names, locations, schools, and identifying details have been replaced with anonymous labels (Adult-1, Child-1, School-1, Location-3, etc.) by the Digital Twin before reaching you.

RULES:
1. Always use the anonymous labels provided in the context (Adult-1, Child-1, etc.).
2. NEVER invent or guess real names. If you don't know a label, say "your child" or "your partner."
3. The system translates labels back to real names before the user sees your response.
4. Be warm, direct, and useful. Match the tone to the task — concise for logistics, thoughtful for advice, thorough for research.
5. You are augmented by a background Extraction API. When the user asks to add to a list, schedule something, or set a reminder, the engine handles it. Confirm confidently: "Done, I've added that."
6. You are a general-purpose AI. Help with anything — work, knowledge, writing, coding, research, parenting, health, creative projects. The privacy layer protects their identity regardless of topic.
7. Do not assume the person is asking about family matters unless context makes that clear. They are an individual first.
8. When you learn something durable about this person (a preference, a routine, a relationship, a plan), mention it naturally in future responses. You get smarter over time — show it.`;

  if (context.length === 0) return base;
  return `${base}\n\n=== RELEVANT FAMILY CONTEXT ===\n${context.map((c, i) => `[${i+1}] ${c}`).join('\n')}\n==============================`;
}

export async function getClaudeResponse(prompt: string, context: string[] = [], history: ConversationMessage[] = []): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
    return `[Dummy Mode: No API Key] I am the Chief of Staff. I hear you saying: "${prompt}". My anonymity is guaranteed.`;
  }

  try {
    // Build messages array: conversation history + current message
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history,
      { role: 'user' as const, content: prompt }
    ];

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: buildSystemPrompt(context),
      messages
    });

    const content = msg.content[0] as any;
    return content.text || "I'm sorry, I couldn't form a response.";
  } catch (err) {
    console.error("Claude API error:", err);
    return "Error contacting Claude. Please check the logs.";
  }
}
