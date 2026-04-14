/**
 * Local preferences — AI mode, briefing time, briefing enabled.
 * Stored alongside auth state (SecureStore on native, localStorage on web).
 */
import { Platform } from 'react-native';

let SecureStore: typeof import('expo-secure-store') | null = null;

async function getStore() {
  if (SecureStore) return SecureStore;
  if (Platform.OS !== 'web') {
    SecureStore = await import('expo-secure-store');
  }
  return SecureStore;
}

const webStore = {
  get: (k: string) => (typeof window !== 'undefined' ? window.localStorage.getItem(k) : null),
  set: (k: string, v: string) => { if (typeof window !== 'undefined') window.localStorage.setItem(k, v); },
  del: (k: string) => { if (typeof window !== 'undefined') window.localStorage.removeItem(k); },
};

async function getItem(key: string): Promise<string | null> {
  const store = await getStore();
  if (store) return store.getItemAsync(key);
  return webStore.get(key);
}

async function setItem(key: string, value: string): Promise<void> {
  const store = await getStore();
  if (store) await store.setItemAsync(key, value);
  else webStore.set(key, value);
}

export type AIMode = 'active' | 'quiet' | 'off';

export interface Prefs {
  aiMode: AIMode;
  briefingEnabled: boolean;
  briefingTime: string; // HH:MM
}

const KEYS = {
  aiMode: 'memu_pref_ai_mode',
  briefingEnabled: 'memu_pref_briefing_enabled',
  briefingTime: 'memu_pref_briefing_time',
} as const;

const DEFAULTS: Prefs = {
  aiMode: 'active',
  briefingEnabled: true,
  briefingTime: '07:00',
};

export async function loadPrefs(): Promise<Prefs> {
  const [mode, enabled, time] = await Promise.all([
    getItem(KEYS.aiMode),
    getItem(KEYS.briefingEnabled),
    getItem(KEYS.briefingTime),
  ]);
  return {
    aiMode: (mode === 'quiet' || mode === 'off' || mode === 'active') ? mode : DEFAULTS.aiMode,
    briefingEnabled: enabled === null ? DEFAULTS.briefingEnabled : enabled === 'true',
    briefingTime: time || DEFAULTS.briefingTime,
  };
}

export async function setAIMode(mode: AIMode): Promise<void> {
  await setItem(KEYS.aiMode, mode);
}

export async function setBriefingEnabled(v: boolean): Promise<void> {
  await setItem(KEYS.briefingEnabled, v ? 'true' : 'false');
}

export async function setBriefingTime(hhmm: string): Promise<void> {
  await setItem(KEYS.briefingTime, hhmm);
}
