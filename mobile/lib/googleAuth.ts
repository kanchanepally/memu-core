/**
 * Google Sign-In hook for Memu (mobile + web).
 *
 * Requires these env vars (expo config → expo public):
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
 *   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
 *
 * If none are set at build time, the hook degrades to a no-op stub so the
 * onboarding flow still works via the manual name/email path. Memu is
 * designed to work without Google — Sign-In is a convenience, not a
 * requirement.
 *
 * Backend verifies the returned ID token against the same client IDs
 * (see src/channels/auth/google-signin.ts).
 */
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useCallback } from 'react';

WebBrowser.maybeCompleteAuthSession();

export interface GoogleAuthHook {
  request: ReturnType<typeof Google.useIdTokenAuthRequest>[0] | null;
  signIn: () => Promise<string | null>;
}

// Compile-time constant — EAS bakes env vars into the bundle.
export const GOOGLE_ENABLED = !!(
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
);

function useGoogleSignInReal(): GoogleAuthHook {
  const [request, , promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  const signIn = useCallback(async (): Promise<string | null> => {
    const res = await promptAsync();
    if (res?.type !== 'success') return null;
    const idToken =
      (res.params && (res.params.id_token as string | undefined)) ||
      (res.authentication && (res.authentication as any).idToken);
    return typeof idToken === 'string' ? idToken : null;
  }, [promptAsync]);

  return { request, signIn };
}

function useGoogleSignInStub(): GoogleAuthHook {
  const signIn = useCallback(async (): Promise<string | null> => null, []);
  return { request: null, signIn };
}

/**
 * Returns { request, signIn } — call signIn() to open the Google consent
 * screen. Resolves to an ID token (JWT) which should be POSTed to the
 * Memu backend at /api/auth/google/signin.
 *
 * When Google client IDs aren't configured at build time, returns a
 * stub whose `request` is null and whose `signIn` resolves to null —
 * consumers should check `GOOGLE_ENABLED` and hide the UI entry.
 */
export const useGoogleSignIn: () => GoogleAuthHook = GOOGLE_ENABLED
  ? useGoogleSignInReal
  : useGoogleSignInStub;
