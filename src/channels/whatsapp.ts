import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket, proto, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { handleIncomingMessage } from '../intelligence/orchestrator';
import qrcode from 'qrcode-terminal';
import { pool } from '../db/connection';

// Silent logger for Baileys to avoid polluting console with connection spam
const logger = pino({ level: 'silent' });

export let sock: WASocket | null = null;

export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);
  
  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('Desktop'), // Robust anti-disconnect configuration
    printQRInTerminal: false
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    // Explicitly handle the new QR event
    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const errorStr = (lastDisconnect?.error as Boom)?.message || lastDisconnect?.error?.toString();
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      
      console.log(`⚠️ WhatsApp connection closed. Reason: ${errorStr}`);
      console.log(`🔄 Reconnecting: ${shouldReconnect}`);
      
      if (shouldReconnect) {
        // Wait 2 seconds before reconnecting to prevent infinite crash loops
        setTimeout(connectToWhatsApp, 2000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        // Allow messages from the user's phone, but filter out messages sent by Memu 
        // (Baileys v6+ generates IDs starting with BAE5)
        const isFromBot = msg.key.fromMe && msg.key.id?.startsWith('BAE5');
        
        if (msg.message && !isFromBot && msg.key.remoteJid) {
          try {
            // Phase 1: Omnivorous Ingestion
            // We now ingest ALL messages (except from bots) and dump them into the Raw Inbox Queue.
            // The batched Chief of Staff engine will sort through them later.
            await handleIncomingMessage(sock!, msg);
          } catch (err) {
            console.error('[WHATSAPP] Error handling incoming message:', err);
          }
        }
      }
    }
  });

  return sock;
}
