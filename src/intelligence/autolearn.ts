import Anthropic from '@anthropic-ai/sdk';
import { seedContext } from './context';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Auto-learning: after every chat exchange, extract durable facts worth remembering.
 * Runs as fire-and-forget — does not block the response to the user.
 *
 * Uses Haiku for cost efficiency (~$0.00025 per call).
 * Writes extracted facts into context_entries with source 'auto_learning'.
 */
export async function extractAndStoreFacts(
  profileId: string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
    return; // Skip in dummy mode
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0,
      system: `You are a memory extraction system. Given a conversation exchange between a person and their AI assistant, extract any durable facts worth remembering about the person for future conversations.

Extract ONLY facts that would be useful in future conversations — preferences, routines, relationships, commitments, interests, health details, work context, family details, plans, opinions.

DO NOT extract:
- Temporary states ("I'm tired today")
- The AI's own responses or suggestions
- Generic knowledge questions and answers
- Pleasantries or greetings

Return a JSON array of strings. Each string is one self-contained fact.
If there are no durable facts worth remembering, return an empty array [].

Examples of good extractions:
- "Prefers to exercise in the morning before work"
- "Child-1 has a nut allergy"
- "Partner works Tuesdays and Thursdays from home"
- "Currently renovating the kitchen, expected to take 3 months"
- "Interested in composting and starting a vegetable garden"
- "Has a meeting with the school about Child-1 next Wednesday"`,
      messages: [{
        role: 'user',
        content: `USER: ${userMessage}\n\nASSISTANT: ${assistantResponse}`
      }],
    });

    const replyText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON safely
    const jsonMatch = replyText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const facts: string[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(facts) || facts.length === 0) return;

    // Store each fact with embedding, scoped to this profile
    for (const fact of facts) {
      if (typeof fact === 'string' && fact.trim().length > 5) {
        await seedContext(fact.trim(), 'manual', profileId);
        console.log(`[AUTO-LEARN] Stored: "${fact.trim().substring(0, 60)}..."`);
      }
    }

    console.log(`[AUTO-LEARN] Extracted ${facts.length} fact(s) from conversation.`);
  } catch (err) {
    // Auto-learning is non-critical — log and continue
    console.error('[AUTO-LEARN ERROR]', err);
  }
}
