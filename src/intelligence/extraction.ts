import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/connection';
import { translateToAnonymous, translateToReal } from '../twin/translator';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function processGroupMessageExtraction(
  senderProfileId: string, 
  content: string, 
  channel: string, 
  messageId: string
) {
  // 1. Twin Translation (Real -> Anonymous)
  const anonContent = await translateToAnonymous(content);
  
  // 2. Fast Claude Haiku Pipeline for Substantive Extraction
  const systemPrompt = `You are a family Chief of Staff observing a group chat. Analyze this incoming message.
If it contains an actionable task, a scheduling requirement, a collision, or important context for the family, extract it into a JSON object.
If it is just casual chatter (e.g. "ok", "thanks", "lol", "on my way"), return an empty JSON array [].

JSON Schema (return an array of objects):
[
  {
    "card_type": "extraction" | "reminder" | "collision" | "shopping",
    "title": "A brief, clear title (e.g., 'Pay the plumber')",
    "body": "Detailed extraction including exact dates, times, and requirements found in the text",
    "actions": [{"label": "Action name", "type": "action_id"}]
  }
]`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: anonContent }],
      temperature: 0
    });

    const replyText = response.content[0].type === 'text' ? response.content[0].text : '';
    
    // Parse JSON safely
    const jsonMatch = replyText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;
    
    const extractions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(extractions) || extractions.length === 0) {
        console.log(`[EXTRACTION] Ignored non-substantive chatter.`);
        return;
    }

    const familyId = senderProfileId;

    for (const extraction of extractions) {
      // 3. Translate BACK to Real Domain
      const realTitle = await translateToReal(extraction.title);
      const realBody = await translateToReal(extraction.body);

      // 4. Inject into stream_cards linearly
      await pool.query(
        `INSERT INTO stream_cards (family_id, card_type, title, body, source, source_message_id, actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          familyId, 
          extraction.card_type || 'extraction',
          realTitle,
          realBody,
          channel.endsWith('@g.us') ? 'whatsapp_group' : channel,
          messageId,
          JSON.stringify(extraction.actions || [])
        ]
      );
      console.log(`[EXTRACTION STREAM CARD CREATED]: ${realTitle}`);
    }
  } catch (err) {
    console.error('[EXTRACTION ERROR]', err);
  }
}
