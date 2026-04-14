import { WASocket, proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { generateResponse, ConversationMessage } from './provider';
import { retrieveRelevantContext, type Visibility } from './context';
import { processGroupMessageExtraction } from './extraction';
import { processVisualDocumentExtraction } from './vision';
import { extractAndStoreFacts } from './autolearn';
import { scrapeUrlContent } from './browser';
import { pool } from '../db/connection';
import { processSynthesisUpdate } from './synthesis';

const HISTORY_LIMIT = 10; // Last N message pairs for multi-turn conversation
const CONVERSATION_GAP_MS = 30 * 60 * 1000; // 30 minutes — start new conversation after this gap

// Fetch recent conversation history for a profile, already in anonymous form
async function getConversationHistory(profileId: string): Promise<ConversationMessage[]> {
  try {
    const convRes = await pool.query(
      'SELECT id FROM conversations WHERE profile_id = $1 ORDER BY started_at DESC LIMIT 1',
      [profileId]
    );
    if (convRes.rows.length === 0) return [];

    const convId = convRes.rows[0].id;

    const msgRes = await pool.query(
      `SELECT content_translated, content_response_raw
       FROM messages
       WHERE conversation_id = $1
         AND content_translated IS NOT NULL
         AND content_response_raw IS NOT NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [convId, HISTORY_LIMIT]
    );

    if (msgRes.rows.length === 0) return [];

    // Reverse to chronological order, then flatten into user/assistant pairs
    const history: ConversationMessage[] = [];
    const rows = msgRes.rows.reverse();
    for (const row of rows) {
      history.push({ role: 'user', content: row.content_translated });
      history.push({ role: 'assistant', content: row.content_response_raw });
    }
    return history;
  } catch (err) {
    console.error('Error fetching conversation history:', err);
    return [];
  }
}

// Get or create a conversation, starting a new one if the last message was >30 min ago
async function getOrCreateConversation(profileId: string): Promise<string> {
  const convRes = await pool.query(
    'SELECT id FROM conversations WHERE profile_id = $1 ORDER BY started_at DESC LIMIT 1',
    [profileId]
  );

  if (convRes.rows.length > 0) {
    const convId = convRes.rows[0].id;

    // Check if the last message in this conversation is recent enough
    const lastMsg = await pool.query(
      'SELECT created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [convId]
    );

    if (lastMsg.rows.length > 0) {
      const lastTime = new Date(lastMsg.rows[0].created_at).getTime();
      const now = Date.now();
      if (now - lastTime < CONVERSATION_GAP_MS) {
        return convId; // Continue existing conversation
      }
    } else {
      // Empty conversation — reuse it
      return convId;
    }
  }

  // Start a new conversation
  const newConv = await pool.query(
    'INSERT INTO conversations (profile_id) VALUES ($1) RETURNING id',
    [profileId]
  );
  return newConv.rows[0].id;
}

// Shared pipeline for both WhatsApp and mobile app
export async function processIntelligencePipeline(
  profileId: string,
  content: string,
  channel: string,
  messageId: string = 'unknown',
  visibility: Visibility = 'family',
): Promise<string> {
  // 1. Twin Translation (Real -> Anonymous)
  const anonymousMsg = await translateToAnonymous(content);
  console.log(`[IN -> Translated]: ${anonymousMsg}`);

  // 2. Context Retrieval — scoped to this profile and visibility layer
  const rawContexts = await retrieveRelevantContext(content, 3, profileId, visibility);

  const anonymousContexts = [];
  for (const ctx of rawContexts) {
    anonymousContexts.push(await translateToAnonymous(ctx));
  }
  if (anonymousContexts.length > 0) {
    console.log(`[CONTEXT -> Injected]: ${anonymousContexts.length} relevant facts found.`);
  }

  // 3. Fetch conversation history (already anonymous from prior audit storage)
  const history = await getConversationHistory(profileId);
  if (history.length > 0) {
    console.log(`[HISTORY -> Loaded]: ${history.length / 2} previous exchanges.`);
  }

  // 4. LLM call (provider selected via MEMU_LLM_PROVIDER; Digital Twin guarantees anonymity regardless)
  const claudeResponse = await generateResponse(anonymousMsg, anonymousContexts, history);
  console.log(`[LLM -> Raw]: ${claudeResponse}`);

  // 5. Reverse Translation (Anonymous -> Real)
  const realResponse = await translateToReal(claudeResponse);

  // 6. Immutable Message Storage (Audit Trail)
  await storeMessageAudit(profileId, content, anonymousMsg, claudeResponse, realResponse, channel, messageId);

  // 7. Auto-learning: extract durable facts in the background (fire-and-forget)
  extractAndStoreFacts(profileId, anonymousMsg, claudeResponse, visibility).catch(err => {
    console.error('[AUTO-LEARN] Background extraction failed:', err);
  });

  // 8. Stream card extraction from chat messages (fire-and-forget)
  processGroupMessageExtraction(profileId, content, channel, messageId).catch(err => {
    console.error('[EXTRACTION] Background extraction failed:', err);
  });

  // 9. Synthesis Page Update (fire-and-forget)
  processSynthesisUpdate(profileId, anonymousMsg, claudeResponse).catch(err => {
    console.error('[SYNTHESIS] Background synthesis update failed:', err);
  });

  return realResponse;
}

export async function handleIncomingMessage(sock: WASocket, msg: proto.IWebMessageInfo) {
  const senderJid = msg.key?.remoteJid;

  const isImage = !!msg.message?.imageMessage;
  const imageMessage = msg.message?.imageMessage;
  let content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || (isImage ? imageMessage?.caption || '' : '');

  if (!senderJid) return;
  if (!content && !isImage) return;

  // Intercept URLs and inject scraped context implicitly
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = content.match(urlRegex);
  if (urls && urls.length > 0) {
    await sock.sendMessage(senderJid, { text: "Reading link..." });
    for (const url of urls) {
      const scraped = await scrapeUrlContent(url);
      if (scraped) {
        content += `\n${scraped}`;
      }
    }
  }

  try {
    const participantJid = msg.key?.participant || senderJid;
    const profileId = await lookupOrCreateProfile(participantJid);

    // Document Ingestion (Vision)
    if (isImage) {
      await sock.sendMessage(senderJid, { text: "Scanning document..." });

      const buffer = await downloadMediaMessage(
        msg as import('@whiskeysockets/baileys').WAMessage,
        'buffer',
        {},
        {
          logger: console as any,
          reuploadRequest: sock.updateMediaMessage
        }
      );

      if (buffer) {
        const mimeType = imageMessage?.mimetype || 'image/jpeg';
        const itemsFound = await processVisualDocumentExtraction(profileId, buffer as Buffer, mimeType, content, msg.key?.id || 'unknown');

        if (itemsFound && itemsFound > 0) {
          await sock.sendMessage(senderJid, { text: `Got it. I extracted ${itemsFound} action item(s) and logged them to your Intelligence Stream.` });
        } else {
          await sock.sendMessage(senderJid, { text: "I couldn't find any actionable deadlines or events in that image." });
        }
      }
      return;
    }

    // WhatsApp Group Observer — extract but don't reply
    if (senderJid.endsWith('@g.us')) {
      await processGroupMessageExtraction(profileId, content, senderJid, msg.key?.id || 'unknown');
      return;
    }

    // Direct Message — full intelligence pipeline
    const realResponse = await processIntelligencePipeline(profileId, content, 'whatsapp', msg.key?.id || 'unknown');
    await sock.sendMessage(senderJid, { text: realResponse });
  } catch (err) {
    console.error('Error handling incoming message:', err);
    await sock.sendMessage(senderJid, { text: "Sorry, I encountered an internal error processing that." });
  }
}

async function lookupOrCreateProfile(jid: string): Promise<string> {
  const res = await pool.query('SELECT profile_id FROM profile_channels WHERE channel_identifier = $1', [jid]);
  if (res.rows.length > 0) {
    return res.rows[0].profile_id;
  }

  console.log(`Creating test profile for new number: ${jid}`);
  const idRes = await pool.query('INSERT INTO profiles (display_name, role) VALUES ($1, $2) RETURNING id', ['Test WhatsApp User', 'adult']);
  const newProfileId = idRes.rows[0].id;

  await pool.query('INSERT INTO profile_channels (profile_id, channel, channel_identifier) VALUES ($1, $2, $3)', [newProfileId, 'whatsapp', jid]);
  await pool.query('INSERT INTO personas (id, profile_id, persona_label) VALUES ($1, $2, $3)', [`adult-${Date.now()}`, newProfileId, 'Adult-1']);

  return newProfileId;
}

async function storeMessageAudit(
  profileId: string,
  original: string,
  translated: string,
  claudeRaw: string,
  realResp: string,
  channel: string,
  messageId: string
) {
  const convId = await getOrCreateConversation(profileId);

  await pool.query(
    `INSERT INTO messages
    (id, conversation_id, profile_id, role, content_original, content_translated, content_response_raw, content_response_translated, channel)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [messageId, convId, profileId, 'user', original, translated, claudeRaw, realResp, channel]
  );

  // Update conversation message count
  await pool.query(
    'UPDATE conversations SET message_count = message_count + 1 WHERE id = $1',
    [convId]
  );
}
