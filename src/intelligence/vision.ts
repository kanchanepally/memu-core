import { pool } from '../db/connection';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { dispatch } from '../skills/router';

export async function processVisualDocumentExtraction(
  profileId: string,
  imageBuffer: Buffer,
  mimeType: string,
  caption: string,
  messageId: string
) {
  const base64Image = imageBuffer.toString('base64');
  const anonCaption = caption ? await translateToAnonymous(caption) : '';

  try {
    const userText = anonCaption
      ? `Context from parent: ${anonCaption}`
      : 'Please extract all family intelligence from this document.';

    const { text: replyText } = await dispatch({
      skill: 'vision',
      userMessage: userText,
      images: [{ mediaType: mimeType, base64Data: base64Image }],
      profileId,
      maxTokens: 1024,
      temperature: 0,
    });

    const jsonMatch = replyText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`[VISION EXTRACTION] No actionable events found in document.`);
      return;
    }

    const extractions: any[] = JSON.parse(jsonMatch[0]);
    if (extractions.length === 0) {
      console.log(`[VISION EXTRACTION] Parsed empty array. Ignored.`);
      return;
    }

    const adultRes = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
    const familyId = adultRes.rows.length > 0 ? adultRes.rows[0].id : profileId;

    for (const extraction of extractions) {
      const realTitle = await translateToReal(extraction.title);
      const realBody = await translateToReal(extraction.body);

      await pool.query(
        `INSERT INTO stream_cards (family_id, card_type, title, body, source, source_message_id, actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          familyId,
          extraction.card_type || 'document',
          realTitle,
          realBody,
          'document',
          messageId,
          JSON.stringify(extraction.actions || [])
        ]
      );
      console.log(`[DOCUMENT STREAM CARD CREATED]: ${realTitle}`);
    }

    return extractions.length;
  } catch (err) {
    console.error('[VISION ERROR]', err);
    return 0;
  }
}
