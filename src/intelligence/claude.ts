import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'sk-dummy', 
});

const SYSTEM_PROMPT = `You are Memu, a private family AI Chief of Staff. You have access to an anonymous 
model of this family — personas, relationships, schedules, and context. All real 
names, locations, schools, and identifying details have been replaced with anonymous 
labels (Adult-1, Child-1, School-1, Location-3, etc.).

CRITICAL RULES:
1. Always use the anonymous labels in your response. Never guess or invent real names.
2. If the context mentions "Child-1", respond using "Child-1". The system will translate them to real names before the user sees your response.
3. Be warm, direct, and useful. You are a trusted Chief of Staff, not a chatbot.`;

export async function getClaudeResponse(prompt: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
    return `[Dummy Mode: No API Key] I am the Chief of Staff. I hear you saying: "${prompt}". My anonymity is guaranteed.`;
  }

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: prompt }
      ]
    });
    
    const content = msg.content[0] as any;
    return content.text || "I'm sorry, I couldn't form a response.";
  } catch (err) {
    console.error("Claude API error:", err);
    return "Error contacting Claude. Please check the logs.";
  }
}
