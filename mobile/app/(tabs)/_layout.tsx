import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DrawerProvider } from '../../lib/drawer';
import SideDrawer from '../../components/SideDrawer';

/**
 * The bottom tab bar is hidden — navigation lives in the side drawer
 * (open by tapping the logo in the top-left of any screen). Tabs.Screen
 * entries remain so Expo Router still resolves the routes; we just don't
 * render the tab bar UI.
 */
export default function TabLayout() {
  return (
    <DrawerProvider>
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
    </DrawerProvider>
  );
}
