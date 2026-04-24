import { View, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { DrawerProvider } from '../../lib/drawer';
import SideDrawer from '../../components/SideDrawer';
import { colors, shadows, radius } from '../../lib/tokens';

/**
 * The bottom tab bar is hidden — navigation lives in the side drawer
 * (open by tapping the logo in the top-left of any screen). Tabs.Screen
 * entries remain so Expo Router still resolves the routes; we just don't
 * render the tab bar UI.
 */
export default function TabLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <DrawerProvider>
      <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Today',
            tabBarIcon: ({ color }) => <Ionicons name="sunny-outline" size={20} color={color} />,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: 'Chat',
            tabBarIcon: ({ color }) => <Ionicons name="chatbubble-outline" size={20} color={color} />,
          }}
        />
        <Tabs.Screen
          name="spaces"
          options={{
            title: 'Spaces',
            tabBarIcon: ({ color }) => <Ionicons name="albums-outline" size={20} color={color} />,
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: 'Calendar',
            tabBarIcon: ({ color }) => <Ionicons name="calendar-outline" size={20} color={color} />,
          }}
        />
        <Tabs.Screen
          name="lists"
          options={{
            title: 'Lists',
            tabBarIcon: ({ color }) => <Ionicons name="list-outline" size={20} color={color} />,
          }}
        />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
      <SideDrawer />
      
      {/* Global Quick Chat FAB */}
      <Pressable 
        style={[styles.fab, { bottom: Math.max(insets.bottom + 20, 30) }]}
        onPress={() => router.push('/chat')}
      >
        <Ionicons name="chatbubbles" size={24} color={colors.onPrimary} />
      </Pressable>
      </View>
    </DrawerProvider>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.medium,
    elevation: 5,
  }
});
