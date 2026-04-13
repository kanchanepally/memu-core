import { pool } from '../db/connection';
import { fetchTodayEvents } from '../channels/calendar/google';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { generateResponse } from './provider';
import { sock } from '../channels/whatsapp';

export async function generateAndPushMorningBriefing(profileId: string) {
  try {
    // 1. Get WhatsApp Channel associated with the profile
    const channelRes = await pool.query(
      "SELECT channel_identifier FROM profile_channels WHERE profile_id = $1 AND channel = 'whatsapp' LIMIT 1", 
      [profileId]
    );
    
    if (channelRes.rows.length === 0) {
       console.log(`[BRIEFING ENGINE] No WhatsApp channel connected for profile ${profileId}. Aborting.`);
       return null;
    }
    const whatsappJid = channelRes.rows[0].channel_identifier;

    // 2. Extract Substantive Context
    const events = await fetchTodayEvents(profileId);
    const streamRes = await pool.query(
      `SELECT * FROM stream_cards WHERE family_id = $1 AND status = 'active' ORDER BY created_at DESC`, 
      [profileId]
    );

    // 3. Compile Raw State
    const eventsStr = events.map((e: any) => {
        const title = e.summary;
        // Parse time smoothly using Date
        const start = e.start.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'All Day';
        const end = e.end.dateTime ? new Date(e.end.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'All Day';
        return `${title} (${start} to ${end})`;
    }).join('\n');
    
    const streamStr = streamRes.rows.map((card: any) => `- [${card.card_type.toUpperCase()}] ${card.title}: ${card.body}`).join('\n');
    
    // Auto-silence if nothing is happening (Protects against Notification Fatigue)
    if (events.length === 0 && streamRes.rows.length === 0) {
      console.log(`[BRIEFING ENGINE] Zero events or stream items for profile ${profileId}. Skipping push.`);
      return null;
    }

    const compiledState = `TODAY'S CALENDAR:\n${eventsStr || 'No events.'}\n\nACTIVE ITEMS/COLLISIONS:\n${streamStr || 'No pending items.'}`;

    // 4. Translate out of Real Identity Scope
    const anonState = await translateToAnonymous(compiledState);

    // 5. Synthesize Context via Sonnet
    const prompt = `You are the family Chief of Staff. It is morning. Write a short, highly empathetic morning briefing directly to the parents based on the context below. Focus on being proactively helpful.
Your tone must be warm, casual, and highly competent. 
DO NOT simply list the items. Synthesize them like a trusted human assistant would. 
If there is a collision or tight overlap, flag it immediately and gently ask how they want to handle it.
If there are pending items, gently mention 1 or 2 of them to keep things moving.
Do NOT use markdown bolding or asterisks (they break WhatsApp formatting sometimes). Keep spacing natural.
Keep it firmly under 4 short paragraphs.

HERE IS THE FAMILY STATE FOR TODAY:
${anonState}`;

    console.log(`[BRIEFING ENGINE] Dispatching context synthesis to Claude...`);
    const claudeRaw = await generateResponse(prompt, []);

    // 6. Translate response back into Real Identity
    const realResponse = await translateToReal(claudeRaw);

    console.log(`[BRIEFING ENGINE GENERATED]:\n${realResponse}`);

    // 7. Dispatch directly to user's WhatsApp
    if (sock) {
      await sock.sendMessage(whatsappJid, { text: realResponse });
      console.log(`[BRIEFING ENGINE] Successfully pushed to ${whatsappJid}`);
    } else {
      console.error('[BRIEFING ENGINE] WhatsApp socket is currently disconnected. Cannot push message.');
    }
    
    return realResponse;
  } catch(err) {
    console.error('[BRIEFING ENGINE ERROR]:', err);
    return null;
  }
}
