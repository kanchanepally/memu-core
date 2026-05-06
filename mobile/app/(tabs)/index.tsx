import { Redirect } from 'expo-router';

/**
 * The /(tabs) root resolves to Chat by default per the chat-first landing
 * brief (2026-05-06). The actual Today screen lives at /(tabs)/today —
 * unchanged in content, just relocated to a sidebar-only entry. Anything
 * that historically navigated to '/(tabs)' (older routes, push-notif
 * deep-links pre-update) lands here and bounces to chat.
 */
export default function TabsIndexRedirect() {
  return <Redirect href="/(tabs)/chat" />;
}
