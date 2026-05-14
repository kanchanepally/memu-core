import { db } from '../db/tenant';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { dispatch } from '../skills/router';
import {
  postCardAsMessage,
  getOrCreateActiveConversation,
  type StreamCardType,
  type StreamCardSource,
} from '../canvas/timeline';

export interface ChatVisionCard {
  cardType: string;
  title: string;
  body: string;
}

export interface ChatVisionResult {
  cards: ChatVisionCard[];
  response: string;
}

/**
 * Mobile chat vision pipeline. A user sends a photo (optionally with a
 * caption) from the chat tab; the vision skill extracts stream cards and
 * we return a human-readable summary for the chat bubble. Separate from
 * processVisualDocumentExtraction because the WhatsApp path only cares
 * about a count, while chat needs the real titles to echo back.
 */
export async function processChatVisionInput(
  profileId: string,
  imageBuffer: Buffer,
  mimeType: string,
  caption: string,
  messageId: string,
  channel: string,
): Promise<ChatVisionResult> {
  const base64Image = imageBuffer.toString('base64');
  const anonCaption = caption ? await translateToAnonymous(caption) : '';
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
    return { cards: [], response: "I looked at that photo but couldn't find anything actionable." };
  }

  let extractions: Array<{ card_type?: string; title?: string; body?: string; actions?: unknown[] }> = [];
  try {
    extractions = JSON.parse(jsonMatch[0]);
  } catch {
    return { cards: [], response: "I looked at that photo but couldn't parse what I found." };
  }

  if (!Array.isArray(extractions) || extractions.length === 0) {
    return { cards: [], response: "Nothing actionable in that photo." };
  }

  // Phase A.2 — chat-vision cards land on the Canvas timeline.
  // Side-fix: the prior code passed source='photo' for mobile/pwa channels,
  // which violates `stream_cards_source_check` (CHECK only allows the
  // values in migration 020). Effect: chat-photo extraction was silently
  // erroring on insert. Now: source maps to the actual channel
  // ('mobile' or 'pwa'); WhatsApp paths preserve their channel value.
  const cards: ChatVisionCard[] = [];
  const conversationId = await getOrCreateActiveConversation(profileId);
  const visionSource = (channel === 'mobile' || channel === 'pwa')
    ? (channel as StreamCardSource)
    : (channel as StreamCardSource);
  for (let i = 0; i < extractions.length; i++) {
    const ex = extractions[i];
    const cardType = (typeof ex.card_type === 'string' ? ex.card_type : 'extraction') as StreamCardType;
    const realTitle = await translateToReal(typeof ex.title === 'string' ? ex.title : '(untitled)');
    const realBody = await translateToReal(typeof ex.body === 'string' ? ex.body : '');

    await postCardAsMessage({
      familyId: profileId,
      conversationId,
      profileId,
      channel,
      card: {
        type: cardType,
        title: realTitle,
        body: realBody,
        source: visionSource,
        sourceMessageId: `${messageId}-vi-${i}`,
        // Skill output is permissive (Array<unknown>). The card-action shape
        // is enforced by the consuming action endpoints, not at write time —
        // matches the previous JSON.stringify(ex.actions ?? []) behaviour.
        actions: Array.isArray(ex.actions) ? (ex.actions as unknown as import('../canvas/timeline').StreamCardAction[]) : [],
      },
      messageType: 'action_nudge',
    });

    cards.push({ cardType, title: realTitle, body: realBody });
  }

  const titleList = cards.map(c => c.title).filter(Boolean);
  const listText = titleList.length === 1
    ? titleList[0]
    : titleList.length === 2
      ? `${titleList[0]} and ${titleList[1]}`
      : `${titleList.slice(0, -1).join(', ')}, and ${titleList[titleList.length - 1]}`;
  const response = `I pulled ${cards.length === 1 ? 'one thing' : `${cards.length} things`} from that photo: ${listText}. They're in your stream.`;

  return { cards, response };
}

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

    const adultRes = await db.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
    const familyId = adultRes.rows.length > 0 ? adultRes.rows[0].id : profileId;

    // Phase A.2 — WhatsApp document-vision cards land on the Canvas
    // timeline (the user's conversation), not just on the Today feed.
    const conversationId = await getOrCreateActiveConversation(profileId);
    for (const extraction of extractions) {
      const realTitle = await translateToReal(extraction.title);
      const realBody = await translateToReal(extraction.body);

      await postCardAsMessage({
        familyId,
        conversationId,
        profileId,
        channel: 'whatsapp_dm',
        card: {
          type: (extraction.card_type || 'document_extracted') as StreamCardType,
          title: realTitle,
          body: realBody,
          source: 'document',
          sourceMessageId: messageId,
          actions: Array.isArray(extraction.actions) ? (extraction.actions as unknown as import('../canvas/timeline').StreamCardAction[]) : [],
        },
        messageType: 'action_nudge',
      });
      console.log(`[DOCUMENT STREAM CARD CREATED]: ${realTitle}`);
    }

    return extractions.length;
  } catch (err) {
    console.error('[VISION ERROR]', err);
    return 0;
  }
}
