import { db } from '../db/tenant';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { dispatch } from '../skills/router';

/**
 * Map a callsite-supplied channel string to a value the
 * `stream_cards.source` CHECK constraint accepts. The orchestrator passes
 * the raw channel ('mobile', 'pwa', a WhatsApp JID like
 * '447xxx@s.whatsapp.net' or '123-456@g.us', etc.) and we normalise here.
 *
 * Pure helper — exported for tests. If you add a new channel, add it to
 * the schema CHECK in migrations/020_stream_cards_source_check.sql before
 * adding a branch here, otherwise the INSERT will reject.
 */
export function channelToSource(channel: string): string {
  if (!channel) return 'manual';
  if (channel.endsWith('@g.us')) return 'whatsapp_group';
  if (channel.endsWith('@s.whatsapp.net') || channel.endsWith('@c.us')) return 'whatsapp_dm';
  if (channel === 'mobile') return 'mobile';
  if (channel === 'pwa') return 'pwa';
  if (channel === 'manual_list_input') return 'manual';
  if (channel === 'briefing') return 'briefing';
  return 'manual';
}

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
    const source = channelToSource(channel);

    for (const extraction of extractions) {
      const realTitle = await translateToReal(extraction.title);
      const realBody = await translateToReal(extraction.body);

      await db.query(
        `INSERT INTO stream_cards (family_id, card_type, title, body, source, source_message_id, actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          familyId,
          extraction.card_type || 'extraction',
          realTitle,
          realBody,
          source,
          messageId,
          JSON.stringify(extraction.actions || [])
        ]
      );
      console.log(`[EXTRACTION STREAM CARD CREATED]: ${realTitle} (source=${source})`);
    }
  } catch (err) {
    console.error('[EXTRACTION ERROR]', err);
  }
}
