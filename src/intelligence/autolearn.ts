import { seedContext, type Visibility } from './context';
import { dispatch } from '../skills/router';

/**
 * Auto-learning: after every chat exchange, extract durable facts worth remembering.
 * Runs as fire-and-forget — does not block the response to the user.
 *
 * Uses the autolearn skill (model: haiku, cost_tier: cheap).
 * Writes extracted facts into context_entries with source 'auto_learning'.
 */
export async function extractAndStoreFacts(
  profileId: string,
  userMessage: string,
  assistantResponse: string,
  visibility: Visibility = 'family',
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
    return;
  }

  try {
    const { text: replyText } = await dispatch({
      skill: 'autolearn',
      userMessage: `USER: ${userMessage}\n\nASSISTANT: ${assistantResponse}`,
      profileId,
      maxTokens: 500,
      temperature: 0,
      useBYOK: true,
    });

    const jsonMatch = replyText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const facts: string[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(facts) || facts.length === 0) return;

    for (const fact of facts) {
      if (typeof fact === 'string' && fact.trim().length > 5) {
        await seedContext(fact.trim(), 'manual', profileId, visibility);
        console.log(`[AUTO-LEARN] Stored: "${fact.trim().substring(0, 60)}..."`);
      }
    }

    console.log(`[AUTO-LEARN] Extracted ${facts.length} fact(s) from conversation.`);
  } catch (err) {
    console.error('[AUTO-LEARN ERROR]', err);
  }
}
