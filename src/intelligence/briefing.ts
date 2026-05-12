import { db } from '../db/tenant';
import { fetchUpcomingEvents } from '../channels/calendar/google';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { dispatch } from '../skills/router';
import { getTokensForProfile, sendPush } from '../channels/mobile';
import { listDomainStates, renderDomainHealthHeader } from '../domains/health';

import { processSynthesisUpdate } from './synthesis';
import { interactiveQueryTools } from './tools';
import { fetchWeatherLine, fetchNewsBrief } from './ambient';
import { getBriefPreferences } from '../preferences/brief';

const MAX_BRIEFING_PARAGRAPHS = 4;
const COLLISION_WINDOW_MS = 48 * 60 * 60 * 1000;

interface CacheEntry {
  briefing: string;
  expiresAt: number;
}
const synthesisCache = new Map<string, CacheEntry>();

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
  /** 1-indexed indexes into the active_cards numbered list — which cards
   *  the briefing actually mentioned. Used to rotate which cards surface
   *  across consecutive briefings. Optional for backward-compat with v3
   *  skill output. */
  mentioned_card_indexes?: number[];
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
  const todayDate = new Date().toISOString().split('T')[0];
  const cacheKey = `${profileId}:${todayDate}`;

  if (channel === 'app') {
    const cached = synthesisCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      console.log(`[BRIEFING] Returning 15-minute cached synthesis for ${profileId}`);
      return cached.briefing;
    }
  }

  try {
    // 1. Inbox queue (WhatsApp accumulator). Empty is the morning-briefing case.
    const inboxRes = await db.query(
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
    //
    // Events are split into today_events (events whose start date is in the
    // current local day) and upcoming_events (everything else within the 48h
    // collision window). Without this split the LLM sees a list like
    // "Fri 1 May 11:00 Zoom" with no anchor for what today is, and routinely
    // picks the only-event-on-the-list as "today" — the 2026-04-29 incident
    // where Wednesday's brief reported "a genuinely calm Friday" because
    // the only Calendar event in the window was Friday's Zoom.
    const upcoming = await fetchUpcomingEvents(profileId);
    const normalised = normaliseEvents(upcoming);
    const horizon = new Date(Date.now() + COLLISION_WINDOW_MS);
    const inWindow = normalised.filter(e => !e.startDate || e.startDate <= horizon);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const todayLabel = todayStart.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    const todayEvents = inWindow.filter(e =>
      e.startDate && e.startDate >= todayStart && e.startDate < tomorrowStart,
    );
    const upcomingEvents = inWindow.filter(e =>
      !e.startDate || e.startDate >= tomorrowStart,
    );

    const todayEventsStr = todayEvents.length === 0
      ? 'No events scheduled for today.'
      : todayEvents.map(formatEventLine).join('\n');
    const upcomingEventsStr = upcomingEvents.length === 0
      ? 'Nothing else in the next 48 hours.'
      : upcomingEvents.map(formatEventLine).join('\n');

    const collisionsStr = detectCollisions(inWindow);

    // 3. Active stream cards (open commitments). Ordered by least-mentioned
    // first so the same item doesn't surface in three consecutive briefings;
    // the AWBS-basket-three-days-running bug from 2026-04-29.
    //
    // Cap at 12 items in the prompt — beyond that the LLM can't keep them
    // straight and the daily expiry pass handles the long tail anyway.
    const streamRes = await db.query<{
      id: string;
      title: string;
      body: string;
      card_type: string;
    }>(
      `SELECT id, title, body, card_type
         FROM stream_cards
        WHERE family_id = $1 AND status = 'active'
        ORDER BY mentioned_count ASC, last_mentioned_at ASC NULLS FIRST, created_at ASC
        LIMIT 12`,
      [profileId],
    );
    // Numbered list — the skill emits 1-indexed indexes in
    // mentioned_card_indexes so we can map back to ids and bump counters
    // without parsing markdown for matched titles.
    const streamStr = streamRes.rows.length === 0
      ? 'No pending items.'
      : streamRes.rows
          .map((c, i) => `${i + 1}. [${c.card_type.toUpperCase()}] ${c.title}: ${c.body}`)
          .join('\n');

    // 3b. Ambient context — weather + top headlines for the day. Both are
    // fetched from keyless public APIs (Open-Meteo, BBC RSS) and cached
    // per local-day in `ambient.ts`. Either failing returns a graceful
    // "unavailable" string the skill knows to skip; never blocks the
    // briefing on flaky outbound HTTP. Both pass through the Twin
    // anonymiser below — they contain no real personal names but the
    // pipeline invariant is "every template var is anonymised", so we
    // run them through anyway and rely on novel-entity detection to no-op
    // on already-anonymous content.
    // Per-profile preferences: location for weather, source IDs for news.
    // Falls back to env defaults / BBC if the user has never customised.
    const prefs = await getBriefPreferences(profileId);
    const [weatherLine, newsBrief] = await Promise.all([
      fetchWeatherLine(prefs.location ?? {}),
      fetchNewsBrief({
        sourceIds: prefs.newsSources,
        placeName: prefs.location?.placeName,
      }),
    ]);

    // 4. Domain health header — at-a-glance sphere status.
    const domainStates = await listDomainStates(profileId);
    const domainHeaderRaw = domainStates.length === 0
      ? "Today's domains:\n(no standards seeded yet)"
      : renderDomainHealthHeader(domainStates);

    // 5. Twin invariant: every field that reaches the LLM is anonymised.
    // The Twin guard would refuse the call in throw mode anyway; doing it
    // here keeps the privacy ledger free of "auto-anonymised" noise.
    const [anonInbox, anonTodayEvents, anonUpcomingEvents, anonCollisions, anonCards, anonHeader, anonWeather, anonNews] = await Promise.all([
      translateToAnonymous(inboxTranscript),
      translateToAnonymous(todayEventsStr),
      translateToAnonymous(upcomingEventsStr),
      translateToAnonymous(collisionsStr),
      translateToAnonymous(streamStr),
      translateToAnonymous(domainHeaderRaw),
      translateToAnonymous(weatherLine),
      translateToAnonymous(newsBrief),
    ]);

    // Empty-state gate. Memu's worst current pattern is generating confident
    // platitudes from nothing — Sonnet asked "what's happening today?" against
    // a fully empty context block returns "you have a quiet day, enjoy", which
    // sounds like wisdom but is fabrication. Better to admit the gap than
    // perform knowledge.
    //
    // Skip dispatch entirely when there is no inbox, no events, no active
    // stream cards, and no amber/red domain signals. The cron path returns
    // null (callers like pushMorningBriefingToMobile already handle null by
    // not sending). The /api/dashboard/synthesis path also returns null;
    // the mobile Today screen renders an honest empty-state fallback instead
    // of a generated platitude.
    //
    // The 'whatsapp' channel keeps its old behaviour because that path is
    // user-initiated (`/briefing` slash command); the user explicitly asked
    // for a briefing and we respect that.
    const hasInbox = messageIds.length > 0;
    const hasEvents = inWindow.length > 0;
    const hasCards = streamRes.rows.length > 0;
    const hasDomainSignal = domainStates.some(d => d.health === 'amber' || d.health === 'red');
    const isFullyEmpty = !hasInbox && !hasEvents && !hasCards && !hasDomainSignal;
    if (isFullyEmpty && channel !== 'whatsapp') {
      console.log(
        `[BRIEFING] Empty-state — skipping LLM dispatch for ${profileId} (no inbox, calendar, cards, or domain signals).`,
      );
      return null;
    }

    console.log(
      `[BRIEFING] Composing for ${profileId} — inbox=${messageIds.length} events=${inWindow.length} cards=${streamRes.rows.length} channel=${channel}`,
    );

    const { text: llmRaw } = await dispatch({
      skill: 'briefing',
      templateVars: {
        today_label: todayLabel,
        domain_header: anonHeader,
        today_events: anonTodayEvents,
        upcoming_events: anonUpcomingEvents,
        active_cards: anonCards,
        inbox_transcript: anonInbox,
        collisions: anonCollisions,
        weather_line: anonWeather,
        news_brief: anonNews,
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
      await db.query(
        `UPDATE inbox_messages SET processed = true WHERE id = ANY($1)`,
        [messageIds],
      );
    }

    // 7b. Bump mention counters for any stream cards the skill referenced.
    // Maps 1-indexed indexes back to the row id; ignores out-of-range
    // entries so a hallucinated index doesn't poison the table.
    if (Array.isArray(parsed.mentioned_card_indexes) && streamRes.rows.length > 0) {
      const mentionedIds: string[] = [];
      for (const raw of parsed.mentioned_card_indexes) {
        const idx = typeof raw === 'number' ? raw - 1 : -1;
        if (idx >= 0 && idx < streamRes.rows.length) {
          mentionedIds.push(streamRes.rows[idx].id);
        }
      }
      if (mentionedIds.length > 0) {
        await db.query(
          `UPDATE stream_cards
              SET mentioned_count = mentioned_count + 1,
                  last_mentioned_at = NOW()
            WHERE id = ANY($1)`,
          [mentionedIds],
        );
      }
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
      // Cache for both channels so a 07:00 push-gen + 07:05 app-open hit the
      // same Sonnet call. Pre-2026-05-06 only the 'app' channel cached, which
      // meant tapping the morning notification fired a fresh Sonnet within
      // minutes of the cron's generation — same content, different invoice.
      synthesisCache.set(cacheKey, { briefing: realBriefing, expiresAt: Date.now() + 15 * 60 * 1000 });
      return realBriefing;
    }

    // Reify the suggested_actions back to real names before persisting. The
    // skill emits them in the anonymous namespace (Twin invariant). Mobile
    // renders them verbatim to the user.
    const realActions = parsed.suggested_actions
      ? await deepTranslateToReal(parsed.suggested_actions)
      : [];

    // Idempotency: one briefing card per (family_id, UTC date). A second
    // insert in the same day (cron + manual run-now collision, or two cron
    // ticks after a server restart) produced the duplicate cards visible
    // in the 2026-05-12 screenshot. Application-level check first, with
    // migration 030's partial unique index `uniq_briefing_card_per_family_per_day`
    // as the DB-level safety net.
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM stream_cards
        WHERE family_id = $1
          AND card_type = 'briefing'
          AND (created_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
        LIMIT 1`,
      [profileId],
    );

    if (existing.rows.length > 0) {
      console.log(`[BRIEFING] Briefing card already exists for ${profileId} today; idempotent skip.`);
    } else {
      await db.query(
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
    }
    // See comment above — cache regardless of channel so push and app share.
    synthesisCache.set(cacheKey, { briefing: realBriefing, expiresAt: Date.now() + 15 * 60 * 1000 });
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

/**
 * Generate the briefing TEXT for app-channel delivery. Does NOT push anywhere
 * — the caller decides what to do with the returned markdown (return as JSON
 * to /api/briefing/run-now, persist as a stream card via runUnifiedBriefing's
 * own logic, or display directly).
 *
 * Renamed from `generateAndPushMorningBriefing` 2026-04-29 — the old name
 * implied delivery that the function never performed.
 */
export async function generateBriefingText(profileId: string): Promise<string | null> {
  console.log(`[BRIEFING ENGINE] Triggered for ${profileId}`);
  return await runUnifiedBriefing(profileId, 'app');
}

/** @deprecated Use generateBriefingText. Kept as a transitional alias. */
export const generateAndPushMorningBriefing = generateBriefingText;

// Mobile push delivery: same briefing, channel='push' so the skill knows it
// is going to a notification body (light markdown allowed).
//
// Decoupled from token availability 2026-05-06. Pre-fix: this returned null
// before generating anything when push_tokens was empty, so a user whose
// registration silently failed got NO briefing — not even one waiting on
// the Today screen when they opened the app. Post-fix: briefing generation
// + persistence (as a stream_cards row via runUnifiedBriefing) ALWAYS runs;
// the push send is the only step gated on tokens.
export async function pushMorningBriefingToMobile(profileId: string): Promise<string | null> {
  console.log(`[BRIEFING PUSH] Starting for profile ${profileId}`);
  try {
    const briefing = await runUnifiedBriefing(profileId, 'push');
    if (!briefing) {
      console.log(`[BRIEFING PUSH] runUnifiedBriefing returned null for ${profileId} — empty-state gate fired or nothing substantive to brief on.`);
      return null;
    }
    console.log(`[BRIEFING PUSH] Briefing generated for ${profileId} — length=${briefing.length} chars.`);

    // Post the briefing as the first chat message of a fresh conversation
    // so it lands on the user's chat timeline alongside everything else.
    // The chat-as-home model treats the morning briefing as just another
    // assistant turn — tagged metadata.type='briefing' so the renderers
    // apply elevated AIInsightCard styling inline. A new conversation
    // each morning means tapping the push notification lands the user on
    // a clean thread; replies create a follow-up turn naturally.
    try {
      await postBriefingAsChatMessage(profileId, briefing);
    } catch (err) {
      // Non-fatal — push still goes out, stream_cards row still persists
      // (handled inside runUnifiedBriefing). The chat-message post is the
      // newest of the three persistence paths; if it fails the user still
      // gets the briefing through Today / push.
      console.error(`[BRIEFING CHAT-MESSAGE] Failed to post for ${profileId}:`, err);
    }

    const tokens = await getTokensForProfile(profileId);
    if (tokens.length === 0) {
      console.log(`[BRIEFING PUSH] No push tokens for ${profileId} — briefing still saved for in-app display, push skipped. (User hasn't opened the app, or notification permission was denied.)`);
      return briefing;
    }

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

/**
 * Insert the morning briefing as a server-generated assistant chat
 * message into a fresh conversation for today. Idempotent within a UTC
 * day — a second call within the same day finds the existing briefing
 * conversation and skips re-inserting.
 *
 * The chat-history endpoint surfaces this as the first message of the
 * day's thread; mobile + PWA renderers apply elevated styling when they
 * see metadata.type === 'briefing'.
 */
async function postBriefingAsChatMessage(profileId: string, briefingMarkdown: string): Promise<void> {
  // Idempotency: if a briefing message already exists for this profile
  // today, do not insert a second one. A failed push retry that calls
  // pushMorningBriefingToMobile twice in the same morning should not
  // produce duplicate chat entries.
  const existing = await db.query(
    `SELECT m.id FROM messages m
     WHERE m.profile_id = $1
       AND m.metadata->>'type' = 'briefing'
       AND m.created_at >= date_trunc('day', NOW())
     LIMIT 1`,
    [profileId],
  );
  if (existing.rows.length > 0) {
    console.log(`[BRIEFING CHAT-MESSAGE] Already posted today for ${profileId}; skipping.`);
    return;
  }

  // Fresh conversation each morning. Tapping the push lands the user on
  // a clean thread with the briefing visible; follow-up replies build the
  // day's conversation forward from there.
  const conv = await db.query<{ id: string }>(
    `INSERT INTO conversations (profile_id) VALUES ($1) RETURNING id`,
    [profileId],
  );
  const convId = conv.rows[0].id;

  await db.query(
    `INSERT INTO messages
       (id, conversation_id, profile_id, role,
        content_response_translated, channel, metadata)
     VALUES ($1, $2, $3, 'assistant', $4, 'briefing', $5)`,
    [
      `briefing-msg-${Date.now()}`,
      convId,
      profileId,
      briefingMarkdown,
      JSON.stringify({ type: 'briefing' }),
    ],
  );

  await db.query(
    `UPDATE conversations SET message_count = 1 WHERE id = $1`,
    [convId],
  );

  console.log(`[BRIEFING CHAT-MESSAGE] Posted briefing into conversation ${convId} for ${profileId}.`);
}
