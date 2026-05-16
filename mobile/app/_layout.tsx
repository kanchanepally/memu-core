import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { useFonts } from 'expo-font';
import { SourceSans3_300Light, SourceSans3_400Regular, SourceSans3_500Medium, SourceSans3_600SemiBold, SourceSans3_700Bold, SourceSans3_800ExtraBold } from '@expo-google-fonts/source-sans-3';
import { Lora_400Regular, Lora_500Medium, Lora_600SemiBold, Lora_700Bold } from '@expo-google-fonts/lora';
import * as Notifications from 'expo-notifications';
import { colors } from '../lib/tokens';
import { ThemeProvider } from '../lib/theme';
import { useMemuFonts } from '../lib/fonts';
import { loadAuthState } from '../lib/auth';
import { registerForPushNotifications } from '../lib/push';
import ErrorBoundary from '../components/ErrorBoundary';
import { ToastProvider } from '../components/Toast';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}

function RootLayoutInner() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  // Load both the legacy Source Sans 3 / Lora set (still referenced by
  // pre-v3 components via `typography.families.*`) AND the v3 set
  // (Inter / Newsreader / JetBrains Mono) used by the new design system.
  const [legacyFontsLoaded] = useFonts({
    SourceSans3_300Light,
    SourceSans3_400Regular,
    SourceSans3_500Medium,
    SourceSans3_600SemiBold,
    SourceSans3_700Bold,
    SourceSans3_800ExtraBold,
    Lora_400Regular,
    Lora_500Medium,
    Lora_600SemiBold,
    Lora_700Bold,
  });
  const [v3FontsLoaded] = useMemuFonts();
  const fontsLoaded = legacyFontsLoaded && v3FontsLoaded;

  useEffect(() => {
    (async () => {
      const auth = await loadAuthState();
      setIsAuthenticated(auth.isAuthenticated);
      setIsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!isReady || !fontsLoaded) return;

    const inOnboarding = segments[0] === 'onboarding';

    if (!inOnboarding) {
      loadAuthState().then((auth) => {
        if (!auth.isAuthenticated) {
          router.replace('/onboarding/welcome');
        } else if (!isAuthenticated) {
          setIsAuthenticated(true);
        }
      });
    } else if (isAuthenticated && inOnboarding) {
      router.replace('/(tabs)/chat');
    }
  }, [isReady, isAuthenticated, segments, fontsLoaded]);

  // Register for push notifications once the user is signed in, and re-register
  // when the app returns to the foreground if it's been more than 24h since the
  // last attempt. Expo push tokens can rotate (OS-driven, especially Android),
  // so without periodic refresh the server holds a stale token and the morning
  // brief lands at the void. AppState-driven retry keeps it warm without a
  // background task.
  const lastPushRegistrationRef = useRef<number>(0);
  useEffect(() => {
    if (!isAuthenticated) return;

    const maybeRegister = () => {
      const now = Date.now();
      const ageMs = now - lastPushRegistrationRef.current;
      if (ageMs < 24 * 60 * 60 * 1000) return; // already registered within 24h
      lastPushRegistrationRef.current = now;
      registerForPushNotifications().catch(() => {});
    };

    // Fire immediately on auth.
    maybeRegister();

    // Re-check on foreground.
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') maybeRegister();
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  // Deep-link when a notification is tapped. Two paths:
  //   1. App is already running → addNotificationResponseReceivedListener fires.
  //   2. App was closed → user taps notification → OS launches app → we need
  //      to inspect getLastNotificationResponseAsync() once on mount and route
  //      from there. Without this, the cold-start case lands on whatever
  //      route the auth gate picks, ignoring the notification's screen hint
  //      entirely. This is the path that matters for the 07:00 morning
  //      briefing — the phone is asleep, the user taps, the app cold-starts.
  useEffect(() => {
    if (!isAuthenticated) return;

    const route = (data: { screen?: string; promptId?: string } | undefined) => {
      // Push notifications still carry `screen: 'today'` for back-compat
      // — the briefing now appears AS a chat message, so the right
      // landing target for the morning push is /chat (where the briefing
      // is the first thing the user sees in the latest thread).
      if (data?.screen === 'today' || data?.screen === 'chat') {
        router.push('/(tabs)/chat');
        return;
      }
      // Daytime capture nudge (Fix 5) — push carries `screen: 'capture'`
      // + optional `promptId`. Deep-link straight to the quick-capture
      // modal with the prompt pre-fetched.
      if (data?.screen === 'capture') {
        const url = data.promptId
          ? `/capture/quick?promptId=${encodeURIComponent(data.promptId)}`
          : '/capture/quick';
        router.push(url as any);
        return;
      }
    };

    Notifications.getLastNotificationResponseAsync().then(resp => {
      if (resp) {
        const data = resp.notification.request.content.data as { screen?: string } | undefined;
        route(data);
      }
    });

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { screen?: string } | undefined;
      route(data);
    });
    return () => sub.remove();
  }, [router, isAuthenticated]);

  if (!isReady || !fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.onSurface,
          headerTitleStyle: { fontFamily: 'SourceSans3_700Bold' },
          contentStyle: { backgroundColor: colors.surface },
        }}
      >
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="ledger"
          options={{
            title: 'What AI Saw',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="memory"
          options={{
            title: 'Family Memory',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="import"
          options={{
            title: 'Import Context',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="brief-settings"
          options={{
            title: 'Your morning brief',
            headerShown: false,
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="capture/quick"
          options={{
            title: 'Quick capture',
            headerShown: false,
            presentation: 'modal',
          }}
        />
      </Stack>
      </ToastProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
});
