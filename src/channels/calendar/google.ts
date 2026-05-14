import { google, calendar_v3 } from 'googleapis';
import { db, enterCollectiveContext } from '../../db/tenant';
import { startOfDay, endOfDay } from 'date-fns';

const OAUTH2_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const OAUTH2_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const OAUTH2_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3100/api/auth/google/callback';

export function getGoogleOAuthClient() {
  return new google.auth.OAuth2(
    OAUTH2_CLIENT_ID,
    OAUTH2_CLIENT_SECRET,
    OAUTH2_REDIRECT_URI
  );
}

export function getGoogleAuthUrl(profileId: string, source: string = 'pwa') {
  const oauth2Client = getGoogleOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    // Pack profileId and source into state so callback can route correctly
    state: `${profileId}:${source}`
  });
}

export async function handleGoogleCallback(code: string, profileId: string): Promise<string> {
  const oauth2Client = getGoogleOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  
  if (!tokens || !tokens.refresh_token) {
    console.warn('No refresh token provided. The user may have already authorized the app. Make sure to revoke access in Google Account to test refresh_token flow.');
  }

  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Get user's email to use as channel_identifier
  const res = await calendar.calendars.get({ calendarId: 'primary' });
  const email = res.data.id || 'unknown@calendar.google.com';

  // The Google OAuth callback is registered as unauthenticated (the caller
  // is Google's redirect, the user is identified by the state parameter
  // that round-trips profileId). That means requireCollective never ran, so
  // there's no AsyncLocalStorage tenant context — and profile_channels has
  // `collective_id NOT NULL DEFAULT current_setting('memu.collective_id')`,
  // which resolves to NULL without context.
  //
  // Two-step fix: look up the profile's collective_id with the unscoped
  // helper (profiles is Tier-C, no RLS on collective_id), then enter that
  // context so the INSERT's default fires correctly. Surfaced 2026-05-12
  // evening when Hareesh tried to reconnect after the OAuth token expired.
  const profRes = await db.queryWithoutTenant<{ collective_id: string }>(
    'SELECT collective_id FROM profiles WHERE id = $1',
    [profileId],
  );
  const collectiveId = profRes.rows[0]?.collective_id;
  if (!collectiveId) {
    throw new Error(`Profile ${profileId} has no collective_id — cannot link Google Calendar`);
  }

  await enterCollectiveContext(collectiveId, async () => {
    // Store credentials securely in profile_channels (upsert on profile/channel).
    await db.query(
      `INSERT INTO profile_channels (profile_id, channel, channel_identifier, credentials)
       VALUES ($1, 'google_calendar', $2, $3)
       ON CONFLICT (profile_id, channel)
       DO UPDATE SET credentials = EXCLUDED.credentials, channel_identifier = EXCLUDED.channel_identifier`,
      [profileId, email, JSON.stringify(tokens)]
    );
  });

  return email;
}

import { addDays } from 'date-fns';

/**
 * Disconnect reason for callers that want to distinguish "no calendar
 * connected" from "calendar connected but the OAuth refresh token is
 * dead". Used by the readUpcomingEvents tool so Claude can say
 * "the calendar's disconnected — reconnect in Settings" instead of
 * silently behaving as if you have no events.
 */
export type CalendarFetchOutcome =
  | { kind: 'ok'; events: calendar_v3.Schema$Event[] }
  | { kind: 'not_connected' }
  | { kind: 'auth_expired' }
  | { kind: 'fetch_failed'; message: string };

/**
 * BUG-17 belt-and-braces. The original implementation had a try/catch
 * around just the Google API call, so the DB query above could throw
 * and bubble out — which was the actual failure mode on 2026-05-12
 * (ALS context bug → calendar fetch threw → chat turn died). The whole
 * function is now try-safe; every failure path returns either an empty
 * array (from the back-compat wrapper below) or a structured outcome
 * (from the new fetchUpcomingEventsDetailed).
 *
 * Auth-expired detection: googleapis surfaces refresh-token failures
 * as either GaxiosError with response.data.error === 'invalid_grant'
 * or as a thrown Error whose message contains 'invalid_grant'. We
 * pattern-match both shapes — if it's invalid_grant, the user's OAuth
 * is dead and they need to reconnect; if it's anything else, treat as
 * a transient fetch failure and let retry handle it.
 */
export async function fetchUpcomingEventsDetailed(profileId: string): Promise<CalendarFetchOutcome> {
  try {
    const res = await db.query(
      `SELECT credentials FROM profile_channels WHERE profile_id = $1 AND channel = 'google_calendar'`,
      [profileId],
    );
    if (res.rows.length === 0) return { kind: 'not_connected' };

    const tokens = res.rows[0].credentials;
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const todayStart = startOfDay(new Date());
    const nextWeekEnd = endOfDay(addDays(new Date(), 7));

    const eventsRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin: todayStart.toISOString(),
      timeMax: nextWeekEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return { kind: 'ok', events: eventsRes.data.items || [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorData = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
    if (errorData === 'invalid_grant' || /invalid_grant/i.test(message)) {
      console.warn(`[CALENDAR] OAuth refresh failed for profile ${profileId} (invalid_grant) — user needs to reconnect.`);
      return { kind: 'auth_expired' };
    }
    console.error(`[CALENDAR] fetchUpcomingEvents failed for profile ${profileId}:`, message);
    return { kind: 'fetch_failed', message };
  }
}

/**
 * Back-compat wrapper for callers that only care about the events array
 * (briefing.ts) and treat any failure as "no events to surface". The
 * underlying detailed result is logged so a sweep through `docker logs`
 * still shows whether the silent empty was a real "no events scheduled"
 * or a failure mode the user could fix.
 */
export async function fetchUpcomingEvents(profileId: string): Promise<calendar_v3.Schema$Event[]> {
  const result = await fetchUpcomingEventsDetailed(profileId);
  if (result.kind === 'ok') return result.events;
  return [];
}

export interface InsertEventInput {
  summary: string;
  startISO: string;
  endISO: string;
  location?: string;
  description?: string;
}

export type InsertEventResult =
  | { ok: true; eventId: string; htmlLink: string | null }
  | { ok: false; reason: 'not_connected' | 'insufficient_scope' | 'invalid_time' | 'api_error'; message: string };

export async function insertCalendarEvent(profileId: string, input: InsertEventInput): Promise<InsertEventResult> {
  const res = await db.query(
    `SELECT credentials FROM profile_channels WHERE profile_id = $1 AND channel = 'google_calendar'`,
    [profileId],
  );
  if (res.rows.length === 0) {
    return { ok: false, reason: 'not_connected', message: 'Google Calendar is not connected for this profile.' };
  }

  const start = new Date(input.startISO);
  const end = new Date(input.endISO);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return { ok: false, reason: 'invalid_time', message: 'startISO/endISO must be valid ISO 8601 with end after start.' };
  }

  const tokens = res.rows[0].credentials;
  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials(tokens);

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  try {
    const created = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: input.summary,
        location: input.location,
        description: input.description,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      },
    });
    return {
      ok: true,
      eventId: created.data.id || '',
      htmlLink: created.data.htmlLink || null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/insufficient|scope|permission/i.test(message)) {
      return {
        ok: false,
        reason: 'insufficient_scope',
        message: 'Calendar write scope not granted. Reconnect Google Calendar in Settings.',
      };
    }
    return { ok: false, reason: 'api_error', message };
  }
}

export async function createGoogleCalendarEvent(profileId: string, summary: string, dateStr: string): Promise<boolean> {
  const res = await db.query(`SELECT credentials FROM profile_channels WHERE profile_id = $1 AND channel = 'google_calendar'`, [profileId]);
  if (res.rows.length === 0) return false;
  
  const tokens = res.rows[0].credentials;
  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials(tokens);
  
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  
  try {
    // Basic heuristics: if date is parseable, use it. Otherwise, assume tomorrow.
    // In production, we'd pass rich ISO start/end times from the LLM.
    const start = new Date(dateStr) instanceof Date && !isNaN(new Date(dateStr).getTime()) 
          ? new Date(dateStr) 
          : new Date(Date.now() + 86400000); // T+24hr
          
    const end = new Date(start.getTime() + 3600000); // 1 hour later

    await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: summary,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() }
      }
    });
    return true;
  } catch (err) {
    console.error('Error creating Google Calendar event:', err);
    return false;
  }
}
