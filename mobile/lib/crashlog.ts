/**
 * Local crash log — kept in SecureStore (never sent over the network).
 * Used to populate the "Email Hareesh" escape hatch when a crash happens.
 */
import { Platform } from 'react-native';

let SecureStore: typeof import('expo-secure-store') | null = null;

async function getStore() {
  if (SecureStore) return SecureStore;
  if (Platform.OS !== 'web') SecureStore = await import('expo-secure-store');
  return SecureStore;
}

const webStore = {
  get: (k: string) => (typeof window !== 'undefined' ? window.localStorage.getItem(k) : null),
  set: (k: string, v: string) => { if (typeof window !== 'undefined') window.localStorage.setItem(k, v); },
};

const KEY = 'memu_crash_log';
const MAX_ENTRIES = 3;

export interface CrashEntry {
  at: string;
  message: string;
  stack: string;
}

async function readRaw(): Promise<string | null> {
  const store = await getStore();
  if (store) return store.getItemAsync(KEY);
  return webStore.get(KEY);
}

async function writeRaw(value: string): Promise<void> {
  const store = await getStore();
  if (store) await store.setItemAsync(KEY, value);
  else webStore.set(KEY, value);
}

export async function recordCrash(err: unknown): Promise<void> {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const entry: CrashEntry = {
      at: new Date().toISOString(),
      message: e.message,
      stack: (e.stack || '').slice(0, 800),
    };
    const existing = await readRaw();
    const list: CrashEntry[] = existing ? JSON.parse(existing) : [];
    list.unshift(entry);
    await writeRaw(JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // Swallow — don't let logging crash the crash handler.
  }
}

export async function readCrashes(): Promise<CrashEntry[]> {
  try {
    const raw = await readRaw();
    if (!raw) return [];
    return JSON.parse(raw) as CrashEntry[];
  } catch {
    return [];
  }
}
