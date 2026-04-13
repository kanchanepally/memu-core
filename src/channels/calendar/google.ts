import { google, calendar_v3 } from 'googleapis';
import { pool } from '../../db/connection';
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

export function getGoogleAuthUrl(profileId: string) {
  const oauth2Client = getGoogleOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state: profileId // Associate the auth callback with the requesting profile
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

  // Store credentials securely in profile_channels (upsert on profile/channel)
  await pool.query(
    `INSERT INTO profile_channels (profile_id, channel, channel_identifier, credentials)
     VALUES ($1, 'google_calendar', $2, $3)
     ON CONFLICT (profile_id, channel) 
     DO UPDATE SET credentials = EXCLUDED.credentials, channel_identifier = EXCLUDED.channel_identifier`,
    [profileId, email, JSON.stringify(tokens)]
  );

  return email;
}

import { addDays } from 'date-fns';

export async function fetchUpcomingEvents(profileId: string): Promise<calendar_v3.Schema$Event[]> {
  // 1. Get token from DB
  const res = await pool.query(`SELECT credentials FROM profile_channels WHERE profile_id = $1 AND channel = 'google_calendar'`, [profileId]);
  
  // If calendar isn't connected, return empty array seamlessly
  if (res.rows.length === 0) return [];
  
  const tokens = res.rows[0].credentials;
  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials(tokens);
  
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  
  const todayStart = startOfDay(new Date());
  const nextWeekEnd = endOfDay(addDays(new Date(), 7));

  try {
    const eventsRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin: todayStart.toISOString(),
      timeMax: nextWeekEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return eventsRes.data.items || [];
  } catch (err) {
    console.error('Error fetching Google Calendar events:', err);
    return [];
  }
}

export async function createGoogleCalendarEvent(profileId: string, summary: string, dateStr: string): Promise<boolean> {
  const res = await pool.query(`SELECT credentials FROM profile_channels WHERE profile_id = $1 AND channel = 'google_calendar'`, [profileId]);
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
