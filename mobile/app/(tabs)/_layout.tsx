import { Tabs } from 'expo-router';
import { Platform, View, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, typography } from '../../lib/tokens';

/**
 * Floating bottom nav. Backdrop-blur shell with rounded top.
 * Active tab uses a pill with silk gradient (primary → primary-container).
 */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.onPrimary,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
        tabBarShowLabel: true,
        tabBarBackground: () => (
          <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill}>
            <View style={styles.tabBarSurface} />
          </BlurView>
        ),
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: Platform.OS === 'ios' ? 24 : 16,
          borderTopWidth: 0,
          height: 68,
          borderRadius: radius.xl,
          backgroundColor: 'transparent',
          overflow: 'hidden',
          paddingHorizontal: 6,
          paddingTop: 6,
          paddingBottom: 6,
          shadowColor: shadows.medium.shadowColor,
          shadowOffset: shadows.medium.shadowOffset,
          shadowOpacity: shadows.medium.shadowOpacity,
          shadowRadius: shadows.medium.shadowRadius,
          elevation: 6,
        },
        tabBarItemStyle: {
          borderRadius: radius.pill,
          marginHorizontal: 2,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: typography.families.label,
          textTransform: 'uppercase',
          letterSpacing: typography.tracking.wide,
          marginTop: 2,
        },
        tabBarActiveBackgroundColor: colors.primary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'sunny' : 'sunny-outline'} size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'chatbubble' : 'chatbubble-outline'} size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="spaces"
        options={{
          title: 'Spaces',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'albums' : 'albums-outline'} size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="lists"
        options={{
          title: 'Lists',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'list' : 'list-outline'} size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarSurface: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
});
