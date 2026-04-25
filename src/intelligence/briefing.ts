import { pool } from '../db/connection';
import { fetchUpcomingEvents } from '../channels/calendar/google';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { dispatch } from '../skills/router';
import { getTokensForProfile, sendPush } from '../channels/mobile';
import { listDomainStates, renderDomainHealthHeader } from '../domains/health';

import { processSynthesisUpdate } from './synthesis';
import { interactiveQueryTools } from './tools';

const MAX_BRIEFING_PARAGRAPHS = 4;
const COLLISION_WINDOW_MS = 48 * 60 * 60 * 1000;

type BriefingChannel = 'app' | 'push' | 'whatsapp';

interface NormalisedEvent {
  title: string;
  startDate: Date | null;
  endDate: Date | null;
}

function normaliseEvents(events: any[]): NormalisedEvent[] {
  return events.map(e => {
    const startISO = e.start?.dateTime || null;
    const endISO = e.end?.dateTime || null;
    return {
      title: e.summary || '(untitled event)',
      startDate: startISO ? new Date(startISO) : null,
      endDate: endISO ? new Date(endISO) : null,
    };
  });
}

function detectCollisions(events: NormalisedEvent[]): string {
  const now = new Date();
  const horizon = new Date(now.getTime() + COLLISION_WINDOW_MS);
  const timed = events.filter(e =>
    e.startDate && e.endDate && e.startDate < horizon && e.endDate > now,
  );
  const lines: string[] = [];
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.startDate! < b.endDate! && b.startDate! < a.endDate!) {
        const dateLabel = a.startDate!.toLocaleDateString([], { weekday: 'short' });
        lines.push(`${dateLabel} ${fmt(a.startDate!)} ${a.title} overlaps ${fmt(b.startDate!)} ${b.title}`);
      }
    }
  }
  return lines.length === 0 ? 'None detected.' : lines.join('\n');
}

function formatEventLine(e: NormalisedEvent): string {
  if (!e.startDate) return `${e.title} (All Day)`;
  const start = e.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const end = e.endDate
    ? e.endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  const day = e.startDate.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} ${start}${end ? '–' + end : ''} ${e.title}`;
}

interface BriefingPayload {
  briefing_markdown: string;
  has_substantive_updates: boolean;
  suggested_actions?: Array<{ label: string; kind: string; payload: Record<string, unknown> }>;
}

// Deep-translate any string values inside a JSON-shaped value back to real
// names. The briefing's suggested_actions[] arrives in the anonymous namespace
// (kind: "reply_draft", label: "Reply to Adult-2", payload.text: "Hi Adult-2…")
// and must be reified before it's stored on the stream card the family will
// see. Walks objects + arrays, leaves non-string scalars untouched.
async function deepTranslateToReal<T>(value: T): Promise<T> {
  if (typeof value === 'string') {
    return (await translateToReal(value)) as unknown as T;
  }
  if (Array.isArray(value)) {
    const out = await Promise.all(value.map(v => deepTranslateToReal(v)));
    return out as unknown as T;
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([k, v]) => [k, await deepTranslateToReal(v)] as const),
    );
    return Object.fromEntries(entries) as unknown as T;
  }
  return value;
}

export async function runUnifiedBriefing(
  profileId: string,
  channel: BriefingChannel = 'app',
): Promise<string | null> {
  try {
    // 1. Inbox queue (WhatsApp accumulator). Empty is the morning-briefing case.
    const inboxRes = await pool.query(
      `SELECT id, channel, sender_jid, content, created_at
         FROM inbox_messages
        WHERE profile_id = $1 AND processed = false
        ORDER BY created_at ASC`,
      [profileId],
    );

    let inboxTranscript = 'No new messages.';
    let messageIds: string[] = [];
    if (inboxRes.rows.length > 0) {
      inboxTranscript = inboxRes.rows
        .map(r => `[${new Date(r.created_at).toLocaleTimeString()}] via ${r.channel} from ${r.sender_jid}:\n${r.content}`)
        .join('\n\n');
      messageIds = inboxRes.rows.map(r => r.id);
    }

    // 2. Calendar + deterministic collision detector. Bookkeeping, not LLM —
    // the LLM gets a structured collisions list, not raw events.
    const upcoming = await fetchUpcomingEvents(profileId);
    const normalised = normaliseEvents(upcoming);
    const horizon = new Date(Date.now() + COLLISION_WINDOW_MS);
    const inWindow = normalised.filter(e => !e.startDate || e.startDate <= horizon);
    const eventsStr = inWindow.length === 0
      ? 'No events in the next 48h.'
      : inWindow.map(formatEventLine).join('\n');
    const collisionsStr = detectCollisions(inWindow);

    // 3. Active stream cards (open commitments).
    const streamRes = await pool.query(
      `SELECT title, body, card_type FROM stream_cards
         WHERE family_id = $1 AND status = 'active'
         ORDER BY created_at DESC`,
      [profileId],
    );
    const streamStr = streamRes.rows.length === 0
      ? 'No pending items.'
      : streamRes.rows
          .map(c => `- [${c.card_type.toUpperCase()}] ${c.title}: ${c.body}`)
          .join('\n');

    // 4. Domain health header — at-a-glance sphere status.
    const domainStates = await listDomainStates(profileId);
    const domainHeaderRaw = domainStates.length === 0
      ? "Today's domains:\n(no standards seeded yet)"
      : renderDomainHealthHeader(domainStates);

    // 5. Twin invariant: every field that reaches the LLM is anonymised.
    // The Twin guard would refuse the call in throw mode anyway; doing it
    // here keeps the privacy ledger free of "auto-anonymised" noise.
    const [anonInbox, anonEvents, anonCollisions, anonCards, anonHeader] = await Promise.all([
      translateToAnonymous(inboxTranscript),
      translateToAnonymous(eventsStr),
      translateToAnonymous(collisionsStr),
      translateToAnonymous(streamStr),
      translateToAnonymous(domainHeaderRaw),
    ]);

    console.log(
      `[BRIEFING] Composing for ${profileId} — inbox=${messageIds.length} events=${inWindow.length} cards=${streamRes.rows.length} channel=${channel}`,
    );

    const { text: llmRaw } = await dispatch({
      skill: 'briefing',
      templateVars: {
        domain_header: anonHeader,
        calendar_events: anonEvents,
        active_cards: anonCards,
        inbox_transcript: anonInbox,
        collisions: anonCollisions,
        channel,
        max_paragraphs: String(MAX_BRIEFING_PARAGRAPHS),
      },
      profileId,
      familyId: profileId,
      tools: interactiveQueryTools,
      toolContext: {
        familyId: profileId,
        profileId,
        channel,
        messageId: `briefing-${Date.now()}`,
      },
    });

    // 6. Parse strict JSON.
    let parsed: BriefingPayload;
    try {
      const cleanJson = llmRaw.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.error('[BRIEFING] JSON Parse Error. Raw response:', llmRaw);
      throw new Error('Briefing skill returned invalid JSON.');
    }
    if (!parsed.briefing_markdown) {
      throw new Error('Briefing skill response missing briefing_markdown field.');
    }

    // 7. Mark inbox processed regardless of substantive flag — they have been
    // read and synthesised. Re-showing them next batch would be churn.
    if (messageIds.length > 0) {
      await pool.query(
        `UPDATE inbox_messages SET processed = true WHERE id = ANY($1)`,
        [messageIds],
      );
    }

    // 8. Twin reverse — back to real names for the human reader.
    const realBriefing = await translateToReal(parsed.briefing_markdown);

    // 9. Substantive-updates gate. A quiet day prints to the log but does not
    // litter the Today tab. The Today tab is signal; the calendar tab is reference.
    const isSubstantive = parsed.has_substantive_updates === true;

    // 10. Always feed the Wiki — synthesis_update extracts durable facts
    // from anything we processed, regardless of card persistence.
    if (messageIds.length > 0) {
      processSynthesisUpdate(profileId, anonInbox, parsed.briefing_markdown).catch(err => {
        console.error('[SYNTHESIS] Background synthesis update failed:', err);
      });
    }

    if (!isSubstantive) {
      console.log('[BRIEFING] No substantive updates; not persisting a stream card.');
      return realBriefing;
    }

    // Reify the suggested_actions back to real names before persisting. The
    // skill emits them in the anonymous namespace (Twin invariant). Mobile
    // renders them verbatim to the user.
    const realActions = parsed.suggested_actions
      ? await deepTranslateToReal(parsed.suggested_actions)
      : [];

    await pool.query(
      `INSERT INTO stream_cards (id, family_id, title, body, card_type, source, status, actions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        `card-briefing-${Date.now()}`,
        profileId,
        'Chief of Staff Briefing',
        realBriefing,
        'briefing',
        'briefing',
        'active',
        JSON.stringify(realActions),
      ],
    );

    console.log(`[BRIEFING] Persisted briefing card with ${realActions.length} suggested action(s).`);
    return realBriefing;
  } catch (err: any) {
    console.error('[BRIEFING ERROR]:', err);
    throw err;
  }
}

// Compatibility alias for older call sites.
export const chiefOfStaffBatchProcess = runUnifiedBriefing;

export async function generateProactiveSynthesis(profileId: string): Promise<string | null> {
  return await runUnifiedBriefing(profileId, 'app');
}

export async function generateAndPushMorningBriefing(profileId: string) {
  console.log(`[BRIEFING ENGINE] Triggered for ${profileId}`);
  return await runUnifiedBriefing(profileId, 'app');
}

// Mobile push delivery: same briefing, channel='push' so the skill knows it
// is going to a notification body (light markdown allowed).
export async function pushMorningBriefingToMobile(profileId: string): Promise<string | null> {
  console.log(`[BRIEFING PUSH] Starting for profile ${profileId}`);
  try {
    const tokens = await getTokensForProfile(profileId);
    console.log(`[BRIEFING PUSH] ${tokens.length} push token(s) registered for ${profileId}`);
    if (tokens.length === 0) {
      console.log(`[BRIEFING PUSH] No push tokens for ${profileId} — skipping. (User has not opened the app, or notification permission was denied.)`);
      return null;
    }

    const briefing = await runUnifiedBriefing(profileId, 'push');
    if (!briefing) {
      console.log(`[BRIEFING PUSH] runUnifiedBriefing returned null for ${profileId} — nothing to send.`);
      return null;
    }
    console.log(`[BRIEFING PUSH] Briefing generated for ${profileId} — length=${briefing.length} chars`);

    const firstSentence = briefing.split(/(?<=[.!?])\s/)[0] || briefing;
    const body = firstSentence.length > 180
      ? `${firstSentence.slice(0, 177)}…`
      : firstSentence;

    await sendPush(tokens, {
      title: 'Good morning',
      body,
      data: { screen: 'today', kind: 'briefing' },
    });

    console.log(`[BRIEFING PUSH] sendPush completed for ${profileId} (${tokens.length} device(s) attempted).`);
    return briefing;
  } catch (err) {
    console.error(`[BRIEFING PUSH ERROR] profile=${profileId}:`, err);
    return null;
  }
}
