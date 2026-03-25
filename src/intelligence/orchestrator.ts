import { WASocket, proto } from '@whiskeysockets/baileys';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { getClaudeResponse } from './claude';
import { pool } from '../db/connection';

export async function handleIncomingMessage(sock: WASocket, msg: proto.IWebMessageInfo) {
  const senderJid = msg.key?.remoteJid;
  const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  
  if (!content || !senderJid) return;
  
  // Slice 1: We only handle Direct Messages
  if (senderJid.endsWith('@g.us')) {
    console.log(`[Group Message ignored for Slice 1]: ${content}`);
    return;
  }

  // SAFETY LOCK: For personal number testing, ONLY respond to "Message Yourself" chats.
  // This completely prevents the bot from auto-replying to your friends or coworkers.
  if (!msg.key?.fromMe) {
    console.log(`[Safety Lock]: Ignored incoming message to protect your personal chats.`);
    return;
  }

  try {
    // 1. Profile Lookup
    const profileId = await lookupOrCreateProfile(senderJid);

    // 2. Twin Translation (Real -> Anonymous)
    const anonymousMsg = await translateToAnonymous(content);
    console.log(`[IN -> Translated]: ${anonymousMsg}`);

    // 3. Claude API
    const claudeResponse = await getClaudeResponse(anonymousMsg);
    console.log(`[CLAUDE -> Raw]: ${claudeResponse}`);

    // 4. Reverse Translation (Anonymous -> Real)
    const realResponse = await translateToReal(claudeResponse);

    // 5. WhatsApp Reply
    await sock.sendMessage(senderJid, { text: realResponse });

    // 6. Message Storage (Audit Trail)
    await storeMessageAudit(profileId, content, anonymousMsg, claudeResponse, realResponse, 'whatsapp', msg.key?.id || 'unknown');
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
