/**
 * Expo push token registration.
 * Asks for notification permission, gets an Expo push token, and POSTs it
 * to /api/push/register so the backend can deliver morning briefings.
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

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) return null; // Simulator won't get a token

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
    if (status !== 'granted') return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;

    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResp.data;
    if (!token) return null;

    const auth = await loadAuthState();
    if (!auth.isAuthenticated || !auth.serverUrl || !auth.apiKey) return token;

    await fetch(`${auth.serverUrl}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.apiKey}`,
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ token, platform: Platform.OS }),
    }).catch(() => {
      // Non-critical — the cron will try again tomorrow if this fails.
    });

    return token;
  } catch (err) {
    console.warn('[PUSH] Registration failed', err);
    return null;
  }
}
