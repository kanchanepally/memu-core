/**
 * Story 1.6 — Solid-OIDC provider.
 *
 * Wraps Panva's oidc-provider with the configuration Solid-OIDC expects:
 *   - webid as a supported claim in id_tokens and userinfo
 *   - DPoP-bound access tokens
 *   - Dynamic client registration enabled (Solid clients self-register)
 *   - Client authentication `none` allowed (public SPA clients)
 *   - PKCE required
 *   - Subject = the user's WebID (accountId internally = profile.id)
 *
 * The backlog endorses reaching for this library rather than reinventing
 * the auth stack (Story 1.6 acceptance criteria).
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
import Provider, { type Configuration, type KoaContextWithOIDC } from 'oidc-provider';
import { PostgresAdapter } from './adapter';
import { loadOrCreateJwks } from './jwks';
import { findAccountByAccountId } from './accounts';
import { resolveWebIdBaseUrl } from '../webid/webid';

let provider: Provider | null = null;

function buildConfiguration(jwks: Awaited<ReturnType<typeof loadOrCreateJwks>>): Configuration {
  return {
    adapter: PostgresAdapter as any,
    jwks,
    async findAccount(_ctx, accountId) {
      const account = await findAccountByAccountId(accountId);
      return account as any;
    },
    claims: {
      openid: ['sub'],
      profile: ['name'],
      email: ['email', 'email_verified'],
      // Solid-OIDC defines `webid` as a first-class claim.
      webid: ['webid'],
    },
    scopes: ['openid', 'profile', 'email', 'webid'],
    features: {
      // Solid clients self-register — no pre-configured client list.
      registration: { enabled: true },
      registrationManagement: { enabled: true, rotateRegistrationAccessToken: true },
      // DPoP binds access tokens to a proof-of-possession key. Required
      // by Solid-OIDC; the feature flag was GA'd in oidc-provider v8.
      dPoP: { enabled: true },
      // Userinfo endpoint — Solid clients call this to read `webid`.
      userinfo: { enabled: true },
      // Dev/beta convenience: let clients present the request directly
      // as JAR even though we're not mandating it. Harmless for Tier 2.
      jwtUserinfo: { enabled: true },
      // Revocation and introspection — useful for logout flows.
      revocation: { enabled: true },
      introspection: { enabled: true },
      // Resource indicators — Solid-OIDC uses this to scope tokens to a
      // particular Pod, even though v1 of Memu serves one Pod per family.
      resourceIndicators: {
        enabled: true,
        defaultResource: () => resolveWebIdBaseUrl(),
        getResourceServerInfo: () => ({
          scope: 'openid profile email webid',
          audience: resolveWebIdBaseUrl(),
          accessTokenFormat: 'jwt',
          accessTokenTTL: 3600,
        }),
      },
    },
    clientDefaults: {
      // Solid clients use authorization_code + PKCE. Public SPAs use
      // `token_endpoint_auth_method: none`; we allow that alongside the
      // more secure methods for confidential clients.
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      id_token_signed_response_alg: 'RS256',
    },
    clientBasedCORS(_ctx, origin, _client) {
      // Permissive CORS for Solid clients. They run as SPAs on arbitrary
      // origins and the spec expects the IdP to accept cross-origin calls.
      return !!origin;
    },
    // oidc-provider v8 hardcodes S256 as the only supported method; we
    // simply require PKCE on every request. Solid clients are expected
    // to implement it regardless.
    pkce: {
      required: () => true,
    },
    cookies: {
      keys: (process.env.MEMU_OIDC_COOKIE_KEYS ?? 'memu-oidc-cookie-key-change-me').split(','),
      long: { signed: true, httpOnly: true, sameSite: 'lax' },
      short: { signed: true, httpOnly: true, sameSite: 'lax' },
    },
    interactions: {
      url(_ctx, interaction) {
        return `/oidc/interaction/${interaction.uid}`;
      },
    },
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 14 * 24 * 3600,
      Interaction: 3600,
      Session: 14 * 24 * 3600,
      Grant: 14 * 24 * 3600,
    },
    async renderError(ctx: KoaContextWithOIDC, out, error) {
      ctx.type = 'text/plain';
      ctx.body = `Memu OIDC error: ${error.name}\n${(error as Error).message ?? ''}\n\n${JSON.stringify(out, null, 2)}`;
    },
  };
}

/**
 * Lazily construct the Provider. Called once at boot by the oidc routes
 * module. Safe to call repeatedly — returns the cached instance.
 */
export async function getOidcProvider(): Promise<Provider> {
  if (provider) return provider;
  const jwks = await loadOrCreateJwks();
  const issuer = resolveWebIdBaseUrl();
  provider = new Provider(issuer, buildConfiguration(jwks));
  // Behind Tailscale/nginx we trust the upstream proxy headers so
  // issued URLs have the correct scheme and host.
  provider.proxy = true;
  return provider;
}
