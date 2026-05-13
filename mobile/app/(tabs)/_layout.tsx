import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { DrawerProvider } from '../../lib/drawer';
import SideDrawer from '../../components/SideDrawer';

/**
 * The bottom tab bar is hidden — navigation lives in the side drawer
 * (open by tapping the hamburger in the top-left). Tabs.Screen entries
 * remain so Expo Router still resolves the routes; the tab-bar UI is
 * suppressed.
 *
 * The chat-as-home redesign (2026-05-06) made:
 *  - `index.tsx` a redirect to `/chat` (so /(tabs) resolves to chat)
 *  - `today.tsx` the actual Today screen, reachable via the drawer
 *  - The floating chat FAB removed — chat is now the landing, no need
 *    to advertise an alternative entry point.
 */
export default function TabLayout() {
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
              title: 'Memu',
              tabBarIcon: ({ color }) => <Ionicons name="chatbubble-outline" size={20} color={color} />,
            }}
          />
          <Tabs.Screen
            name="chat"
            options={{
              title: 'Chat',
              tabBarIcon: ({ color }) => <Ionicons name="chatbubble-outline" size={20} color={color} />,
            }}
          />
          {/* Phase A.4 — renamed "Today" → "Dashboard". The route filename
              `today.tsx` stays for now to avoid a churn-y rename across
              router params, deep links, and stale APKs; the user-facing
              label is what matters. */}
          <Tabs.Screen
            name="today"
            options={{
              title: 'Dashboard',
              tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={20} color={color} />,
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
      </View>
    </DrawerProvider>
  );
}
