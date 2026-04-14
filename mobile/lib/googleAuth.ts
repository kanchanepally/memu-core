/**
 * Google Sign-In hook for Memu (mobile + web).
 *
 * Requires these env vars (expo config → expo public):
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
 *   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
 *
 * Backend verifies the returned ID token against the same client IDs
 * (see src/channels/auth/google-signin.ts).
 */
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useCallback } from 'react';

WebBrowser.maybeCompleteAuthSession();

export interface GoogleAuthHook {
  request: ReturnType<typeof Google.useIdTokenAuthRequest>[0];
  signIn: () => Promise<string | null>;
}

/**
 * Returns { request, signIn } — call signIn() to open the Google consent
 * screen. Resolves to an ID token (JWT) which should be POSTed to the
 * Memu backend at /api/auth/google/signin.
 */
export function useGoogleSignIn(): GoogleAuthHook {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
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

  // Include response in request so consumers can inspect errors if needed
  return { request, signIn } as GoogleAuthHook;
}
