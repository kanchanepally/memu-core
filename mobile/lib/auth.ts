/**
 * Auth state management.
 * Stores server URL and API key in SecureStore (encrypted on device).
 * Falls back to AsyncStorage on web.
 */
import { Platform } from 'react-native';

// Dynamic import — SecureStore isn't available on web
let SecureStore: typeof import('expo-secure-store') | null = null;

async function getStore() {
  if (SecureStore) return SecureStore;
  if (Platform.OS !== 'web') {
    SecureStore = await import('expo-secure-store');
  }
  return SecureStore;
}

// Simple fallback for web (localStorage)
const webStore = {
  get: (key: string) => {
    if (typeof window !== 'undefined') return window.localStorage.getItem(key);
    return null;
  },
  set: (key: string, value: string) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  },
  del: (key: string) => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  },
};

const KEYS = {
  serverUrl: 'memu_server_url',
  apiKey: 'memu_api_key',
  profileId: 'memu_profile_id',
  displayName: 'memu_display_name',
} as const;

export interface AuthState {
  serverUrl: string | null;
  apiKey: string | null;
  profileId: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
}

export async function loadAuthState(): Promise<AuthState> {
  const store = await getStore();

  let serverUrl: string | null = null;
  let apiKey: string | null = null;
  let profileId: string | null = null;
  let displayName: string | null = null;

  if (store) {
    serverUrl = await store.getItemAsync(KEYS.serverUrl);
    apiKey = await store.getItemAsync(KEYS.apiKey);
    profileId = await store.getItemAsync(KEYS.profileId);
    displayName = await store.getItemAsync(KEYS.displayName);
  } else {
    serverUrl = webStore.get(KEYS.serverUrl);
    apiKey = webStore.get(KEYS.apiKey);
    profileId = webStore.get(KEYS.profileId);
    displayName = webStore.get(KEYS.displayName);
  }

  return {
    serverUrl,
    apiKey,
    profileId,
    displayName,
    isAuthenticated: !!(serverUrl && apiKey && profileId),
  };
}

export async function saveAuthState(data: {
  serverUrl: string;
  apiKey: string;
  profileId: string;
  displayName: string;
}): Promise<void> {
  const store = await getStore();

  if (store) {
    await store.setItemAsync(KEYS.serverUrl, data.serverUrl || '');
    await store.setItemAsync(KEYS.apiKey, data.apiKey || '');
    await store.setItemAsync(KEYS.profileId, data.profileId || '');
    await store.setItemAsync(KEYS.displayName, data.displayName || '');
  } else {
    webStore.set(KEYS.serverUrl, data.serverUrl || '');
    webStore.set(KEYS.apiKey, data.apiKey || '');
    webStore.set(KEYS.profileId, data.profileId || '');
    webStore.set(KEYS.displayName, data.displayName || '');
  }
}

export async function saveDisplayName(displayName: string): Promise<void> {
  const store = await getStore();
  if (store) {
    await store.setItemAsync(KEYS.displayName, displayName);
  } else {
    webStore.set(KEYS.displayName, displayName);
  }
}

export async function clearAuthState(): Promise<void> {
  const store = await getStore();

  if (store) {
    await store.deleteItemAsync(KEYS.serverUrl);
    await store.deleteItemAsync(KEYS.apiKey);
    await store.deleteItemAsync(KEYS.profileId);
    await store.deleteItemAsync(KEYS.displayName);
  } else {
    webStore.del(KEYS.serverUrl);
    webStore.del(KEYS.apiKey);
    webStore.del(KEYS.profileId);
    webStore.del(KEYS.displayName);
  }
}
