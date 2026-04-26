import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket, proto, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { handleIncomingMessage } from '../intelligence/orchestrator';
import qrcode from 'qrcode-terminal';
import { pool } from '../db/connection';

// Silent logger for Baileys to avoid polluting console with connection spam
const logger = pino({ level: 'silent' });

export let sock: WASocket | null = null;

/**
 * Ingestion mode — controls which incoming WhatsApp messages get handed to
 * the intelligence pipeline.
 *
 *   self_only (default, safe)
 *     Only messages in the user's own self-chat ("Message yourself" / "notes
 *     to self"). Everything else — group chats, family threads, friends,
 *     newsletters, status updates — is ignored. Stops the ingestion pipeline
 *     from chewing through cloud quota processing thousands of unrelated
 *     messages.
 *
 *   all (legacy "omnivorous")
 *     Process every message Baileys delivers (except those Memu sent
 *     itself). Original behaviour. Set MEMU_WHATSAPP_INGESTION=all to
 *     restore.
 *
 * Implementation: we compare msg.key.remoteJid against the bot's own JID
 * (sock.user.id stripped of device suffix). In a WhatsApp self-chat the
 * remote party IS yourself, so remoteJid equals your own number@s.whatsapp.net.
 */
type IngestionMode = 'self_only' | 'all';
function resolveIngestionMode(): IngestionMode {
  const raw = (process.env.MEMU_WHATSAPP_INGESTION || 'self_only').trim().toLowerCase();
  if (raw === 'all' || raw === 'self_only') return raw;
  console.warn(`[WHATSAPP] Ignoring invalid MEMU_WHATSAPP_INGESTION="${raw}" — using self_only`);
  return 'self_only';
}

/**
 * Strip the device-suffix from a Baileys JID. `447000000000:1@s.whatsapp.net`
 * → `447000000000@s.whatsapp.net`. The self-chat remoteJid is the suffix-less
 * form; the bot's own user.id may include a `:N` device tag.
 */
export function normaliseJid(jid: string | undefined | null): string | null {
  if (!jid) return null;
  return jid.replace(/:\d+(?=@)/, '');
}

/**
 * Decide whether a given Baileys message should be ingested under the
 * configured mode. Pure helper — testable without a live socket.
 */
export function shouldIngest(
  remoteJid: string | undefined | null,
  ownJid: string | undefined | null,
  mode: IngestionMode,
): boolean {
  if (mode === 'all') return true;
  const remote = normaliseJid(remoteJid);
  const own = normaliseJid(ownJid);
  if (!remote || !own) return false;
  return remote === own;
}

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
      const ownJid = sock?.user?.id ?? '(unknown)';
      console.log(`✅ WhatsApp connected — own JID ${ownJid}, ingestion mode: ${ingestionMode}`);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  const ingestionMode = resolveIngestionMode();
  let skippedSinceStart = 0;
  let lastSkipLog = 0;

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        // Filter out messages Memu itself sent (Baileys v6+ uses the BAE5 prefix on outbound IDs).
        const isFromBot = msg.key.fromMe && msg.key.id?.startsWith('BAE5');
        if (!msg.message || isFromBot || !msg.key.remoteJid) continue;

        // Ingestion gate — by default only the user's own self-chat is processed,
        // so Memu doesn't burn extraction-skill quota on every group/friend/
        // newsletter chat the user happens to be in. Override via
        // MEMU_WHATSAPP_INGESTION=all if you want the legacy omnivorous mode.
        const ownJid = sock!.user?.id;
        if (!shouldIngest(msg.key.remoteJid, ownJid, ingestionMode)) {
          skippedSinceStart += 1;
          // Throttle the summary log to once a minute so the console isn't spammy.
          const now = Date.now();
          if (now - lastSkipLog > 60_000) {
            console.log(`[WHATSAPP] Skipped ${skippedSinceStart} messages (mode: ${ingestionMode}); set MEMU_WHATSAPP_INGESTION=all to disable filter`);
            lastSkipLog = now;
          }
          continue;
        }

        try {
          await handleIncomingMessage(sock!, msg);
        } catch (err) {
          console.error('[WHATSAPP] Error handling incoming message:', err);
        }
      }
    }
  });

  return sock;
}
