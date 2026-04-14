import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit';
import { colors } from '../lib/tokens';
import { loadAuthState } from '../lib/auth';

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  // Load custom premium fonts
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
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

  if (!isReady || !fontsLoaded) {
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
          headerTitleStyle: { fontWeight: '600', fontFamily: 'Outfit_600SemiBold' },
          contentStyle: { backgroundColor: colors.bg },
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
