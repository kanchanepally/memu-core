import { WASocket, proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { getClaudeResponse } from './claude';
import { retrieveRelevantContext } from './context';
import { processGroupMessageExtraction } from './extraction';
import { processVisualDocumentExtraction } from './vision';
import { scrapeUrlContent } from './browser';
import { pool } from '../db/connection';

// Shared pipeline for both WhatsApp and PWA Web Frontend to guarantee absolute parity
export async function processIntelligencePipeline(profileId: string, content: string, channel: string, messageId: string = 'unknown'): Promise<string> {
  // 1. Twin Translation (Real -> Anonymous)
  const anonymousMsg = await translateToAnonymous(content);
  console.log(`[IN -> Translated]: ${anonymousMsg}`);

  // 2. Context Retrieval (Slice 2a RAG)
  const rawContexts = await retrieveRelevantContext(content, 3);
  
  const anonymousContexts = [];
  for (const ctx of rawContexts) {
    anonymousContexts.push(await translateToAnonymous(ctx));
  }
  if (anonymousContexts.length > 0) {
    console.log(`[CONTEXT -> Injected]: ${anonymousContexts.length} relevant facts found.`);
  }

  // 3. Claude API
  const claudeResponse = await getClaudeResponse(anonymousMsg, anonymousContexts);
  console.log(`[CLAUDE -> Raw]: ${claudeResponse}`);

  // 4. Reverse Translation (Anonymous -> Real)
  const realResponse = await translateToReal(claudeResponse);

  // 5. Immutable Message Storage (Audit Trail required for Tier 1 Trust)
  await storeMessageAudit(profileId, content, anonymousMsg, claudeResponse, realResponse, channel, messageId);

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
  
  // NOTE: Safety lock removed. Because you are running the bot on your office number, 
  // you need to be able to text it from your personal number.
  // In production, we will lock this down to a strict whitelist of known family numbers.

  try {
    const participantJid = msg.key?.participant || senderJid;
    const profileId = await lookupOrCreateProfile(participantJid);

    // Slice 5: Document Ingestion (Vision)
    if (isImage) {
        await sock.sendMessage(senderJid, { text: "Scanning document..." });
        
        const buffer = await downloadMediaMessage(
            msg as import('@whiskeysockets/baileys').WAMessage,
            'buffer',
            { },
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

    // Agentic Execution: Always run background extraction to populate Shopping List / Calendar Tasks natively
    await processGroupMessageExtraction(profileId, content, senderJid, msg.key?.id || 'unknown');

    // Slice 2d: WhatsApp Group Observer Pipeline
    // If it's a group, we intentionally swallowed it (no conversational reply) to avoid bot spam
    if (senderJid.endsWith('@g.us')) {
        return;
    }
    
    // Slice 1: Intelligent Chat
    const realResponse = await processIntelligencePipeline(profileId, content, 'whatsapp', msg.key?.id || 'unknown');
    await sock.sendMessage(senderJid, { text: realResponse });
  } catch (err) {
    console.error('Error handling incoming message:', err);
    await sock.sendMessage(senderJid, { text: "Sorry, I encountered an internal error processing that." });
  }
}

async function lookupOrCreateProfile(jid: string): Promise<string> {
  // First, check if channel exists
  const res = await pool.query('SELECT profile_id FROM profile_channels WHERE channel_identifier = $1', [jid]);
  if (res.rows.length > 0) {
    return res.rows[0].profile_id;
  }
  
  // Auto-create for Slice 1 testing
  console.log(`Creating test profile for new number: ${jid}`);
  const idRes = await pool.query('INSERT INTO profiles (display_name, role) VALUES ($1, $2) RETURNING id', ['Test WhatsApp User', 'adult']);
  const newProfileId = idRes.rows[0].id;
  
  await pool.query('INSERT INTO profile_channels (profile_id, channel, channel_identifier) VALUES ($1, $2, $3)', [newProfileId, 'whatsapp', jid]);
  
  // Also create an associated Persona for translation
  await pool.query('INSERT INTO personas (id, profile_id, persona_label) VALUES ($1, $2, $3)', [`adult-${Date.now()}`, newProfileId, 'Adult-1']);

  return newProfileId;
}

async function storeMessageAudit(profileId: string, original: string, translated: string, claudeRaw: string, realResp: string, channel: string, messageId: string) {
  // Get or Create conversation
  let convId;
  const convRes = await pool.query('SELECT id FROM conversations WHERE profile_id = $1 ORDER BY started_at DESC LIMIT 1', [profileId]);
  
  if (convRes.rows.length === 0) {
    const newConv = await pool.query('INSERT INTO conversations (profile_id) VALUES ($1) RETURNING id', [profileId]);
    convId = newConv.rows[0].id;
  } else {
    convId = convRes.rows[0].id;
  }

  await pool.query(
    `INSERT INTO messages 
    (id, conversation_id, profile_id, role, content_original, content_translated, content_response_raw, content_response_translated, channel)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      messageId,
      convId, 
      profileId, 
      'user', 
      original, 
      translated, 
      claudeRaw, 
      realResp,
      channel
    ]
  );
}
