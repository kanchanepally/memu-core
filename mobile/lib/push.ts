/**
 * Expo push token registration.
 * Asks for notification permission, gets an Expo push token, and POSTs it
 * to /api/push/register so the backend can deliver morning briefings.
 *
 * Returns a structured result so callers can surface the specific failure
 * reason — until 2026-04-29 this path swallowed every error in
 * `.catch(() => {})`, the result was zero rows in `push_tokens` for every
 * user (including the developer's primary device), and morning briefings
 * have never delivered as a push notification to anyone.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { loadAuthState } from './auth';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushRegistrationFailureReason =
  | 'web'                   // running in browser / PWA — push not supported
  | 'simulator'             // Expo Go in simulator returns no token
  | 'permission_denied'     // user denied notification permission
  | 'project_id_missing'    // EAS project id not configured (build issue)
  | 'token_unavailable'     // Expo returned no token (transient or config issue)
  | 'not_authenticated'     // no server URL / API key on device
  | 'server_register_failed' // backend rejected the token registration
  | 'exception';            // anything thrown

export type PushRegistrationResult =
  | { ok: true; token: string }
  | { ok: false; reason: PushRegistrationFailureReason; detail?: string };

export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  if (Platform.OS === 'web') return { ok: false, reason: 'web' };
  if (!Device.isDevice) return { ok: false, reason: 'simulator' };

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Memu',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#5054B5',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const next = await Notifications.requestPermissionsAsync();
      status = next.status;
    }
    if (status !== 'granted') {
      console.warn('[PUSH] Permission denied');
      return { ok: false, reason: 'permission_denied' };
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;

    let tokenResp: Notifications.ExpoPushToken;
    try {
      tokenResp = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[PUSH] getExpoPushTokenAsync threw', message);
      // Most common cause in production: EAS project id not configured.
      if (!projectId) return { ok: false, reason: 'project_id_missing', detail: message };
      return { ok: false, reason: 'token_unavailable', detail: message };
    }

    const token = tokenResp.data;
    if (!token) return { ok: false, reason: 'token_unavailable' };

    const auth = await loadAuthState();
    if (!auth.isAuthenticated || !auth.serverUrl || !auth.apiKey) {
      // We have a token but cannot register it without backend creds.
      // Caller may retry once the user signs in.
      return { ok: false, reason: 'not_authenticated', detail: token };
    }

    const res = await fetch(`${auth.serverUrl}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.apiKey}`,
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body as any)?.error || `HTTP ${res.status}`;
      console.warn('[PUSH] Backend register rejected:', detail);
      return { ok: false, reason: 'server_register_failed', detail };
    }

    console.log(`[PUSH] Registered ExponentPushToken […${token.slice(-8)}] with backend`);
    return { ok: true, token };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.warn('[PUSH] Registration threw', message);
    return { ok: false, reason: 'exception', detail: message };
  }
}
