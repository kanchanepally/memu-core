import { pool } from '../db/connection';
import { fetchUpcomingEvents } from '../channels/calendar/google';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { dispatch } from '../skills/router';
import { sock } from '../channels/whatsapp';
import { getTokensForProfile, sendPush } from '../channels/mobile';
import { listDomainStates, renderDomainHealthHeader } from '../domains/health';

import { processSynthesisUpdate } from './synthesis';
import { interactiveQueryTools } from './tools';

export async function generateProactiveSynthesis(profileId: string): Promise<string | null> {
  // Deprecated direct proactive synthesis. 
  // We now route through the batched Chief of Staff engine.
  return await chiefOfStaffBatchProcess(profileId);
}

export async function chiefOfStaffBatchProcess(profileId: string): Promise<string | null> {
  try {
    // 1. Fetch un-processed inbox messages
    const inboxRes = await pool.query(
      `SELECT id, channel, sender_jid, content, created_at 
       FROM inbox_messages 
       WHERE profile_id = $1 AND processed = false 
       ORDER BY created_at ASC`,
      [profileId]
    );

    let inboxTranscript = 'No new messages.';
    let messageIds: string[] = [];

    if (inboxRes.rows.length > 0) {
      inboxTranscript = inboxRes.rows.map(r => 
        `[${new Date(r.created_at).toLocaleTimeString()}] via ${r.channel} from ${r.sender_jid}:\n${r.content}`
      ).join('\n\n');
      messageIds = inboxRes.rows.map(r => r.id);
    }

    // 2. Fetch context (Calendar & Active Stream Cards)
    const upcomingEvents = await fetchUpcomingEvents(profileId);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const events = upcomingEvents.filter(e => {
        const startTime = e.start?.dateTime || e.start?.date || null;
        if (!startTime) return false;
        return new Date(startTime) <= todayEnd;
    });

    const streamRes = await pool.query(
      `SELECT * FROM stream_cards WHERE family_id = $1 AND status = 'active' ORDER BY created_at DESC`, 
      [profileId]
    );

    const eventsStr = events.map((e: any) => {
        const title = e.summary;
        const start = e.start.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'All Day';
        const end = e.end.dateTime ? new Date(e.end.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'All Day';
        return `${title} (${start} to ${end})`;
    }).join('\n');
    
    const streamStr = streamRes.rows.map((card: any) => `- [${card.card_type.toUpperCase()}] ${card.title}: ${card.body}`).join('\n');

    // 3. Anonymise the inbox transcript for privacy
    const anonTranscript = await translateToAnonymous(inboxTranscript);

    // 4. Dispatch to Chief of Staff LLM
    console.log(`[CHIEF OF STAFF] Processing batch of ${messageIds.length} messages for ${profileId}...`);
    const { text: llmRaw } = await dispatch({
      skill: 'chief_of_staff',
      templateVars: {
        inbox_transcript: anonTranscript,
        calendar_events: eventsStr || 'No events.',
        active_cards: streamStr || 'No pending items.'
      },
      profileId,
      tools: interactiveQueryTools,
      toolContext: {
        familyId: profileId,
        profileId: profileId,
        channel: 'batch',
        messageId: `batch-${Date.now()}`
      }
    });

    // 5. Parse JSON
    let parsed: any;
    try {
      const cleanJson = llmRaw.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.error('[CHIEF OF STAFF] JSON Parse Error. Raw response:', llmRaw);
      throw new Error('Chief of Staff returned invalid JSON format.');
    }

    if (!parsed.briefing_markdown) {
      throw new Error('Chief of Staff response missing briefing_markdown field.');
    }

    // 6. Translate back to Real Identity
    const realBriefing = await translateToReal(parsed.briefing_markdown);

    // 7. Save the Briefing as a Stream Card
    await pool.query(
      `INSERT INTO stream_cards (id, family_id, title, body, card_type, source, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [`card-cos-${Date.now()}`, profileId, 'Chief of Staff Briefing', realBriefing, 'briefing', 'chief_of_staff', 'active']
    );

    // 8. Trigger Living Wiki (Spaces) Update
    if (messageIds.length > 0) {
      console.log(`[CHIEF OF STAFF] Triggering Wiki update cycle...`);
      // We pass the raw transcript and the generated briefing as context to the Synthesis engine
      // so it can extract durable facts into the Markdown Spaces.
      processSynthesisUpdate(profileId, anonTranscript, parsed.briefing_markdown).catch(err => {
        console.error('[SYNTHESIS] Background synthesis update failed:', err);
      });
    }

    // 9. Mark messages as processed
    if (messageIds.length > 0) {
      await pool.query(
        `UPDATE inbox_messages SET processed = true WHERE id = ANY($1)`,
        [messageIds]
      );
    }

    console.log(`[CHIEF OF STAFF] Batch complete. Briefing generated.`);
    return realBriefing;
  } catch(err: any) {
    console.error('[CHIEF OF STAFF ERROR]:', err);
    throw err;
  }
}

export async function generateAndPushMorningBriefing(profileId: string) {
  // Phase 2: Chief of Staff Architecture
  // We no longer PUSH briefings via WhatsApp (silence rule).
  // This function now simply triggers the batch processor which saves the briefing
  // to the dashboard as a stream card.
  console.log(`[BRIEFING ENGINE] Manually triggered Chief of Staff batch process for ${profileId}`);
  return await chiefOfStaffBatchProcess(profileId);
}

// Mobile-first briefing: generate the same synthesis and deliver it as
// an Expo push notification that deep-links to the Today tab.
export async function pushMorningBriefingToMobile(profileId: string): Promise<string | null> {
  try {
    const tokens = await getTokensForProfile(profileId);
    if (tokens.length === 0) {
      console.log(`[BRIEFING PUSH] No push tokens for ${profileId}. Skipping.`);
      return null;
    }

    const briefing = await generateProactiveSynthesis(profileId);
    if (!briefing) {
      console.log(`[BRIEFING PUSH] No briefing content for ${profileId}.`);
      return null;
    }

    // Push notifications have tight body limits — first sentence leads, full
    // text opens in-app via the Today tab.
    const firstSentence = briefing.split(/(?<=[.!?])\s/)[0] || briefing;
    const body = firstSentence.length > 180
      ? `${firstSentence.slice(0, 177)}…`
      : firstSentence;

    await sendPush(tokens, {
      title: 'Good morning',
      body,
      data: { screen: 'today', kind: 'briefing' },
    });

    console.log(`[BRIEFING PUSH] Delivered to ${tokens.length} device(s) for ${profileId}.`);
    return briefing;
  } catch (err) {
    console.error('[BRIEFING PUSH ERROR]:', err);
    return null;
  }
}
