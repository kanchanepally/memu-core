import { pool } from '../db/connection';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { dispatch } from '../skills/router';

export async function processGroupMessageExtraction(
  senderProfileId: string,
  content: string,
  channel: string,
  messageId: string
) {
  const anonContent = await translateToAnonymous(content);

  try {
    const { text: replyText } = await dispatch({
      skill: 'extraction',
      userMessage: anonContent,
      profileId: senderProfileId,
      familyId: senderProfileId,
      maxTokens: 800,
      temperature: 0,
    });

    const jsonMatch = replyText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const extractions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(extractions) || extractions.length === 0) {
      console.log(`[EXTRACTION] Ignored non-substantive chatter.`);
      return;
    }

    const familyId = senderProfileId;

    for (const extraction of extractions) {
      const realTitle = await translateToReal(extraction.title);
      const realBody = await translateToReal(extraction.body);

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
