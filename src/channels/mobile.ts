import { pool } from '../db/connection';

// Expo's push API — HTTPS POST, no SDK needed.
// https://docs.expo.dev/push-notifications/sending-notifications/
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function registerPushToken(
  profileId: string,
  token: string,
  platform?: string,
): Promise<void> {
  if (!token || !token.startsWith('ExponentPushToken')) {
    throw new Error('Invalid Expo push token');
  }
  await pool.query(
    `INSERT INTO push_tokens (token, profile_id, platform, last_seen_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (token) DO UPDATE
       SET profile_id = EXCLUDED.profile_id,
           platform = EXCLUDED.platform,
           last_seen_at = NOW()`,
    [token, profileId, platform || null],
  );
}

export async function getTokensForProfile(profileId: string): Promise<string[]> {
  const res = await pool.query(
    'SELECT token FROM push_tokens WHERE profile_id = $1',
    [profileId],
  );
  return res.rows.map((r: any) => r.token);
}

export async function sendPush(tokens: string[], payload: PushPayload): Promise<void> {
  if (tokens.length === 0) {
    console.log('[PUSH] sendPush called with 0 tokens — skipping');
    return;
  }

  console.log(`[PUSH] Sending "${payload.title}" to ${tokens.length} token(s) — body length=${payload.body.length}`);

  const messages = tokens.map(to => ({
    to,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[PUSH] Expo rejected batch — HTTP ${res.status}:`, JSON.stringify(body));
      return;
    }
    const data = (body as any).data as Array<{ status: string; id?: string; message?: string; details?: { error?: string } }> | undefined;
    if (!Array.isArray(data)) {
      console.warn('[PUSH] Expo response had no data array:', JSON.stringify(body));
      return;
    }

    let okCount = 0;
    let errCount = 0;
    let removedDead = 0;
    for (let i = 0; i < data.length; i++) {
      const receipt = data[i];
      if (receipt.status === 'ok') {
        okCount++;
        continue;
      }
      errCount++;
      const errCode = receipt.details?.error || 'unknown';
      console.error(`[PUSH] Token #${i} rejected: ${errCode} — ${receipt.message || ''}`);
      if (errCode === 'DeviceNotRegistered') {
        await pool.query('DELETE FROM push_tokens WHERE token = $1', [tokens[i]]).catch(() => {});
        removedDead++;
      }
    }
    console.log(`[PUSH] Result: ${okCount} accepted, ${errCount} rejected${removedDead > 0 ? `, ${removedDead} dead tokens removed` : ''}`);
  } catch (err) {
    console.error('[PUSH] Failed to deliver (network/exception):', err);
  }
}
