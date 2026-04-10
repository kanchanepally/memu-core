import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../lib/tokens';
import { loadAuthState } from '../lib/auth';

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    (async () => {
      const auth = await loadAuthState();
      setIsAuthenticated(auth.isAuthenticated);
      setIsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const inOnboarding = segments[0] === 'onboarding';

    if (!isAuthenticated && !inOnboarding) {
      // Not logged in and not on onboarding — redirect
      router.replace('/onboarding/welcome');
    } else if (isAuthenticated && inOnboarding) {
      // Logged in but still on onboarding — go to main app
      router.replace('/(tabs)');
    }
  }, [isReady, isAuthenticated, segments]);

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="ledger"
          options={{
            title: 'What Claude Saw',
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
    </>
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
