import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/connection';
import { translateToAnonymous, translateToReal } from '../twin/translator';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function processGroupMessageExtraction(
  senderProfileId: string, 
  content: string, 
  groupId: string, 
  messageId: string
) {
  // 1. Twin Translation (Real -> Anonymous)
  const anonContent = await translateToAnonymous(content);
  
  // 2. Fast Claude Haiku Pipeline for Substantive Extraction
  const systemPrompt = `You are a family Chief of Staff observing a group chat. Analyze this incoming message.
If it contains an actionable task, a scheduling requirement, a collision, or important context for the family, extract it into a JSON object.
If it is just casual chatter (e.g. "ok", "thanks", "lol", "on my way"), return an empty JSON object {}.

JSON Schema:
{
  "is_substantive": boolean,
  "card_type": "extraction" | "reminder" | "collision",
  "title": "A brief, clear title (e.g., 'Book dentist')",
  "body": "Detailed extraction or task description",
  "actions": [{"label": "Action name", "type": "action_id"}]
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: anonContent }],
      temperature: 0
    });

    const replyText = response.content[0].type === 'text' ? response.content[0].text : '';
    
    // Parse JSON safely
    const jsonMatch = replyText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    
    const extraction = JSON.parse(jsonMatch[0]);
    if (!extraction.is_substantive) {
        console.log(`[EXTRACTION] Ignored non-substantive chatter.`);
        return;
    }

    // 3. Translate BACK to Real Domain
    const realTitle = await translateToReal(extraction.title);
    const realBody = await translateToReal(extraction.body);

    // Get the primary Family ID for Dashboard display (Slice 2 hack before Auth)
    const adultRes = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
    const familyId = adultRes.rows.length > 0 ? adultRes.rows[0].id : senderProfileId;

    // 4. Inject into stream_cards linearly
    await pool.query(
      `INSERT INTO stream_cards (family_id, card_type, title, body, source, source_message_id, actions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        familyId, 
        extraction.card_type || 'extraction',
        realTitle,
        realBody,
        'whatsapp_group',
        messageId,
        JSON.stringify(extraction.actions || [])
      ]
    );

    console.log(`[EXTRACTION STREAM CARD CREATED]: ${realTitle}`);
  } catch (err) {
    console.error('[EXTRACTION ERROR]', err);
  }
}
