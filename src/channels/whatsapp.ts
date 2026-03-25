import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket, proto, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { handleIncomingMessage } from '../intelligence/orchestrator';
import qrcode from 'qrcode-terminal';

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
    browser: ['Memu', 'Chrome', '1.0.0'], // Prevents the rapid disconnect loop on new versions
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
        // Allow messages from the user's phone, but filter out messages sent by Memu (Baileys generates IDs starting with BAE5 or 3E0B depending on version)
        const isFromBot = msg.key.fromMe && (msg.key.id?.startsWith('BAE5') || msg.key.id?.length === 22);
        
        if (msg.message && !isFromBot) {
          await handleIncomingMessage(sock!, msg);
        }
      }
    }
  });

  return sock;
}
