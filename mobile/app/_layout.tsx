import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useFonts } from 'expo-font';
import { Manrope_300Light, Manrope_500Medium, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as Notifications from 'expo-notifications';
import { colors } from '../lib/tokens';
import { loadAuthState } from '../lib/auth';
import { registerForPushNotifications } from '../lib/push';
import ErrorBoundary from '../components/ErrorBoundary';
import { ToastProvider } from '../components/Toast';

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  // Load custom premium fonts
  const [fontsLoaded] = useFonts({
    Manrope_300Light,
    Manrope_500Medium,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

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
      router.replace('/(tabs)');
    }
  }, [isReady, isAuthenticated, segments, fontsLoaded]);

  // Register for push notifications once the user is signed in.
  useEffect(() => {
    if (!isAuthenticated) return;
    registerForPushNotifications().catch(() => {});
  }, [isAuthenticated]);

  // Deep-link when a notification is tapped.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { screen?: string } | undefined;
      if (data?.screen === 'today') router.push('/(tabs)');
    });
    return () => sub.remove();
  }, [router]);

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
          headerTitleStyle: { fontFamily: 'Manrope_800ExtraBold' },
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
