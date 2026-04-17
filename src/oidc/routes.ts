/**
 * Story 1.6 — mount the Solid-OIDC provider on Fastify.
 *
 * oidc-provider is a Koa app. Fastify doesn't mount Koa apps natively,
 * but Provider#callback() returns a plain node http handler suitable
 * for server.all('*', ...) with hijacked replies.
 *
 * Two route groups:
 *   - /oidc/*              → oidc-provider handles directly
 *   - /.well-known/*       → Solid clients discover the issuer here
 *
 * The interaction pages (login, consent) are implemented in Fastify
 * directly so we can reuse the profiles table for authentication
 * instead of building a parallel user store.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { getOidcProvider } from './provider';
import { authenticateWithPassword } from './accounts';
import { pool } from '../db/connection';

type AnyFastify = any;

/**
 * Invoke the oidc-provider callback with the raw Node request/response.
 * Fastify's `reply.hijack()` prevents Fastify from touching the response
 * afterwards — oidc-provider writes the full response itself.
 */
async function dispatchToProvider(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const provider = await getOidcProvider();
  reply.hijack();
  // oidc-provider mounts its routes at the root of whatever Koa app
  // hosts it. We strip the /oidc prefix so its internal routing sees
  // /.well-known/openid-configuration, /token, /auth etc.
  const rawUrl = request.raw.url ?? '/';
  if (rawUrl.startsWith('/oidc')) {
    request.raw.url = rawUrl.slice('/oidc'.length) || '/';
  }
  // Koa's callback signature — fire and forget; it manages the response.
  (provider.callback() as (req: any, res: any) => void)(request.raw, reply.raw);
}

function loginPage(uid: string, error?: string): string {
  // Minimal static login form. Deliberately no CSS framework — the goal
  // is a correct, ugly, defensible login page we can style later.
  const errorHtml = error
    ? `<p style="color:#b00020;margin-top:0">${escapeHtml(error)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Memu — Sign in</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 4rem auto; padding: 0 1rem; color: #222; }
    h1 { font-size: 1.4rem; }
    label { display: block; margin: 1rem 0 0.25rem; font-weight: 600; }
    input { width: 100%; padding: 0.6rem; font-size: 1rem; border: 1px solid #bbb; border-radius: 4px; box-sizing: border-box; }
    button { margin-top: 1.25rem; padding: 0.7rem 1rem; background: #2d4a3e; color: white; border: 0; border-radius: 4px; font-size: 1rem; cursor: pointer; }
    .hint { color: #666; font-size: 0.85rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Sign in to Memu</h1>
  ${errorHtml}
  <form method="POST" action="/oidc/interaction/${encodeURIComponent(uid)}/login">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required autofocus autocomplete="email" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required autocomplete="current-password" />
    <button type="submit">Sign in</button>
  </form>
  <p class="hint">This signs you in to a Solid-compatible application using your Memu identity. Set a password in the Memu mobile app under Settings → Solid identity.</p>
</body>
</html>`;
}

function consentPage(uid: string, clientName: string, scopes: string[]): string {
  const scopeList = scopes.map(s => `<li><code>${escapeHtml(s)}</code></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Memu — Authorise</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 420px; margin: 4rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.4rem; }
  form { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
  button { flex: 1; padding: 0.7rem; border: 0; border-radius: 4px; font-size: 1rem; cursor: pointer; }
  .allow { background: #2d4a3e; color: white; }
  .deny  { background: #eee; color: #222; }
  ul { background: #f7f7f7; padding: 1rem 1rem 1rem 2rem; border-radius: 4px; }
</style></head>
<body>
  <h1>Authorise ${escapeHtml(clientName)}?</h1>
  <p>This application is requesting access to:</p>
  <ul>${scopeList}</ul>
  <form method="POST" action="/oidc/interaction/${encodeURIComponent(uid)}/confirm">
    <button class="allow" type="submit" name="action" value="allow">Allow</button>
    <button class="deny"  type="submit" name="action" value="deny">Deny</button>
  </form>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

/**
 * Consume url-encoded form bodies directly from raw Node stream. Fastify
 * doesn't parse application/x-www-form-urlencoded by default and we don't
 * want to register a global parser just for two interaction routes.
 */
async function readFormBody(request: FastifyRequest): Promise<Record<string, string>> {
  const raw = request.raw;
  const chunks: Buffer[] = [];
  for await (const chunk of raw) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  const out: Record<string, string> = {};
  for (const pair of body.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

export function registerOidcRoutes(server: AnyFastify): void {
  // Discovery and jwks_uri must live at the issuer root for Solid-OIDC
  // clients to find them.
  server.all('/.well-known/openid-configuration', (request: FastifyRequest, reply: FastifyReply) => {
    request.raw.url = '/.well-known/openid-configuration';
    return dispatchToProvider(request, reply);
  });
  server.all('/.well-known/jwks.json', (request: FastifyRequest, reply: FastifyReply) => {
    request.raw.url = '/jwks';
    return dispatchToProvider(request, reply);
  });

  // Interaction pages — login and consent.
  server.get(
    '/oidc/interaction/:uid',
    async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
      const provider = await getOidcProvider();
      const details = await provider.interactionDetails(request.raw, reply.raw);
      const { uid, prompt, params } = details;
      reply.header('Content-Type', 'text/html; charset=utf-8');
      if (prompt.name === 'login') {
        return loginPage(uid);
      }
      if (prompt.name === 'consent') {
        const clientId = (params as any).client_id as string | undefined;
        let clientName = clientId ?? 'an application';
        if (clientId) {
          const client = await provider.Client.find(clientId);
          clientName = client?.clientName ?? clientId;
        }
        const scopes = ((params as any).scope as string | undefined)?.split(' ').filter(Boolean) ?? [];
        return consentPage(uid, clientName, scopes);
      }
      return `<p>Unsupported prompt: ${prompt.name}</p>`;
    },
  );

  server.post(
    '/oidc/interaction/:uid/login',
    async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
      const provider = await getOidcProvider();
      const form = await readFormBody(request);
      const accountId = await authenticateWithPassword(form.email, form.password);
      if (!accountId) {
        reply.header('Content-Type', 'text/html; charset=utf-8');
        return loginPage(request.params.uid, 'Incorrect email or password.');
      }
      const result = { login: { accountId } };
      reply.hijack();
      await provider.interactionFinished(request.raw, reply.raw, result, { mergeWithLastSubmission: false });
    },
  );

  server.post(
    '/oidc/interaction/:uid/confirm',
    async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
      const provider = await getOidcProvider();
      const form = await readFormBody(request);
      const details = await provider.interactionDetails(request.raw, reply.raw);
      const { params, session } = details;

      if (form.action === 'deny') {
        reply.hijack();
        await provider.interactionFinished(
          request.raw,
          reply.raw,
          { error: 'access_denied', error_description: 'User denied the request.' },
          { mergeWithLastSubmission: false },
        );
        return;
      }

      const accountId = session?.accountId;
      if (!accountId) {
        reply.code(400);
        return 'No active session to confirm.';
      }
      const clientId = (params as any).client_id as string;
      const requestedScope = ((params as any).scope as string) ?? 'openid';

      let grant = details.grantId
        ? await provider.Grant.find(details.grantId)
        : new provider.Grant({ accountId, clientId });
      if (!grant) grant = new provider.Grant({ accountId, clientId });
      grant.addOIDCScope(requestedScope);
      const grantId = await grant.save();

      reply.hijack();
      await provider.interactionFinished(
        request.raw,
        reply.raw,
        { consent: { grantId } },
        { mergeWithLastSubmission: true },
      );
    },
  );

  // Catch-all for the rest of the OIDC endpoints (auth, token, userinfo,
  // registration, introspect, revoke). Must come AFTER the interaction
  // routes — Fastify matches more specific paths first so order doesn't
  // technically matter, but keeping the wildcard last makes reading easier.
  server.all('/oidc/*', (request: FastifyRequest, reply: FastifyReply) => {
    return dispatchToProvider(request, reply);
  });

  server.log.info('Solid-OIDC provider routes live at /oidc/* and /.well-known/*');
  // Warn loudly if cookie keys weren't rotated from the default.
  if (!process.env.MEMU_OIDC_COOKIE_KEYS) {
    server.log.warn('MEMU_OIDC_COOKIE_KEYS not set — using default key. Rotate before production.');
  }
  // Sanity check the migrations ran.
  pool.query('SELECT 1 FROM oidc_payload LIMIT 0').catch((err: Error) => {
    server.log.error({ err }, 'oidc_payload table missing — 008_webid.sql migration must run.');
  });
}
