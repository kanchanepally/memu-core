import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_500Medium_Italic,
} from '@expo-google-fonts/newsreader';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';

/**
 * Memu Mobile — Font loading hook for the v3 design system.
 *
 * Usage in `app/_layout.tsx`:
 *
 *   import { useMemuFonts } from '@/lib/fonts';
 *   const [loaded] = useMemuFonts();
 *   if (!loaded) return <SplashScreen />;
 */
export function useMemuFonts() {
  return useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium,
    Newsreader_500Medium_Italic,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
}
