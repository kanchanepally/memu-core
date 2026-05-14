import 'dotenv/config'; // Load env variables immediately before other imports

import Fastify from 'fastify';
import pino from 'pino';
import { testConnection, pool, assertRuntimeRoleNotSuperuser } from './db/connection';
import { db, enterCollectiveContext, bindCollectiveContext, currentCollectiveId } from './db/tenant';
import { runMigrations } from './db/migrate';
import { connectToWhatsApp } from './channels/whatsapp';
import { seedContext } from './intelligence/context';
import { processIntelligencePipeline } from './intelligence/orchestrator';
import { processChatVisionInput } from './intelligence/vision';
import { processDocumentIngestion } from './intelligence/documentIngestion';
import { fetchUpcomingEvents, getGoogleAuthUrl, handleGoogleCallback, createGoogleCalendarEvent, insertCalendarEvent } from './channels/calendar/google';
import { generateBriefingText, generateProactiveSynthesis, pushMorningBriefingToMobile } from './intelligence/briefing';
import { getTokensForProfile, sendPush } from './channels/mobile';
import { getBriefPreferences, updateBriefPreferences } from './preferences/brief';
import { geocodePlace, listAvailableNewsSources } from './intelligence/ambient';
import { fetchNewsFeed } from './intelligence/news';
import { pickPrompt, getPromptById } from './intelligence/captureNudges';
import { extractAndStoreFacts } from './intelligence/autolearn';
import {
  getOnboardingState, recordStep, markComplete,
  type OnboardingStep, ONBOARDING_STEP_ORDER, nextPendingStep, isComplete,
} from './onboarding/state';
import { copyForStep, buildAcknowledgement } from './onboarding/prompts';
import { processOnboardingAnswer } from './intelligence/onboarding';
import { registerPushToken } from './channels/mobile';
import { requireAuth, requireCollective, registerProfile } from './auth';
import { verifyGoogleIdToken, signInWithGoogle, GoogleSignInRejected } from './channels/auth/google-signin';
import { importWhatsAppExport, importTextFile, importFileBundle } from './intelligence/import';
import { validateAllSkills, listSkills } from './skills/loader';
import { registerWebIdRoutes } from './webid/server';
import { registerOidcRoutes } from './oidc/routes';
import { registerSolidSpaceRoutes } from './spaces/solid_routes';
import { setOidcPassword } from './oidc/accounts';
import {
  setProviderKey,
  revokeProviderKey,
  setProviderKeyEnabled,
  listProviderKeyStatus,
  type BYOKProvider,
} from './security/byok';
import {
  addItem as addListItem,
  listItems as listListItems,
  completeItem as completeListItem,
  reopenItem as reopenListItem,
  deleteItem as deleteListItem,
  updateItem as updateListItem,
  type ListType,
  type ListStatus,
} from './lists/store';
import { upsertSpace, findSpaceBySlug, findSpaceByUri, validateParentRelationship, listSpaces } from './spaces/store';
import { SPACE_CATEGORIES, type SpaceCategory } from './spaces/model';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import path from 'path';
import cron from 'node-cron';

// Setup logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

// Create Fastify Gateway
const server = Fastify({
  logger,
  bodyLimit: 50 * 1024 * 1024, // 50MB — WhatsApp exports and Obsidian vaults can be large
});

// CORS for mobile app and web dashboard
server.register(fastifyCors, {
  origin: true, // Allow all origins in development; lock down in production
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

// Serve frontend Memu PWA (Slice 2b)
server.register(fastifyStatic, {
  root: path.join(process.cwd(), 'src', 'dashboard', 'public'),
  prefix: '/', // Serve at root
});

// Liveness probe (no auth required). Returns 200 as long as the process is
// running; a load balancer / Docker healthcheck uses this to decide whether
// to restart the container. Deliberately does NOT touch the DB — a slow or
// dead Postgres should NOT cause the API process to be killed and restarted.
server.get('/healthz', async () => {
  return {
    status: 'ok',
    service: 'memu-core',
    timestamp: new Date().toISOString(),
  };
});

// Back-compat alias for the original /health path.
server.get('/health', async () => ({
  status: 'ok',
  service: 'memu-core',
  timestamp: new Date().toISOString(),
}));

// Readiness probe (no auth required). Returns 200 only when the API can
// serve real traffic — DB reachable, skills loaded. A load balancer uses
// THIS to decide whether to route requests; a 503 means "I'm up but not
// ready, don't send traffic yet". Used during Hetzner deploys for
// rolling-update gating and during boot to delay the listen-ready signal
// until migrations + skill validation have settled.
server.get('/readyz', async (_request, reply) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  let overallOk = true;

  try {
    await db.query('SELECT 1');
    checks.db = { ok: true };
  } catch (err) {
    overallOk = false;
    checks.db = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  try {
    const skillCount = listSkills().length;
    checks.skills = { ok: skillCount > 0, detail: `${skillCount} loaded` };
    if (skillCount === 0) overallOk = false;
  } catch (err) {
    overallOk = false;
    checks.skills = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  if (!overallOk) return reply.code(503).send({ status: 'not_ready', checks });
  return { status: 'ready', checks };
});

// Story 1.6 — WebID profile documents and Solid-compatible identity.
// `/people/:slug` is public; `/api/profile/card` is subject-authenticated.
registerWebIdRoutes(server);
// Solid-OIDC provider — `.well-known/*` discovery and `/oidc/*` endpoints.
// Dispatched to Panva's oidc-provider via raw Node handlers.
registerOidcRoutes(server);
// Story 3.3a — Solid HTTP read surface for Spaces. Auth here is the
// Solid-OIDC bearer JWT issued by registerOidcRoutes above; these
// routes deliberately live outside /api/ so the API-key preHandler
// does not run on them.
registerSolidSpaceRoutes(server);

// ==========================================
// REGISTRATION (no auth required)
// ==========================================

server.post('/api/register', async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.name) {
    return reply.code(400).send({ error: 'Name is required' });
  }

  try {
    const profile = await registerProfile(
      body.name.trim(),
      (body.email || '').trim(),
      body.role || 'adult',
      body.familyNames || ''
    );
    return {
      id: profile.id,
      displayName: profile.display_name,
      email: profile.email,
      apiKey: profile.api_key,
    };
  } catch (err: any) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Registration failed' });
  }
});

// ==========================================
// AUTH MIDDLEWARE — all /api/* routes below require auth
// ==========================================

// Pre-Beta Stream 1 — auth chain.
//   Phase 1: requireAuth      — populates request.profileId from API key.
//   Phase 2: requireCollective — populates request.collectiveId, enters the
//                               AsyncLocalStorage tenant context, blocks
//                               collectives pending GDPR erasure (Stream 3).
//   Phase 3: logger binding   — request-scoped pino child logger.
//
// Routes that are deliberately unauthenticated (health checks, register,
// Google sign-in, OAuth callback, static assets) skip phase 1 + 2.
//
// /api/register and /api/auth/google/signin run AUTH but not COLLECTIVE,
// because the very purpose of those routes is to land a user on a profile
// (and therefore a collective). After they return, the client carries an
// API key that future requests use to traverse both phases.

const UNAUTHENTICATED_ROUTES = new Set<string>([
  '/health',
  '/healthz',
  '/readyz',
  '/api/register',
  '/api/auth/google/signin',
  '/api/admin/trigger-briefing',
]);

function isUnauthenticatedRoute(url: string): boolean {
  if (UNAUTHENTICATED_ROUTES.has(url)) return true;
  if (url.startsWith('/api/auth/google/callback')) return true;
  if (!url.startsWith('/api/')) return true;
  return false;
}

server.addHook('preHandler', async (request, reply) => {
  if (isUnauthenticatedRoute(request.url)) return;
  return requireAuth(request, reply);
});

server.addHook('preHandler', async (request, reply) => {
  if (isUnauthenticatedRoute(request.url)) return;
  // requireAuth has populated request.profileId; resolve collective
  // and enter the AsyncLocalStorage context for tenant-scoped queries.
  return requireCollective(request, reply);
});

// Re-bind the ALS tenant context at the latest possible preHandler slot
// (TD-05). On the Z2 standalone deploy 2026-05-13, the context that
// requireCollective.bindCollectiveContext() entered via AsyncLocalStorage
// .enterWith() didn't propagate into the route handler — every chat turn
// failed with NOT NULL violations on `collective_id` for conversations,
// privacy_ledger, and downstream tool calls (updateSpace / addToList).
//
// Re-binding here, in a fresh preHandler that runs AFTER requireCollective
// resolves, refreshes the ALS frame at the latest async boundary before
// the route handler runs. Idempotent if the original bind held; a fix
// if it didn't. Root cause likely a Fastify-Node async-resource interplay
// where requireCollective's await of queryAsBootstrap before the enterWith
// causes the bound store to be popped by the time control returns to the
// route handler. Investigation deferred — TD-05.
server.addHook('preHandler', async (request) => {
  if (isUnauthenticatedRoute(request.url)) return;
  const collectiveId = (request as any).collectiveId as string | undefined;
  if (collectiveId) bindCollectiveContext(collectiveId);
});

// After auth, bind the resolved profileId into the request logger so every
// log line under that request carries it. Critical for beta debug — when a
// user reports a problem and we have only the timestamp, we want to be able
// to grep for `profileId=<their-id>` and reconstruct the request trail
// without joining manually across log lines.
server.addHook('preHandler', async (request) => {
  const profileId = (request as any).profileId;
  if (profileId) {
    (request as any).log = request.log.child({ profileId });
  }
});

// Google Sign-In — accepts a Google ID token from the mobile/web client,
// verifies it server-side, and returns the primary profile's API key.
server.post('/api/auth/google/signin', async (request, reply) => {
  const body = request.body as { idToken?: string };
  if (!body || !body.idToken) {
    return reply.code(400).send({ error: 'idToken is required' });
  }
  try {
    const identity = await verifyGoogleIdToken(body.idToken);
    const profile = await signInWithGoogle(identity);
    return {
      id: profile.id,
      displayName: profile.display_name,
      email: profile.email,
      apiKey: profile.api_key,
    };
  } catch (err: any) {
    if (err instanceof GoogleSignInRejected) {
      // 403 — token is valid, but this collective hasn't invited this email.
      // Distinct from 401 (invalid token) so the client can show a clear
      // "ask your admin to invite you" message rather than "sign-in broken".
      return reply.code(403).send({ error: err.message, reason: err.reason });
    }
    server.log.error({ err }, 'Google sign-in failed');
    return reply.code(401).send({ error: 'Google sign-in failed', detail: err?.message });
  }
});

// Manual Context Seeding — uses authenticated profile
server.post('/api/seed', async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.content) {
    return reply.code(400).send({ error: 'Content is required' });
  }
  const profileId = (request as any).profileId;
  const result = await seedContext(body.content, body.source || 'manual', profileId);
  return result;
});

// ==========================================
// IMPORT ENDPOINTS
// ==========================================

// Import WhatsApp .txt export — can be run multiple times, deduplicates
server.post('/api/import/whatsapp', async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.content) {
    return reply.code(400).send({ error: 'content (the .txt file content) is required' });
  }

  const profileId = (request as any).profileId;
  const chatName = body.chatName || 'WhatsApp Chat';

  try {
    const result = await importWhatsAppExport(profileId, body.content, chatName);
    return result;
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Import failed' });
  }
});

// Import a single text/markdown file — can be run multiple times, deduplicates
server.post('/api/import/file', async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.content || !body.filename) {
    return reply.code(400).send({ error: 'content and filename are required' });
  }

  const profileId = (request as any).profileId;

  try {
    const result = await importTextFile(profileId, body.content, body.filename);
    return result;
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Import failed' });
  }
});

// Import multiple files at once (e.g., Obsidian vault export)
server.post('/api/import/bundle', async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.files || !Array.isArray(body.files)) {
    return reply.code(400).send({ error: 'files array is required, each with {filename, content}' });
  }

  const profileId = (request as any).profileId;

  try {
    const result = await importFileBundle(profileId, body.files);
    return result;
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Import failed' });
  }
});

// Chat API — uses authenticated profile
server.post('/api/message', async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.content) return reply.code(400).send({ error: 'Content required' });

  try {
    const profileId = (request as any).profileId;
    // Belt-and-braces ALS re-bind at handler entry. The latest-preHandler
    // re-bind above should be sufficient, but pipelines that await heavily
    // (chat, especially the SSE variant) span enough async slots that
    // entering one more time at the root of the handler's own async tree
    // is cheap insurance. TD-05.
    const collectiveId = (request as any).collectiveId;
    if (collectiveId) bindCollectiveContext(collectiveId);
    if (!currentCollectiveId()) {
      server.log.warn({ profileId, collectiveId }, '[ALS] tenant context still null at /api/message entry');
    }
    const messageId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const visibility = body.visibility === 'personal' ? 'personal' : 'family';
    const result = await processIntelligencePipeline(profileId, body.content, 'mobile', messageId, visibility);
    return {
      response: result.response,
      retrievalState: result.retrievalState,
      retrievedSpaces: result.retrievedSpaces,
    };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Pipeline failed' });
  }
});

/**
 * Streaming chat — Server-Sent Events variant of /api/message.
 *
 * The blocking POST endpoint can sit silent for 30-90 seconds when Claude
 * runs a multi-iteration tool loop with web_search. This streams progress
 * events back as the pipeline moves through Twin guard / retrieval /
 * routing / tool calls / synthesis, so the chat UI can render a live
 * "thinking pill" instead of a black-box spinner. Final reply is delivered
 * on the `done` event.
 *
 * Event types:
 *   twin_check    — { } — Twin guard about to anonymise
 *   retrieving    — { } — pulling Spaces + embeddings
 *   routing       — { provider, model } — LLM provider selected
 *   tool_use      — { tool } — a tool fired (webSearch, findSpaces, …)
 *   synthesising  — { } — tool loop done; final response synthesis
 *   done          — { response } — full text ready
 *   error         — { error } — pipeline failed
 *
 * Client picks copy variants for each event ("Cross-checking the web…",
 * "Pulling what I know about Robin", etc.) — the server returns
 * structural events only.
 */
server.post('/api/message/stream', async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.content) return reply.code(400).send({ error: 'Content required' });

  const profileId = (request as any).profileId;
  if (!profileId) return reply.code(401).send({ error: 'Authentication required' });

  // Belt-and-braces ALS re-bind — see /api/message handler. TD-05.
  const collectiveId = (request as any).collectiveId;
  if (collectiveId) bindCollectiveContext(collectiveId);
  if (!currentCollectiveId()) {
    server.log.warn({ profileId, collectiveId }, '[ALS] tenant context still null at /api/message/stream entry');
  }

  // SSE setup. Take over the raw response — Fastify reply.hijack()
  // releases the framework's serialisation so we can write chunked events.
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  reply.hijack();
  reply.raw.flushHeaders();

  const sse = (eventName: string, payload: Record<string, unknown>) => {
    try {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      // Client may have disconnected mid-stream — fine, just stop writing.
    }
  };

  // Keep-alive comment every 15s so intermediaries / proxies don't close
  // the connection during a slow tool loop (web_search can take 20+ s).
  const keepAlive = setInterval(() => {
    try { reply.raw.write(': ping\n\n'); } catch { /* swallow */ }
  }, 15000);

  // Client disconnect → cancel keepAlive. Pipeline runs to completion so
  // any side effects (Space writes, list inserts) still persist; we just
  // stop writing events to a closed socket.
  let aborted = false;
  request.raw.on('close', () => { aborted = true; clearInterval(keepAlive); });

  try {
    const messageId = `mobile-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const visibility = body.visibility === 'personal' ? 'personal' : 'family';

    const result = await processIntelligencePipeline(
      profileId,
      body.content,
      'mobile',
      messageId,
      visibility,
      {
        onProgress: (event) => {
          if (aborted) return;
          // 'done' fires from the pipeline; we add the response payload at
          // the endpoint boundary (the pipeline doesn't carry the final
          // text into its event shape).
          if (event.type === 'done') return; // handled after the await
          sse(event.type, event as Record<string, unknown>);
        },
      },
    );

    if (!aborted) {
      sse('done', {
        response: result.response,
        retrievalState: result.retrievalState,
        retrievedSpaces: result.retrievedSpaces,
      });
    }
  } catch (err) {
    server.log.error(err);
    if (!aborted) {
      sse('error', { error: err instanceof Error ? err.message : 'Pipeline failed' });
    }
  } finally {
    clearInterval(keepAlive);
    try { reply.raw.end(); } catch { /* swallow */ }
  }
});

// Chat Vision API — caller sends a base64 image + optional caption. The
// vision skill extracts stream cards and we return a human-readable summary
// for the chat bubble.
server.post('/api/vision', async (request, reply) => {
  const body = request.body as { image?: string; mimeType?: string; caption?: string };
  if (!body?.image || typeof body.image !== 'string') {
    return reply.code(400).send({ error: 'image (base64) required' });
  }
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg';
  const caption = typeof body.caption === 'string' ? body.caption : '';
  try {
    const profileId = (request as any).profileId;
    const messageId = `mobile-vi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const buffer = Buffer.from(body.image, 'base64');
    if (buffer.length === 0) {
      return reply.code(400).send({ error: 'image payload is empty' });
    }
    const result = await processChatVisionInput(profileId, buffer, mimeType, caption, messageId, 'mobile');
    return { response: result.response, cards: result.cards };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Vision pipeline failed' });
  }
});

// Document ingestion — caller sends a base64-encoded file (PDF or plain
// text). The ingestion pipeline parses, anonymises, dispatches the
// document_ingestion skill, and persists a `document` Space + any
// time-sensitive stream cards. Adults only — children's profiles cannot
// upload documents in v1 (same posture as Article 20 export).
server.post('/api/document', async (request, reply) => {
  const body = request.body as {
    file?: string;
    fileName?: string;
    mimeType?: string;
  };
  if (!body?.file || typeof body.file !== 'string') {
    return reply.code(400).send({ error: 'file (base64) required' });
  }
  if (!body?.fileName || typeof body.fileName !== 'string') {
    return reply.code(400).send({ error: 'fileName required' });
  }
  const fileName = body.fileName;
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'application/octet-stream';
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'children cannot upload documents' });
    }
    const profileId = (request as any).profileId;
    const messageId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const buffer = Buffer.from(body.file, 'base64');
    if (buffer.length === 0) {
      return reply.code(400).send({ error: 'document payload is empty' });
    }
    // Cap inbound at 25MB — refuses anything larger before we waste time
    // base64-decoding gigabytes. Practical PDF size for school letters
    // and bills is <2MB; 25MB is generous headroom for image-heavy PDFs.
    if (buffer.length > 25 * 1024 * 1024) {
      return reply.code(413).send({ error: 'document too large (max 25MB)' });
    }
    const result = await processDocumentIngestion({
      profileId,
      fileName,
      buffer,
      mimeType,
      channel: 'pwa',
      messageId,
    });
    if (!result.ok) {
      // 422 — semantically valid request, but processing failed at parse
      // / skill / persist stage. Echo the stage so the client can
      // distinguish "you uploaded a scanned PDF" from "the LLM choked".
      return reply.code(422).send({ error: result.error, stage: result.stage });
    }
    return {
      ok: true,
      spaceUri: result.spaceUri,
      spaceTitle: result.spaceTitle,
      docType: result.docType,
      charCount: result.charCount,
      truncated: result.truncated,
      streamCardCount: result.streamCardCount,
      followupText: result.followupText,
    };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Document ingestion failed' });
  }
});

// Register an Expo push token for the authenticated profile
server.post('/api/push/register', async (request, reply) => {
  const body = request.body as any;
  if (!body?.token) return reply.code(400).send({ error: 'token required' });
  try {
    const profileId = (request as any).profileId;
    await registerPushToken(profileId, body.token, body.platform);
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(400).send({ error: err instanceof Error ? err.message : 'Registration failed' });
  }
});

// BYOK — bring-your-own-key for LLM providers.
// Adults can paste an API key (currently Anthropic only); children cannot.
const VALID_BYOK_PROVIDERS: BYOKProvider[] = ['anthropic', 'gemini', 'openai'];

server.get('/api/profile/byok', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return { keys: [], reason: 'children cannot configure BYOK keys' };
    }
    const keys = await listProviderKeyStatus(profileId);
    return { keys };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load BYOK status' });
  }
});

server.post('/api/profile/byok', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot configure BYOK keys' });
    }
    const body = request.body as { provider?: string; apiKey?: string };
    if (!body?.provider || !VALID_BYOK_PROVIDERS.includes(body.provider as BYOKProvider)) {
      return reply.code(400).send({ error: 'provider must be one of: anthropic, gemini, openai' });
    }
    if (!body.apiKey || typeof body.apiKey !== 'string') {
      return reply.code(400).send({ error: 'apiKey is required' });
    }
    await setProviderKey((request as any).profileId, body.provider as BYOKProvider, body.apiKey);
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to set key' });
  }
});

server.delete('/api/profile/byok', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot configure BYOK keys' });
    }
    const body = request.body as { provider?: string };
    const query = request.query as { provider?: string };
    const providerRaw = body?.provider ?? query?.provider;
    if (!providerRaw || !VALID_BYOK_PROVIDERS.includes(providerRaw as BYOKProvider)) {
      return reply.code(400).send({ error: 'provider must be one of: anthropic, gemini, openai' });
    }
    await revokeProviderKey((request as any).profileId, providerRaw as BYOKProvider);
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to revoke key' });
  }
});

// Set the OIDC login password for the authenticated profile. Separate
// from the API-key used by the mobile app — this one is what the user
// types into Memu's login form when a Solid client redirects them here.
server.post('/api/profile/oidc-password', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const body = request.body as { password?: string };
    if (!body?.password) return reply.code(400).send({ error: 'password required' });
    await setOidcPassword(profileId, body.password);
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to set password' });
  }
});

// Family-wide reflection on/off toggle. Story 2.2 — a quiet mode so a
// family can silence the reflection engine without losing the Spaces
// write path. Any authenticated adult may toggle.
server.get('/api/family/settings', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const res = await db.query(
      `SELECT reflection_enabled FROM family_settings WHERE family_id = $1`,
      [profileId],
    );
    const reflection_enabled = res.rows[0]?.reflection_enabled ?? true;
    return { reflection_enabled };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load family settings' });
  }
});

server.post('/api/family/settings', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot change family settings' });
    }
    const body = request.body as { reflection_enabled?: boolean };
    if (typeof body?.reflection_enabled !== 'boolean') {
      return reply.code(400).send({ error: 'reflection_enabled (boolean) required' });
    }
    const profileId = (request as any).profileId;
    await db.query(
      `INSERT INTO family_settings (family_id, reflection_enabled, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (family_id) DO UPDATE
         SET reflection_enabled = EXCLUDED.reflection_enabled, updated_at = NOW()`,
      [profileId, body.reflection_enabled],
    );
    return { success: true, reflection_enabled: body.reflection_enabled };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to update family settings' });
  }
});

// ==========================================
// Care Standards (Story 2.3) — Minimum Standards of Care CRUD
// ==========================================

server.get('/api/care-standards', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const url = new URL(request.url, 'http://localhost');
    const enabledOnly = url.searchParams.get('enabled') === 'true';
    const { listStandards } = await import('./care/standards');
    const standards = await listStandards(profileId, enabledOnly);
    return { standards };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to list care standards' });
  }
});

server.post('/api/care-standards/seed', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot seed care standards' });
    }
    const profileId = (request as any).profileId;
    const { seedDefaultStandards } = await import('./care/standards');
    const inserted = await seedDefaultStandards(profileId);
    return { success: true, inserted };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to seed care standards' });
  }
});

server.post('/api/care-standards', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot add care standards' });
    }
    const body = request.body as {
      domain?: string;
      description?: string;
      frequencyDays?: number;
      appliesTo?: string[];
    };
    if (!body?.domain || !body.description || typeof body.frequencyDays !== 'number' || body.frequencyDays <= 0) {
      return reply.code(400).send({ error: 'domain, description, and positive frequencyDays required' });
    }
    const profileId = (request as any).profileId;
    const { createCustomStandard } = await import('./care/standards');
    const standard = await createCustomStandard({
      familyId: profileId,
      domain: body.domain as any,
      description: body.description,
      frequencyDays: body.frequencyDays,
      appliesTo: body.appliesTo,
    });
    return { standard };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to create care standard' });
  }
});

server.post('/api/care-standards/:id/toggle', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot toggle care standards' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as { enabled?: boolean };
    if (typeof body?.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled (boolean) required' });
    }
    const { setStandardEnabled } = await import('./care/standards');
    await setStandardEnabled(id, body.enabled);
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to toggle care standard' });
  }
});

server.post('/api/care-standards/:id/complete', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot mark care standards complete' });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { completedAt?: string };
    const when = body.completedAt ? new Date(body.completedAt) : new Date();
    if (isNaN(when.getTime())) {
      return reply.code(400).send({ error: 'completedAt must be a valid ISO date' });
    }
    const { markCompleted } = await import('./care/standards');
    await markCompleted(id, when);
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to mark care standard complete' });
  }
});

// ==========================================
// Domain Health (Story 2.4) — read-only status, visibility-scoped
// ==========================================

server.get('/api/domains/status', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    const profileId = (request as any).profileId;
    const { listDomainStates } = await import('./domains/health');
    const states = await listDomainStates(profileId);
    // Children see domain + health only — notes can carry adult-only or
    // partners_only context. Adults see the full picture.
    const isChild = profile?.role === 'child';
    const visible = states.map(s => ({
      domain: s.domain,
      health: s.health,
      lastActivity: s.lastActivity,
      openItems: isChild ? null : s.openItems,
      overdueStandards: isChild ? null : s.overdueStandards,
      approachingStandards: isChild ? null : s.approachingStandards,
      notes: isChild ? null : s.notes,
      updatedAt: s.updatedAt,
    }));
    return { domains: visible };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load domain status' });
  }
});

server.delete('/api/care-standards/:id', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot delete care standards' });
    }
    const { id } = request.params as { id: string };
    const { deleteCustomStandard } = await import('./care/standards');
    await deleteCustomStandard(id);
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to delete care standard' });
  }
});

server.post('/api/profile/byok/toggle', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot configure BYOK keys' });
    }
    const body = request.body as { provider?: string; enabled?: boolean };
    if (!body?.provider || !VALID_BYOK_PROVIDERS.includes(body.provider as BYOKProvider)) {
      return reply.code(400).send({ error: 'provider required' });
    }
    if (typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled (boolean) required' });
    }
    await setProviderKeyEnabled((request as any).profileId, body.provider as BYOKProvider, body.enabled);
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to toggle key' });
  }
});

// ==========================================
// Twin Registry (Story 1.5) — family-visible management of anonymised entities
// ==========================================

const VALID_ENTITY_TYPES = [
  'person', 'school', 'workplace', 'medical', 'location',
  'activity', 'business', 'institution', 'other',
];

server.get('/api/twin/registry', async (_request, reply) => {
  try {
    const { rows } = await db.query(
      `SELECT id, entity_type, real_name, anonymous_label, detected_by, confirmed,
              first_seen_at, confirmed_at
         FROM entity_registry
         ORDER BY entity_type, anonymous_label`,
    );
    return { entities: rows };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load Twin registry' });
  }
});

server.post('/api/twin/registry', async (request, reply) => {
  try {
    const body = request.body as { entityType?: string; realName?: string; anonymousLabel?: string };
    if (!body?.entityType || !VALID_ENTITY_TYPES.includes(body.entityType)) {
      return reply.code(400).send({ error: `entityType must be one of: ${VALID_ENTITY_TYPES.join(', ')}` });
    }
    if (!body.realName || typeof body.realName !== 'string' || body.realName.trim().length < 1) {
      return reply.code(400).send({ error: 'realName is required' });
    }
    if (!body.anonymousLabel || typeof body.anonymousLabel !== 'string' || body.anonymousLabel.trim().length < 1) {
      return reply.code(400).send({ error: 'anonymousLabel is required' });
    }
    const profileId = (request as any).profileId;
    const { rows } = await db.query(
      `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by, confirmed, confirmed_at, confirmed_by)
       VALUES ($1, $2, $3, 'manual', TRUE, NOW(), $4)
       RETURNING id, entity_type, real_name, anonymous_label, detected_by, confirmed`,
      [body.entityType, body.realName.trim(), body.anonymousLabel.trim(), profileId],
    );
    return { entity: rows[0] };
  } catch (err) {
    server.log.error(err);
    return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to add entity' });
  }
});

server.patch<{ Params: { id: string } }>('/api/twin/registry/:id', async (request, reply) => {
  try {
    const id = request.params.id;
    const body = request.body as { realName?: string; anonymousLabel?: string; entityType?: string; confirmed?: boolean };
    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.realName !== undefined) { updates.push(`real_name = $${i++}`); values.push(body.realName.trim()); }
    if (body.anonymousLabel !== undefined) { updates.push(`anonymous_label = $${i++}`); values.push(body.anonymousLabel.trim()); }
    if (body.entityType !== undefined) {
      if (!VALID_ENTITY_TYPES.includes(body.entityType)) {
        return reply.code(400).send({ error: `entityType must be one of: ${VALID_ENTITY_TYPES.join(', ')}` });
      }
      updates.push(`entity_type = $${i++}`); values.push(body.entityType);
    }
    if (body.confirmed !== undefined) {
      updates.push(`confirmed = $${i++}`); values.push(body.confirmed);
      if (body.confirmed) {
        updates.push(`confirmed_at = NOW()`);
        updates.push(`confirmed_by = $${i++}`);
        values.push((request as any).profileId);
      }
    }

    if (updates.length === 0) return reply.code(400).send({ error: 'No updates provided' });

    values.push(id);
    const { rows, rowCount } = await db.query(
      `UPDATE entity_registry SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING id, entity_type, real_name, anonymous_label, detected_by, confirmed`,
      values,
    );
    if (rowCount === 0) return reply.code(404).send({ error: 'Entity not found' });
    return { entity: rows[0] };
  } catch (err) {
    server.log.error(err);
    return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to update entity' });
  }
});

server.delete<{ Params: { id: string } }>('/api/twin/registry/:id', async (request, reply) => {
  try {
    const id = request.params.id;
    const { rowCount } = await db.query('DELETE FROM entity_registry WHERE id = $1', [id]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Entity not found' });
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to delete entity' });
  }
});

// OAuth: Initiate Google Sign In — uses authenticated profile
server.get('/api/auth/google', async (request, reply) => {
  // CONFIG CHECK: Ensure Google OAuth secrets are actually set on the server
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return reply.code(400).send({ 
       error: 'Google Calendar is not configured on this server. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file on the Z2.' 
    });
  }

  const profileId = (request as any).profileId;
  const query = request.query as any;
  const source = query.source || 'pwa';
  const url = getGoogleAuthUrl(profileId, source);
  if (query.format === 'json') {
    return { url };
  }
  return reply.redirect(url);
});

// OAuth: Callback from Google
server.get('/api/auth/google/callback', async (request, reply) => {
  const { code, state } = request.query as any;
  if (!code || !state) return reply.code(400).send({ error: 'Invalid callback' });
  
  try {
    // Unpack state: "profileId:source"
    const [profileId, source] = state.split(':');
    if (!profileId) throw new Error('Missing profileId in state');

    await handleGoogleCallback(code, profileId);
    
    // Redirect based on source
    if (source === 'mobile') {
      return reply.redirect('memu://auth/callback?connected=true');
    }
    return reply.redirect('/?connected=true');
  } catch (err: any) {
    server.log.error(err);
    return reply.code(500).send({ 
       error: 'OAuth failed', 
       message: err.message, 
       stack: err.stack 
    });
  }
});

// OAuth: Disconnect Google Calendar
server.delete('/api/auth/google', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    await db.query(
      `DELETE FROM profile_channels WHERE profile_id = $1 AND channel = 'google_calendar'`,
      [profileId]
    );
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to disconnect calendar' });
  }
});

// Synthesis Endpoint for App Landing Page.
//
// The mobile Today screen calls this on every focus event (tab switch, app
// foreground, navigate-back). Without caching, each focus fired a fresh
// Sonnet call against calendar+inbox+cards data that hadn't changed since
// the previous call — observed 5–10 calls/day per user at ~£0.018 each on
// 2026-04-27, scaling linearly with users.
//
// Cache is per-profile, in-memory, 15 minute TTL. Bust on demand via
// invalidateSynthesisCache() — called from any endpoint that mutates the
// underlying inputs (stream cards, calendar, inbox).
const SYNTHESIS_CACHE_TTL_MS = 15 * 60 * 1000;
const synthesisCache = new Map<string, { value: string | null; cachedAt: number }>();

function invalidateSynthesisCache(profileId: string): void {
  synthesisCache.delete(profileId);
}

server.get('/api/dashboard/synthesis', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;

    const cached = synthesisCache.get(profileId);
    if (cached && Date.now() - cached.cachedAt < SYNTHESIS_CACHE_TTL_MS) {
      return { synthesis: cached.value, cached: true };
    }

    const synthesis = await generateProactiveSynthesis(profileId);
    synthesisCache.set(profileId, { value: synthesis, cachedAt: Date.now() });
    return { synthesis, cached: false };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to generate synthesis' });
  }
});

// Push notification diagnostics — exposes registration state to the mobile
// Settings screen so users can see whether push has actually been wired up.
//
// Until 2026-04-29 the mobile registration path silently swallowed errors
// (`.catch(() => {})` on the POST to /api/push/register), and the result
// was: zero rows in push_tokens for any user, ever, including the dev's
// primary device. The morning briefing — Memu's primary "sticky" feature —
// has never been delivered as a push notification to anyone.
//
// This endpoint exposes token state. The companion /api/push/test endpoint
// fires a real push to the caller's tokens so the user can confirm
// end-to-end delivery from inside the app.
server.get('/api/push/diagnose', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const res = await db.query<{ token: string; platform: string | null; created_at: Date; last_seen_at: Date }>(
      `SELECT token, platform, created_at, last_seen_at
         FROM push_tokens
        WHERE profile_id = $1
        ORDER BY last_seen_at DESC`,
      [profileId],
    );
    return {
      tokenCount: res.rows.length,
      tokens: res.rows.map(r => ({
        // Only the last 8 chars of the token — enough to disambiguate devices,
        // not enough to spoof a push from elsewhere.
        suffix: r.token.slice(-8),
        platform: r.platform,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
      })),
    };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Diagnose failed' });
  }
});

// Onboarding — conversational seed-context flow.
//
// The mobile app's onboarding screens (welcome → setup → people → rhythm →
// focus → preview → channels) ask three free-form questions whose answers
// flow through `processOnboardingAnswer` to create person / routine /
// commitment Spaces and embedding-recall rows. State is per-profile;
// closing the app mid-flow returns the user to the next pending step.
//
// Each endpoint here is "soft idempotent" — re-answering a step overwrites
// the prior answer for that step (latest wins). The state machine never
// regresses: an answered step stays answered until the user explicitly
// re-runs the flow from Settings.
server.get('/api/onboarding/state', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const state = await getOnboardingState(profileId);
    const next = nextPendingStep(state);
    return {
      state,
      nextStep: next,
      complete: isComplete(state),
      stepOrder: ONBOARDING_STEP_ORDER,
      // The personalised prompt copy for the next step, ready to render.
      // Returning it here means the mobile screen doesn't need to import
      // the prompt module — single source of truth on the server.
      copy: next ? copyForStep(next, state) : null,
    };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load onboarding state' });
  }
});

server.post('/api/onboarding/answer', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const body = (request.body || {}) as { step?: string; answer?: string };
    const step = body.step as OnboardingStep | undefined;
    const answer = (body.answer || '').trim();

    if (!step || !ONBOARDING_STEP_ORDER.includes(step)) {
      return reply.code(400).send({ error: 'Invalid step' });
    }
    if (!answer) {
      return reply.code(400).send({ error: 'Answer is required (use /skip to skip)' });
    }
    // Preview + channels don't take a free-form answer through this path.
    // Preview = "I'm ready to be briefed" (mark answered with a sentinel).
    // Channels = OAuth happens elsewhere; mobile calls /skip or /complete.
    if (step === 'preview' || step === 'channels') {
      const updated = await recordStep(profileId, step, { status: 'answered', answer });
      return {
        state: updated,
        acknowledgement: 'Got it.',
        learnedNames: [],
        observationCount: 0,
        spacesAffected: [],
      };
    }

    const result = await processOnboardingAnswer(profileId, step, answer);

    // Persist the answer text + status. The status is 'answered' even when
    // observationCount is 0 — the user did engage; they just didn't say
    // something autolearn could structure. The acknowledgement reflects
    // that honestly via buildAcknowledgement's empty-result branch.
    const updated = await recordStep(profileId, step, { status: 'answered', answer });

    // Bust the synthesis cache so the Today tab regenerates against the
    // newly-seeded context the next time it loads.
    invalidateSynthesisCache(profileId);

    const acknowledgement = buildAcknowledgement({
      step,
      learnedNames: result.learnedNames,
      observationCount: result.observationCount,
    });

    return {
      state: updated,
      acknowledgement,
      learnedNames: result.learnedNames,
      observationCount: result.observationCount,
      spacesAffected: result.spacesAffected,
    };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to process onboarding answer' });
  }
});

server.post('/api/onboarding/skip', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const body = (request.body || {}) as { step?: string };
    const step = body.step as OnboardingStep | undefined;
    if (!step || !ONBOARDING_STEP_ORDER.includes(step)) {
      return reply.code(400).send({ error: 'Invalid step' });
    }
    const updated = await recordStep(profileId, step, { status: 'skipped' });
    return { state: updated };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to skip onboarding step' });
  }
});

server.post('/api/onboarding/complete', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const updated = await markComplete(profileId);
    invalidateSynthesisCache(profileId);
    return { state: updated };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to mark onboarding complete' });
  }
});

server.post('/api/push/test', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const tokens = await getTokensForProfile(profileId);
    if (tokens.length === 0) {
      return reply.code(409).send({
        error: 'No push tokens registered for this profile',
        hint: 'Open the app on a device with notifications enabled, then retry.',
      });
    }
    await sendPush(tokens, {
      title: 'Memu push is working',
      body: 'You’ll get your morning briefing here at 07:00.',
      data: { kind: 'push_test' },
    });
    return { success: true, attempted: tokens.length };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Test push failed' });
  }
});

// Brief preferences — per-profile customisation of the morning briefing.
// Location is geocoded server-side from a free-text place name (e.g.
// "Ivybridge") so the client doesn't need to know how to resolve lat/lon.
// Sending `placeName` triggers a geocode; sending `location` directly
// (e.g. from a phone GPS read) skips it. Sending neither leaves the
// existing location untouched.
server.get('/api/preferences/brief', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const prefs = await getBriefPreferences(profileId);
    return { preferences: prefs, availableSources: listAvailableNewsSources().map(s => ({ id: s.id, label: s.label })) };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load brief preferences' });
  }
});

// Structured news feed for the Today screen + PWA. Same source list as
// the morning briefing (per profile prefs) but returns typed NewsItem[]
// with thumbnails + links instead of the plain-string briefing format.
// `?perSourceMax=` overrides default 3 (used by the "More news" expand).
server.get('/api/news', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const query = (request.query || {}) as { perSourceMax?: string };
    const perSourceMax = query.perSourceMax
      ? Math.min(10, Math.max(1, parseInt(query.perSourceMax, 10) || 3))
      : 3;
    const prefs = await getBriefPreferences(profileId);
    const feed = await fetchNewsFeed({
      sourceIds: prefs.newsSources,
      placeName: prefs.location?.placeName,
      perSourceMax,
    });
    return feed;
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load news feed' });
  }
});

// Capture nudge — fetch the current prompt for a profile (used when the
// /capture/quick screen opens). Caller can pass ?promptId= to fetch a
// specific prompt from the catalogue (e.g. when the user tapped a push
// that carried promptId in its data payload); otherwise we pick whatever
// prompt the current slot would surface.
server.get('/api/capture/prompt', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const query = (request.query || {}) as { promptId?: string };
    const prompt = query.promptId
      ? getPromptById(query.promptId) || pickPrompt(profileId)
      : pickPrompt(profileId);
    return { prompt };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to fetch prompt' });
  }
});

// Capture answer — routes the user's response through the autolearn
// pipeline so any durable facts get extracted and written to the right
// Space. This is what closes the agency loop: a daytime push lands, the
// user answers in one tap, the answer becomes structured family memory.
server.post('/api/capture', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const body = (request.body || {}) as { promptId?: string; question?: string; answer?: string };
    const answer = (body.answer || '').trim();
    if (!answer) return reply.code(400).send({ error: 'Answer is required' });
    if (answer.length > 5000) return reply.code(413).send({ error: 'Answer too long (max 5000 chars)' });

    const promptText = body.question
      || (body.promptId ? (getPromptById(body.promptId)?.question || 'Capture') : 'Capture');

    // Feed the prompt + answer pair into autolearn. Same shape as a
    // conversation turn — autolearn will extract observations, route
    // high-confidence ones to the matching Space, and seed embedding
    // recall for everything ≥0.5. Fire-and-forget per autolearn's own
    // pattern; we don't block on the LLM call.
    extractAndStoreFacts(profileId, promptText, answer).catch(err => {
      server.log.error({ err, profileId }, '[CAPTURE] autolearn failed');
    });

    return { ok: true, acknowledgement: 'Got it.' };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to store capture' });
  }
});

server.post('/api/preferences/brief', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    if (!profileId) return reply.code(401).send({ error: 'Authentication required' });
    const body = (request.body || {}) as {
      placeName?: string;
      location?: { lat: number; lon: number; placeName: string };
      newsSources?: string[];
      topics?: string[];
      thinkingPromptEnabled?: boolean;
    };

    const patch: Parameters<typeof updateBriefPreferences>[1] = {};

    // Resolve a free-text placeName to lat/lon via Open-Meteo geocoding.
    // The client can either send `placeName` (let the server geocode) or
    // send `location` directly (e.g. from a phone GPS reading where the
    // client already has coordinates and just reverse-geocoded the label).
    if (body.location && typeof body.location.lat === 'number' && typeof body.location.lon === 'number' && typeof body.location.placeName === 'string') {
      patch.location = {
        lat: body.location.lat,
        lon: body.location.lon,
        placeName: body.location.placeName.trim(),
      };
    } else if (typeof body.placeName === 'string' && body.placeName.trim().length > 0) {
      const geocoded = await geocodePlace(body.placeName);
      if (!geocoded) {
        return reply.code(400).send({
          error: `Couldn't find "${body.placeName}". Try a different spelling or include the country.`,
        });
      }
      patch.location = {
        lat: geocoded.lat,
        lon: geocoded.lon,
        placeName: geocoded.placeName,
      };
    }

    if (Array.isArray(body.newsSources)) patch.newsSources = body.newsSources;
    if (Array.isArray(body.topics)) patch.topics = body.topics;
    if (typeof body.thinkingPromptEnabled === 'boolean') patch.thinkingPromptEnabled = body.thinkingPromptEnabled;

    const updated = await updateBriefPreferences(profileId, patch);
    return { preferences: updated };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to update brief preferences' });
  }
});

// Family Memory Endpoint
server.get('/api/memory/recent', async (request, reply) => {
  try {
    const { rows } = await db.query(
      `SELECT id, source, content, created_at FROM context_entries ORDER BY created_at DESC LIMIT 50`
    );
    return rows;
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to fetch memory' });
  }
});

// Today's Brief + Stream Cards — uses authenticated profile
//
// Phase A.9.1 — `?lens=me|family` (default `me`).
//   me      → caller's own calendar only (current behaviour, the smallest
//             individual scope; individual-first per the architectural
//             North Star).
//   family  → merged events across every profile in the caller's
//             collective that has a linked Google Calendar.
//
// Honest scope of the lens today: only calendar events swap. Stream
// cards and the shopping list are still household-scoped — they don't
// yet carry a `owner_profile_id` axis, so "lens=me" can't filter them
// without lying. The PWA + mobile provenance footer name this gap
// explicitly so the pill doesn't promise more than it delivers.
server.get('/api/dashboard/brief', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const q = (request.query as Record<string, string | undefined>) || {};
    const lens: 'me' | 'family' = q.lens === 'family' ? 'family' : 'me';

    // 1. Fetch upcoming Calendar Events (Next 7 days).
    //    lens=me     → just this profile.
    //    lens=family → every profile in the same collective with a
    //                  linked google_calendar channel. Each profile is
    //                  fetched independently so a dead OAuth refresh on
    //                  one calendar (Rach's) doesn't poison the others
    //                  (Hareesh's). fetchUpcomingEvents already returns
    //                  [] on degraded connections via
    //                  fetchUpcomingEventsDetailed.
    let calendarProfiles: string[] = [profileId];
    if (lens === 'family') {
      const peers = await db.query(
        `SELECT DISTINCT p.id
           FROM profiles p
           JOIN profile_channels pc ON pc.profile_id = p.id
          WHERE p.collective_id = (SELECT collective_id FROM profiles WHERE id = $1)
            AND pc.channel = 'google_calendar'`,
        [profileId]
      );
      if (peers.rows.length > 0) {
        calendarProfiles = peers.rows.map(r => r.id);
      }
    }

    const eventsArrays = await Promise.all(
      calendarProfiles.map(pid => fetchUpcomingEvents(pid))
    );
    const events = eventsArrays.flat();

    // Nori Dashboard pattern: Today vs Future
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    type BriefEvent = { title: string; startTime: string; endTime: string | null };
    const todayEvents: BriefEvent[] = [];
    const futureEvents: BriefEvent[] = [];

    for (const e of events) {
      const startTime = e.start?.dateTime || e.start?.date || null;
      if (!startTime) continue;

      const evt: BriefEvent = {
        title: e.summary || 'Busy',
        startTime,
        endTime: e.end?.dateTime || e.end?.date || null
      };

      if (new Date(startTime) <= todayEnd) {
        todayEvents.push(evt);
      } else {
        futureEvents.push(evt);
      }
    }

    // Sort merged family events by start so the schedule UI renders in
    // chronological order regardless of which profile they came from.
    if (lens === 'family' && calendarProfiles.length > 1) {
      const byStart = (a: BriefEvent, b: BriefEvent) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      todayEvents.sort(byStart);
      futureEvents.sort(byStart);
    }

    // Check if the calendar is linked. For lens=family this asks "does
    // anyone in the household have a calendar linked" — the empty-state
    // copy in the UI already reads as a household-level prompt, so this
    // matches user expectation.
    const linkRes = await db.query(
      `SELECT 1 FROM profile_channels
         WHERE profile_id = ANY($1::text[]) AND channel = 'google_calendar'`,
      [calendarProfiles]
    );
    const isCalendarConnected = linkRes.rows.length > 0;

    // 2. Fetch Active Stream Cards
    //    - excluded 'shopping' — separate UI (shopping pill / list view)
    //    - excluded 'briefing' — Phase A.3, briefings are messages, not feed
    //      cards. The chat surface is the canonical place for the morning
    //      brief; the Today/Dashboard view shows actionable items, not a
    //      duplicate briefing render. The card row still exists (it backs
    //      the briefing's suggested-action endpoints) but it is not
    //      surfaced here.
    const streamRes = await db.query(
      `SELECT * FROM stream_cards
        WHERE family_id = $1
          AND status = 'active'
          AND card_type NOT IN ('shopping', 'briefing')
        ORDER BY created_at DESC`,
      [profileId]
    );

    // 3. Fetch Shopping List from list_items (bug 3 — committed items live here, not stream_cards)
    const shoppingRes = await db.query(
      `SELECT id, family_id, item_text AS title, note AS body, status, source, source_message_id, created_at
         FROM list_items
        WHERE family_id = $1 AND list_type = 'shopping' AND status = 'pending'
        ORDER BY created_at ASC`,
      [profileId]
    );

    return {
      events: todayEvents, // Maintaining backward compatibility for old endpoints
      todayEvents,
      futureEvents,
      streamCards: streamRes.rows,
      shoppingItems: shoppingRes.rows,
      isCalendarConnected,
      lens,
      // How many calendars contributed events. Lets the UI honestly
      // label the schedule ("Family · 2 calendars merged") so the lens
      // doesn't look like it's doing nothing when only one profile in
      // the household has a calendar linked.
      lensCalendarCount: calendarProfiles.length,
    };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to build brief' });
  }
});

import { processGroupMessageExtraction } from './intelligence/extraction';

// Spaces (Compiled Synthesis Pages)
server.get('/api/dashboard/spaces', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    // Scope by family_id — matches /api/spaces/graph (canvas view) and the
    // rest of the spaces store. Pre-2026-05-06 this filtered by profile_id,
    // which silently returned an incomplete subset in multi-profile setups:
    // Spaces created by different household members had different
    // profile_id values but the same family_id. Symptom Hareesh saw —
    // canvas view showed every family Space, but the listing said
    // "Couldn't load Spaces". family_id is the canonical tenant scope.
    const res = await db.query(
      `SELECT * FROM synthesis_pages WHERE family_id = $1 ORDER BY last_updated_at DESC`,
      [profileId]
    );
    return { spaces: res.rows };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to fetch spaces' });
  }
});

// Spaces Canvas — graph view across the family's compiled understanding.
// Same auth as /api/dashboard/spaces (apiKey preHandler → profileId), and
// the catalogue's family_id = primary admin profile_id convention.
import { loadGraphForViewer, type GraphFacet, type GraphVisibility } from './api/spaces_graph';

server.get('/api/spaces/graph', async (request, reply) => {
  try {
    const profileId = (request as any).profileId as string;
    const q = (request.query as Record<string, string | undefined>) || {};
    const rawFacet = q.facet;
    const rawVisibility = q.visibility;
    const focusUri = (typeof q.focus === 'string' && q.focus.trim().length > 0) ? q.focus : undefined;
    const facet: GraphFacet =
      rawFacet === 'category' || rawFacet === 'domain' || rawFacet === 'person' || rawFacet === 'tag' || rawFacet === 'none'
        ? rawFacet
        : 'category';
    const visibility: GraphVisibility =
      rawVisibility === 'mine' || rawVisibility === 'shared' || rawVisibility === 'all' ? rawVisibility : 'all';
    const graph = await loadGraphForViewer(profileId, profileId, facet, visibility, { focusUri });
    return graph;
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to build spaces graph' });
  }
});

// Phase 6 of Build Spec 1 — manual connections between Spaces.
//
// POST creates a `manual` row in space_connections; DELETE removes it.
// Both endpoints validate that both URIs exist within the active
// collective (RLS scopes the SELECT; a cross-collective URI returns
// zero rows and the request is rejected with 422).
//
// The canonical ordering of the URI pair (a < b) is enforced by the
// schema's CHECK constraint — we order in the handler too so the
// resulting row matches whether the user called with (A,B) or (B,A).

function validateConnectionInput(body: unknown):
  | { ok: true; a: string; b: string }
  | { ok: false; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const uriA = b.spaceUriA;
  const uriB = b.spaceUriB;
  if (typeof uriA !== 'string' || !uriA.trim()) return { ok: false, reason: 'spaceUriA required' };
  if (typeof uriB !== 'string' || !uriB.trim()) return { ok: false, reason: 'spaceUriB required' };
  if (uriA === uriB) return { ok: false, reason: 'cannot connect a Space to itself' };
  // Canonical-order so the row matches the schema CHECK and the
  // UNIQUE constraint collapses (A,B) and (B,A) calls.
  const [a, bb] = uriA < uriB ? [uriA, uriB] : [uriB, uriA];
  return { ok: true, a, b: bb };
}

server.post('/api/spaces/connections', async (request, reply) => {
  try {
    const validated = validateConnectionInput(request.body);
    if (!validated.ok) {
      return reply.code(400).send({ error: validated.reason });
    }
    // Verify both endpoints exist in the active collective (RLS-scoped).
    const lookup = await db.query<{ uri: string }>(
      `SELECT uri FROM synthesis_pages WHERE uri = ANY($1)`,
      [[validated.a, validated.b]],
    );
    if (lookup.rows.length < 2) {
      return reply.code(422).send({
        error: 'one or both Spaces not found in this collective',
        reason: 'space_not_in_collective',
      });
    }
    await db.query(
      `INSERT INTO space_connections (space_uri_a, space_uri_b, source_mechanism, confidence)
       VALUES ($1, $2, 'manual', 1.00)
       ON CONFLICT (collective_id, space_uri_a, space_uri_b, source_mechanism)
       DO UPDATE SET last_seen_at = NOW(), status = 'active'`,
      [validated.a, validated.b],
    );
    return reply.code(201).send({ ok: true, spaceUriA: validated.a, spaceUriB: validated.b });
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to create manual connection' });
  }
});

server.delete('/api/spaces/connections', async (request, reply) => {
  try {
    const validated = validateConnectionInput(request.body);
    if (!validated.ok) {
      return reply.code(400).send({ error: validated.reason });
    }
    const result = await db.query(
      `DELETE FROM space_connections
        WHERE space_uri_a = $1 AND space_uri_b = $2 AND source_mechanism = 'manual'`,
      [validated.a, validated.b],
    );
    return reply.send({ ok: true, deleted: result.rowCount ?? 0 });
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to delete manual connection' });
  }
});

// Create a new Space manually. Routes through upsertSpace so the DB row
// + on-disk markdown + git history stay in lock-step (and so the v2
// parent_space_uri field lands cleanly via the canvas create flow).
server.post('/api/spaces', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { title, category, body_markdown, parent_space_uri } = request.body as {
      title?: string;
      category?: string;
      body_markdown?: string;
      parent_space_uri?: string | null;
    };

    const validCategories = ['person', 'routine', 'household', 'commitment', 'document'] as const;
    if (!title || !title.trim()) {
      return reply.code(400).send({ error: 'title is required' });
    }
    if (!category || !validCategories.includes(category as typeof validCategories[number])) {
      return reply.code(400).send({ error: 'category must be one of person, routine, household, commitment, document' });
    }

    // Normalise parent_space_uri: empty string → null, anything else → string.
    const parentUri =
      parent_space_uri === null || parent_space_uri === undefined ||
      (typeof parent_space_uri === 'string' && parent_space_uri.trim() === '')
        ? null
        : parent_space_uri;

    if (parentUri !== null) {
      const validation = await validateParentRelationship(profileId, parentUri);
      if (!validation.ok) {
        return reply.code(422).send({ error: validation.message ?? validation.reason, reason: validation.reason });
      }
    }

    const space = await upsertSpace({
      familyId: profileId,
      category: category as 'person' | 'routine' | 'household' | 'commitment' | 'document',
      name: title.trim(),
      bodyMarkdown: body_markdown || '',
      actorProfileId: profileId,
      parentSpaceUri: parentUri,
    });
    return { space };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to create space' });
  }
});

// Update a Space (human-edited synthesis page).
// Optional `visibility` accepts:
//   - "family" | "private" | "partners_only" | "adults_only" — scalar
//   - string[] of profile IDs — explicit allow-list (collaborative share)
server.put('/api/spaces/:id', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { id } = request.params as { id: string };
    const { title, body_markdown, visibility } = request.body as {
      title?: string;
      body_markdown?: string;
      visibility?: string | string[];
    };

    const updateBody = typeof body_markdown === 'string' && body_markdown.length > 0;
    const updateVisibility = typeof visibility !== 'undefined';
    if (!updateBody && !updateVisibility && !title) {
      return reply.code(400).send({ error: 'nothing to update — provide title, body_markdown, or visibility' });
    }

    let visibilityStored: string | null = null;
    if (updateVisibility) {
      if (Array.isArray(visibility)) {
        // Validate as profile-id allow-list. Empty array → fall back to private.
        if (visibility.some(v => typeof v !== 'string' || v.length === 0)) {
          return reply.code(400).send({ error: 'visibility array must contain profile IDs' });
        }
        visibilityStored = visibility.length === 0 ? 'private' : JSON.stringify(visibility);
      } else if (typeof visibility === 'string') {
        const allowed = new Set(['family', 'private', 'partners_only', 'adults_only']);
        if (!allowed.has(visibility)) {
          return reply.code(400).send({ error: 'visibility must be family, private, partners_only, adults_only, or an array of profile IDs' });
        }
        visibilityStored = visibility;
      } else {
        return reply.code(400).send({ error: 'visibility must be a string or array of profile IDs' });
      }
    }

    // When flipping to `private`, ensure the row's `people` array contains the
    // owner. resolveVisibility('private', [], roster) returns [] — i.e. nobody —
    // because the model expresses "private" via people[0] rather than the row's
    // owner. Without this, a private Space with empty people becomes invisible
    // to its own owner (canSee returns false), so it disappears from the canvas
    // entirely.
    const ensurePeopleSelf = visibilityStored === 'private';

    const res = await db.query(
      `UPDATE synthesis_pages
         SET title = COALESCE($1, title),
             body_markdown = COALESCE($2, body_markdown),
             visibility = COALESCE($3, visibility),
             people = CASE
               WHEN $6::boolean AND (people IS NULL OR cardinality(people) = 0)
                 THEN ARRAY[$5::text]
               ELSE people
             END,
             last_updated_at = NOW()
       WHERE id = $4 AND profile_id = $5
       RETURNING *`,
      [title || null, updateBody ? body_markdown : null, visibilityStored, id, profileId, ensurePeopleSelf]
    );

    if (res.rowCount === 0) {
      return reply.code(404).send({ error: 'Space not found' });
    }
    return { space: res.rows[0] };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to update space' });
  }
});

// Spaces Canvas v2 — sub-Spaces and manual links.
//
// Three endpoints, one Space identified by DB id (matches PUT /api/spaces/:id):
//   POST   /api/spaces/:id/parent             → set or change parent (null to un-parent)
//   POST   /api/spaces/:id/links              → append a manual wikilink to body
//   DELETE /api/spaces/:id/links/:targetSlug  → strip a manual wikilink
//
// All three go through upsertSpace so the DB row + on-disk markdown +
// git history stay in lock-step. Manual links are wikilinks in body —
// single source of truth, picked up automatically by graph derivation.

server.post('/api/spaces/:id/parent', async (request, reply) => {
  try {
    const profileId = (request as any).profileId as string;
    const { id } = request.params as { id: string };
    const body = request.body as { parentSpaceUri?: string | null };

    if (body === null || typeof body !== 'object' || !('parentSpaceUri' in body)) {
      return reply.code(400).send({ error: 'parentSpaceUri is required (pass null to un-parent)' });
    }
    const candidate =
      body.parentSpaceUri === null || (typeof body.parentSpaceUri === 'string' && body.parentSpaceUri.trim() === '')
        ? null
        : body.parentSpaceUri;
    if (candidate !== null && typeof candidate !== 'string') {
      return reply.code(400).send({ error: 'parentSpaceUri must be a string or null' });
    }

    // Resolve target Space + auth (must own the row, same family check).
    const lookup = await db.query(
      `SELECT id, uri, family_id, profile_id FROM synthesis_pages WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (lookup.rowCount === 0) return reply.code(404).send({ error: 'Space not found' });
    const row = lookup.rows[0];
    if (row.profile_id !== profileId) return reply.code(403).send({ error: 'cannot reparent a Space you do not own' });

    if (candidate !== null) {
      const validation = await validateParentRelationship(row.family_id, candidate, row.uri);
      if (!validation.ok) {
        return reply.code(422).send({ error: validation.message ?? validation.reason, reason: validation.reason });
      }
    }

    const existing = await findSpaceByUri(row.uri);
    if (!existing) return reply.code(404).send({ error: 'Space not found' });

    const space = await upsertSpace({
      familyId: existing.familyId,
      category: existing.category,
      slug: existing.slug,
      name: existing.name,
      bodyMarkdown: existing.bodyMarkdown,
      description: existing.description,
      domains: existing.domains,
      people: existing.people,
      visibility: existing.visibility,
      confidence: existing.confidence,
      sourceReferences: existing.sourceReferences,
      tags: existing.tags,
      actorProfileId: profileId,
      parentSpaceUri: candidate,
    });
    return { space };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to update parent' });
  }
});

server.post('/api/spaces/:id/links', async (request, reply) => {
  try {
    const profileId = (request as any).profileId as string;
    const { id } = request.params as { id: string };
    const body = request.body as { targetUri?: string; label?: string };

    if (!body || typeof body.targetUri !== 'string' || body.targetUri.trim() === '') {
      return reply.code(400).send({ error: 'targetUri is required' });
    }
    const label = (typeof body.label === 'string' && body.label.trim().length > 0)
      ? body.label.trim()
      : 'Related';

    const lookup = await db.query(
      `SELECT uri, family_id, profile_id FROM synthesis_pages WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (lookup.rowCount === 0) return reply.code(404).send({ error: 'Space not found' });
    const row = lookup.rows[0];
    if (row.profile_id !== profileId) return reply.code(403).send({ error: 'cannot edit a Space you do not own' });

    const target = await findSpaceByUri(body.targetUri);
    if (!target) return reply.code(404).send({ error: 'target Space not found' });
    if (target.familyId !== row.family_id) return reply.code(422).send({ error: 'cross-family link rejected' });
    if (target.uri === row.uri) return reply.code(422).send({ error: 'cannot link a Space to itself' });

    const source = await findSpaceByUri(row.uri);
    if (!source) return reply.code(404).send({ error: 'Space not found' });

    const wikilink = `[[${target.slug}]]`;
    // Idempotent — if the same wikilink already appears (with any label),
    // don't append a duplicate. Match the slug only, not the label, so
    // re-running with a different label still no-ops rather than
    // creating two links to the same target.
    if (source.bodyMarkdown.includes(wikilink)) {
      return { space: source, added: false };
    }

    const trailing = source.bodyMarkdown.endsWith('\n') ? '' : '\n';
    const newBody = `${source.bodyMarkdown}${trailing}\n${label}: ${wikilink}\n`;

    const space = await upsertSpace({
      familyId: source.familyId,
      category: source.category,
      slug: source.slug,
      name: source.name,
      bodyMarkdown: newBody,
      description: source.description,
      domains: source.domains,
      people: source.people,
      visibility: source.visibility,
      confidence: source.confidence,
      sourceReferences: source.sourceReferences,
      tags: source.tags,
      actorProfileId: profileId,
      parentSpaceUri: source.parentSpaceUri,
    });
    return { space, added: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to add link' });
  }
});

server.delete('/api/spaces/:id/links/:targetSlug', async (request, reply) => {
  try {
    const profileId = (request as any).profileId as string;
    const { id, targetSlug } = request.params as { id: string; targetSlug: string };

    if (!targetSlug || targetSlug.trim().length === 0) {
      return reply.code(400).send({ error: 'targetSlug is required' });
    }
    const slug = targetSlug.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
      return reply.code(400).send({ error: 'invalid slug format' });
    }

    const lookup = await db.query(
      `SELECT uri, family_id, profile_id FROM synthesis_pages WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (lookup.rowCount === 0) return reply.code(404).send({ error: 'Space not found' });
    const row = lookup.rows[0];
    if (row.profile_id !== profileId) return reply.code(403).send({ error: 'cannot edit a Space you do not own' });

    const source = await findSpaceByUri(row.uri);
    if (!source) return reply.code(404).send({ error: 'Space not found' });

    const wikilink = `[[${slug}]]`;
    if (!source.bodyMarkdown.includes(wikilink)) {
      // Idempotent — already absent.
      return { space: source, removed: false };
    }

    // Strip lines of the form "<label>: [[slug]]" plus any leading/trailing
    // blank-line whitespace produced by the strip. Lines that contain
    // [[slug]] alongside other prose are left intact — only "linkline-shaped"
    // matches are removed, so user-written prose mentioning the slug stays.
    const linkLineRe = new RegExp(`^[^\\n]*\\[\\[${slug}\\]\\][^\\n]*\\n?`, 'gm');
    const cleaned = source.bodyMarkdown.replace(linkLineRe, '').replace(/\n{3,}/g, '\n\n');

    const space = await upsertSpace({
      familyId: source.familyId,
      category: source.category,
      slug: source.slug,
      name: source.name,
      bodyMarkdown: cleaned,
      description: source.description,
      domains: source.domains,
      people: source.people,
      visibility: source.visibility,
      confidence: source.confidence,
      sourceReferences: source.sourceReferences,
      tags: source.tags,
      actorProfileId: profileId,
      parentSpaceUri: source.parentSpaceUri,
    });
    return { space, removed: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to remove link' });
  }
});

// List profiles in this family — for the share-Space picker so the user
// can choose who to grant edit access to. Returns id, display_name, role,
// and a flag for which one is the caller. Excludes children only when the
// caller is a child (children should not see family members they can't share with).
server.get('/api/family/profiles', async (request, reply) => {
  try {
    const callerProfileId = (request as any).profileId;
    const callerProfile = (request as any).profile;
    const isCallerChild = callerProfile?.role === 'child';
    const params: any[] = [];
    let where = '';
    if (isCallerChild) {
      where = 'WHERE role != $1';
      params.push('child');
    }
    const res = await db.query(
      `SELECT id, display_name, email, role FROM profiles ${where} ORDER BY
          CASE role WHEN 'admin' THEN 1 WHEN 'adult' THEN 2 WHEN 'child' THEN 3 ELSE 4 END,
          display_name`,
      params,
    );
    const profiles = res.rows.map(r => ({
      id: r.id,
      display_name: r.display_name,
      email: r.email,
      role: r.role,
      is_self: r.id === callerProfileId,
    }));
    return { profiles };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to list profiles' });
  }
});

// Invite a new collective member. Creates a fresh profile + persona +
// entity_registry row, returns the API key + a one-tap magic link the
// admin can send to the invitee via WhatsApp / SMS / etc. Adult and
// admin profiles can invite; children cannot.
//
// Magic link shape:
//   <publicBase>/?serverUrl=<encoded>&apiKey=<key>
// The PWA index.html picks up the query params on load, writes them to
// localStorage, and redirects to the dashboard. One tap from invite to
// signed-in.
//
// Security note: the API key is in the URL. URLs leak (browser history,
// screenshots, accidentally-shared links). Acceptable for in-collective
// invites where the admin is sending to a trusted person via a private
// channel. For broader distribution we'd want a one-shot bearer-exchange
// token; deferred until needed.
server.post('/api/profiles', async (request, reply) => {
  try {
    const callerProfile = (request as any).profile;
    if (!callerProfile) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }
    if (callerProfile.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot invite household members' });
    }

    const body = request.body as {
      display_name?: string;
      email?: string;
      role?: string;
    };
    if (!body?.display_name || typeof body.display_name !== 'string' || !body.display_name.trim()) {
      return reply.code(400).send({ error: 'display_name is required' });
    }
    const role = (body.role ?? 'adult').trim();
    if (!['adult', 'child'].includes(role)) {
      return reply.code(400).send({ error: "role must be 'adult' or 'child'" });
    }
    const email = (body.email ?? '').trim();

    // Reject if a profile with this email already exists — avoid silent
    // duplicates which would split the collective's data view.
    if (email) {
      const dup = await db.query('SELECT id FROM profiles WHERE email = $1 LIMIT 1', [email]);
      if (dup.rowCount && dup.rowCount > 0) {
        return reply.code(409).send({
          error: `A profile with email ${email} already exists`,
          reason: 'email_exists',
        });
      }
    }

    const created = await registerProfile(
      body.display_name.trim(),
      email,
      role,
      '',
      { allowExisting: false },
    );

    // Build the magic link from the request's own host. PUBLIC_BASE_URL
    // overrides if set (Tailscale / hosted Tier-1 shape).
    const proto = (request.headers['x-forwarded-proto'] as string) || request.protocol || 'https';
    const host = request.headers.host || 'localhost';
    const inferredBase = `${proto}://${host}`;
    const publicBase = process.env.PUBLIC_BASE_URL || inferredBase;
    const magicLink = `${publicBase}/?serverUrl=${encodeURIComponent(publicBase)}&apiKey=${encodeURIComponent(created.api_key)}`;

    return {
      id: created.id,
      displayName: created.display_name,
      email: created.email,
      role: created.role,
      apiKey: created.api_key,
      magicLink,
    };
  } catch (err) {
    server.log.error({ err }, 'Failed to invite household member');
    return reply.code(500).send({ error: 'Failed to invite household member' });
  }
});

// Story 3.1 — on-demand tarball of the family's spaces directory
// (including .git history). Adults only.
server.get('/api/spaces/snapshot', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot trigger spaces snapshots' });
    }
    const profileId = (request as any).profileId;
    const { snapshotFamilyRepo } = await import('./spaces/maintenance');
    const { tarPath, bytes } = await snapshotFamilyRepo(profileId);

    const fs = await import('fs');
    const path = await import('path');
    const filename = path.basename(tarPath);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', String(bytes));
    reply.type('application/gzip');
    const stream = fs.createReadStream(tarPath);
    stream.on('close', () => {
      fs.unlink(tarPath, () => { /* best-effort cleanup */ });
    });
    return reply.send(stream);
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to snapshot spaces' });
  }
});

// Delete a Space
server.delete('/api/spaces/:id', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { id } = request.params as { id: string };
    const res = await db.query(
      `DELETE FROM synthesis_pages WHERE id = $1 AND profile_id = $2 RETURNING id`,
      [id, profileId]
    );
    if (res.rowCount === 0) {
      return reply.code(404).send({ error: 'Space not found' });
    }
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to delete space' });
  }
});

// Explicit extraction command (e.g. from Lists tab)
server.post('/api/extract', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { content } = request.body as any;
    
    // Process purely as extraction (fire and forget)
    // Pass 'manual_list_input' as the channel so we know where it came from
    processGroupMessageExtraction(profileId, content, 'manual_list_input', `req-${Date.now()}`).catch(err => {
      console.error('[EXTRACTION] Direct list extraction failed:', err);
    });

    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Extraction trigger failed' });
  }
});

// PWA: Resolve Stream Card.
// Tenant-scoped 2026-05-06: pre-fix, profile A could resolve any card by id
// regardless of which family owned it (the original handler had no
// family_id filter on the UPDATE). All four stream-card mutators below
// (resolve, dismiss, edit, calendar/add SELECT path) carried the same hole.
server.post('/api/stream/resolve', async (request, reply) => {
  const { cardId } = request.body as any;
  if (!cardId) return reply.code(400).send({ error: 'cardId required' });
  const profileId = (request as any).profileId;

  try {
    const { rowCount } = await db.query(
      "UPDATE stream_cards SET status = 'resolved', resolved_at = NOW() WHERE id = $1 AND family_id = $2",
      [cardId, profileId],
    );
    if (rowCount === 0) return reply.code(404).send({ error: 'Card not found' });
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// Dismiss Stream Card (human says "not relevant")
server.post('/api/stream/dismiss', async (request, reply) => {
  const { cardId } = request.body as any;
  if (!cardId) return reply.code(400).send({ error: 'cardId required' });
  const profileId = (request as any).profileId;

  try {
    const { rowCount } = await db.query(
      "UPDATE stream_cards SET status = 'dismissed', resolved_at = NOW() WHERE id = $1 AND family_id = $2",
      [cardId, profileId],
    );
    if (rowCount === 0) return reply.code(404).send({ error: 'Card not found' });
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// Edit Stream Card (human-in-the-middle: fix wrong info before confirming)
server.post('/api/stream/edit', async (request, reply) => {
  const { cardId, title, body } = request.body as any;
  if (!cardId) return reply.code(400).send({ error: 'cardId required' });
  const profileId = (request as any).profileId;

  try {
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (body !== undefined) {
      updates.push(`body = $${idx++}`);
      values.push(body);
    }

    if (updates.length === 0) return reply.code(400).send({ error: 'Nothing to update' });

    values.push(cardId);
    const cardIdParam = idx;
    idx += 1;
    values.push(profileId);
    const familyParam = idx;

    const upd = await db.query(
      `UPDATE stream_cards SET ${updates.join(', ')} WHERE id = $${cardIdParam} AND family_id = $${familyParam}`,
      values,
    );
    if (upd.rowCount === 0) return reply.code(404).send({ error: 'Card not found' });

    // Return the updated card — also tenant-filtered to defend against the
    // (impossible-after-the-UPDATE-check-but-cheap-to-keep) scenario where
    // someone races a delete + recreate-with-same-id between statements.
    const res = await db.query(
      "SELECT * FROM stream_cards WHERE id = $1 AND family_id = $2",
      [cardId, profileId],
    );
    return { success: true, card: res.rows[0] };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// PWA: Move Card to Shopping List — copies proposal into list_items, resolves the card.
server.post('/api/stream/to-shopping', async (request, reply) => {
  const { cardId } = request.body as any;
  if (!cardId) return reply.code(400).send({ error: 'cardId required' });

  try {
    const profileId = (request as any).profileId;
    const cardRes = await db.query(
      `SELECT * FROM stream_cards WHERE id = $1 AND family_id = $2`,
      [cardId, profileId]
    );
    if (cardRes.rows.length === 0) return reply.code(404).send({ error: 'Card not found' });
    const card = cardRes.rows[0];

    const item = await addListItem({
      familyId: profileId,
      listType: 'shopping',
      itemText: card.title,
      note: card.body || null,
      source: card.source || 'extraction',
      sourceMessageId: card.source_message_id || null,
      sourceStreamCardId: card.id,
      createdBy: profileId,
    });

    await db.query(
      `UPDATE stream_cards SET status = 'resolved', resolved_at = NOW() WHERE id = $1 AND family_id = $2`,
      [cardId, profileId],
    );

    return { success: true, item };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// Briefing-action endpoints — execute the structured payload that the briefing
// skill drafted and we persisted on stream_cards.actions[]. Each handler takes
// {cardId, actionIndex}, looks up the persisted action, runs the matching
// executor against the action's payload (already in real names — translation
// happened at briefing-persist time via deepTranslateToReal), then resolves the
// card. The kind discriminator on the action validates it matches the route.
type LoadActionResult =
  | { kind: 'error'; error: string; status: number }
  | { kind: 'ok'; card: any; action: any };

async function loadBriefingAction(cardId: string, actionIndex: number, profileId: string): Promise<LoadActionResult> {
  const res = await db.query(
    `SELECT id, family_id, actions FROM stream_cards WHERE id = $1`,
    [cardId],
  );
  if (res.rows.length === 0) return { kind: 'error', error: 'Card not found', status: 404 };
  const card = res.rows[0];
  if (card.family_id !== profileId) return { kind: 'error', error: 'Card belongs to a different family', status: 403 };
  const actions = Array.isArray(card.actions) ? card.actions : [];
  const action = actions[actionIndex];
  if (!action) return { kind: 'error', error: 'Action not found at index', status: 404 };
  return { kind: 'ok', card, action };
}

async function resolveCard(cardId: string, familyId: string) {
  await db.query(
    `UPDATE stream_cards SET status = 'resolved', resolved_at = NOW() WHERE id = $1 AND family_id = $2`,
    [cardId, familyId],
  );
}

server.post('/api/stream/action/add-to-list', async (request, reply) => {
  const { cardId, actionIndex } = request.body as { cardId?: string; actionIndex?: number };
  if (!cardId || typeof actionIndex !== 'number') {
    return reply.code(400).send({ error: 'cardId and actionIndex required' });
  }
  const profileId = (request as any).profileId;
  const loaded = await loadBriefingAction(cardId, actionIndex, profileId);
  if (loaded.kind === 'error') return reply.code(loaded.status).send({ error: loaded.error });

  const { action } = loaded;
  if (action.kind !== 'add_to_list') {
    return reply.code(400).send({ error: `action kind is ${action.kind}, not add_to_list` });
  }
  const payload = action.payload || {};
  if (payload.list !== 'shopping' && payload.list !== 'task') {
    return reply.code(400).send({ error: 'payload.list must be "shopping" or "task"' });
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return reply.code(400).send({ error: 'payload.items must be a non-empty array' });
  }

  try {
    const inserted: string[] = [];
    for (const item of payload.items) {
      if (typeof item !== 'string' || item.trim().length === 0) continue;
      const row = await addListItem({
        familyId: profileId,
        listType: payload.list as ListType,
        itemText: item.trim(),
        source: `briefing-action:${cardId}`,
        sourceStreamCardId: cardId,
        createdBy: profileId,
      });
      inserted.push(row.id);
    }
    await resolveCard(cardId, profileId);
    return { success: true, added: inserted.length };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'add-to-list failed' });
  }
});

server.post('/api/stream/action/add-calendar-event', async (request, reply) => {
  const { cardId, actionIndex } = request.body as { cardId?: string; actionIndex?: number };
  if (!cardId || typeof actionIndex !== 'number') {
    return reply.code(400).send({ error: 'cardId and actionIndex required' });
  }
  const profileId = (request as any).profileId;
  const loaded = await loadBriefingAction(cardId, actionIndex, profileId);
  if (loaded.kind === 'error') return reply.code(loaded.status).send({ error: loaded.error });

  const { action } = loaded;
  if (action.kind !== 'add_calendar_event') {
    return reply.code(400).send({ error: `action kind is ${action.kind}, not add_calendar_event` });
  }
  const payload = action.payload || {};
  if (typeof payload.title !== 'string' || typeof payload.start_iso !== 'string' || typeof payload.end_iso !== 'string') {
    return reply.code(400).send({ error: 'payload requires title, start_iso, end_iso' });
  }

  try {
    const result = await insertCalendarEvent(profileId, {
      summary: payload.title,
      startISO: payload.start_iso,
      endISO: payload.end_iso,
      location: payload.location,
      description: payload.notes,
    });
    if (!result.ok) {
      return reply.code(400).send({ error: result.message, reason: result.reason });
    }
    await resolveCard(cardId, profileId);
    return { success: true, eventId: result.eventId, htmlLink: result.htmlLink };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'add-calendar-event failed' });
  }
});

server.post('/api/stream/action/update-space', async (request, reply) => {
  const { cardId, actionIndex } = request.body as { cardId?: string; actionIndex?: number };
  if (!cardId || typeof actionIndex !== 'number') {
    return reply.code(400).send({ error: 'cardId and actionIndex required' });
  }
  const profileId = (request as any).profileId;
  const loaded = await loadBriefingAction(cardId, actionIndex, profileId);
  if (loaded.kind === 'error') return reply.code(loaded.status).send({ error: loaded.error });

  const { action } = loaded;
  if (action.kind !== 'update_space') {
    return reply.code(400).send({ error: `action kind is ${action.kind}, not update_space` });
  }
  const payload = action.payload || {};
  if (typeof payload.slug !== 'string' || typeof payload.category !== 'string' || typeof payload.body_markdown !== 'string') {
    return reply.code(400).send({ error: 'payload requires slug, category, body_markdown' });
  }
  if (!SPACE_CATEGORIES.includes(payload.category as SpaceCategory)) {
    return reply.code(400).send({ error: `category must be one of: ${SPACE_CATEGORIES.join(', ')}` });
  }

  try {
    const existing = await findSpaceBySlug(profileId, payload.category as SpaceCategory, payload.slug);
    // The briefing skill suggests "fill in weekly rhythm" / "fill in current focus"
    // for Spaces that the user hasn't seeded yet — slug + category come from the
    // onboarding catalogue. Pre-2026-05-13 this 404'd because findSpaceBySlug
    // didn't find a row, leaving the user stuck on a CTA they couldn't act on.
    // Create-on-missing instead: use the suggested body_markdown verbatim and
    // synthesise the metadata that upsertSpace needs.
    const space = existing
      ? await upsertSpace({
          familyId: existing.familyId,
          category: existing.category,
          slug: existing.slug,
          name: existing.name,
          bodyMarkdown: payload.body_markdown,
          description: existing.description,
          domains: existing.domains,
          people: existing.people,
          visibility: existing.visibility,
          confidence: Math.min(1, existing.confidence + 0.05),
          sourceReferences: [...existing.sourceReferences, `briefing-action:${cardId}`],
          tags: existing.tags,
          actorProfileId: profileId,
        })
      : await upsertSpace({
          familyId: profileId,
          category: payload.category as SpaceCategory,
          slug: payload.slug,
          name: humaniseSlug(payload.slug),
          bodyMarkdown: payload.body_markdown,
          description: '',
          visibility: 'family',
          confidence: 0.6,
          sourceReferences: [`briefing-action:${cardId}`],
          tags: ['briefing'],
          actorProfileId: profileId,
        });
    await resolveCard(cardId, profileId);
    return { success: true, uri: space.uri, created: !existing };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'update-space failed' });
  }
});

function humaniseSlug(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || 'Untitled Space';
}

// reply_draft is a no-op endpoint — the user clicked Copy in the inline preview
// and the draft was copied to their clipboard client-side. We resolve the card
// so the action doesn't keep nagging, and log it for the privacy ledger.
server.post('/api/stream/action/reply-draft', async (request, reply) => {
  const { cardId, actionIndex } = request.body as { cardId?: string; actionIndex?: number };
  if (!cardId || typeof actionIndex !== 'number') {
    return reply.code(400).send({ error: 'cardId and actionIndex required' });
  }
  const profileId = (request as any).profileId;
  const loaded = await loadBriefingAction(cardId, actionIndex, profileId);
  if (loaded.kind === 'error') return reply.code(loaded.status).send({ error: loaded.error });

  if (loaded.action.kind !== 'reply_draft') {
    return reply.code(400).send({ error: `action kind is ${loaded.action.kind}, not reply_draft` });
  }
  await resolveCard(cardId, profileId);
  console.log(`[BRIEFING ACTION] reply_draft acked for card=${cardId} index=${actionIndex}`);
  return { success: true };
});

// Lists API — unified shopping / task / custom list items (bug 3).
server.get('/api/lists', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { list_type, status, limit } = request.query as {
      list_type?: string;
      status?: string;
      limit?: string;
    };
    const parsedLimit = limit ? Math.min(500, Math.max(1, parseInt(limit, 10) || 200)) : 200;
    const items = await listListItems({
      familyId: profileId,
      listType: list_type as ListType | undefined,
      status: status as ListStatus | undefined,
      limit: parsedLimit,
    });

    // Diagnostic logging
    server.log.info({ profileId, list_type, status, count: items.length }, 'List API requested');

    return { items };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to fetch lists' });
  }
});

server.post('/api/lists', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { list_type, item_text, note, list_name, source, due_at } = request.body as {
      list_type?: string;
      item_text?: string;
      note?: string | null;
      list_name?: string | null;
      source?: string | null;
      due_at?: string | null;
    };
    if (!list_type || !['shopping', 'task', 'custom'].includes(list_type)) {
      return reply.code(400).send({ error: 'list_type must be shopping, task, or custom' });
    }
    if (!item_text || !item_text.trim()) {
      return reply.code(400).send({ error: 'item_text required' });
    }
    // Validate due_at if supplied — must be a parseable ISO string, otherwise
    // the DB layer will throw a less-helpful error and the client sees 500.
    if (due_at != null && due_at !== '' && Number.isNaN(new Date(due_at).getTime())) {
      return reply.code(400).send({ error: 'due_at must be an ISO date string or null' });
    }
    const item = await addListItem({
      familyId: profileId,
      listType: list_type as ListType,
      itemText: item_text.trim(),
      note: note ?? null,
      listName: list_name ?? null,
      source: source ?? 'manual',
      createdBy: profileId,
      dueAt: due_at && due_at !== '' ? due_at : null,
    });
    return { success: true, item };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to add item' });
  }
});

server.post('/api/lists/:id/complete', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { id } = request.params as { id: string };
    const item = await completeListItem(id, profileId);
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    return { success: true, item };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

server.post('/api/lists/:id/reopen', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { id } = request.params as { id: string };
    const item = await reopenListItem(id, profileId);
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    return { success: true, item };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

server.patch('/api/lists/:id', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { id } = request.params as { id: string };
    const { item_text, note, list_name, due_at } = request.body as {
      item_text?: string;
      note?: string | null;
      list_name?: string | null;
      due_at?: string | null;
    };
    if (due_at != null && due_at !== '' && Number.isNaN(new Date(due_at).getTime())) {
      return reply.code(400).send({ error: 'due_at must be an ISO date string or null' });
    }
    const item = await updateListItem(id, profileId, {
      itemText: item_text,
      note,
      listName: list_name,
      dueAt: due_at === '' ? null : due_at,
    });
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    return { success: true, item };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

server.delete('/api/lists/:id', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { id } = request.params as { id: string };
    const ok = await deleteListItem(id, profileId);
    if (!ok) return reply.code(404).send({ error: 'Item not found' });
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// PWA: Add Event to Calendar (Slice 4 Agentic Action)
// Tenant-scoped 2026-05-06: pre-fix, the SELECT on stream_cards filtered
// only by id, so profile A could read profile B's card body (real names)
// and trigger a Google Calendar write on it.
server.post('/api/calendar/add', async (request, reply) => {
  const { cardId } = request.body as any;
  if (!cardId) return reply.code(400).send({ error: 'cardId required' });

  try {
    const profileId = (request as any).profileId;
    const cardRes = await db.query(
      "SELECT * FROM stream_cards WHERE id = $1 AND family_id = $2",
      [cardId, profileId],
    );
    if (cardRes.rows.length === 0) return reply.code(404).send({ error: 'Card not found' });

    const card = cardRes.rows[0];

    // Attempt to write event to connected Google Calendar
    const success = await createGoogleCalendarEvent(profileId, card.title, card.body);

    if (success) {
       // Mark card as handled — also tenant-scoped on the resolve.
       await db.query(
         "UPDATE stream_cards SET status = 'resolved', resolved_at = NOW() WHERE id = $1 AND family_id = $2",
         [cardId, profileId],
       );
       return { success: true };
    } else {
       return reply.code(500).send({ error: 'Google Calendar sync failed. Check OAuth credentials.' });
    }
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// Chat conversations — list past threads for the side panel (Claude/Gemini
// pattern). Each row is a conversation with a derived title, last activity,
// and message count. The mobile + PWA chat surfaces show this in a left
// drawer; tap a row to load that thread, "New chat" to start fresh.
server.get('/api/chat/conversations', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const query = request.query as any;
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);

    const res = await db.query(
      `SELECT
         c.id,
         c.started_at,
         (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.content_original IS NOT NULL) AS message_count,
         (SELECT m.content_original FROM messages m
            WHERE m.conversation_id = c.id AND m.content_original IS NOT NULL
            ORDER BY m.created_at ASC LIMIT 1) AS first_user_message
       FROM conversations c
       WHERE c.profile_id = $1
       ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.started_at) DESC
       LIMIT $2`,
      [profileId, limit]
    );

    const conversations = res.rows
      .filter((row: any) => Number(row.message_count) > 0)
      .map((row: any) => {
        const firstMsg = row.first_user_message || '';
        const trimmed = firstMsg.trim().replace(/\s+/g, ' ');
        const title = trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed || null;
        return {
          id: row.id,
          startedAt: row.started_at,
          lastMessageAt: row.last_message_at,
          messageCount: Number(row.message_count),
          title,
          preview: trimmed || null,
        };
      });

    return { conversations };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load conversations' });
  }
});

// Chat history for a single conversation thread. Pass `conversationId` to
// load that thread; omit it and the endpoint returns the most-recent thread
// (used by the PWA's existing on-tab-open load and by older mobile builds).
// Each Memu turn is augmented with `spaces[]` — substring matches against
// the family's existing Spaces, surfaced inline as Claude-style artefacts.
server.get('/api/chat/history', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const query = request.query as any;
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    const requestedConvId: string | undefined = query.conversationId;

    let convId: string | null = null;
    if (requestedConvId) {
      const ownership = await db.query(
        'SELECT id FROM conversations WHERE id = $1 AND profile_id = $2',
        [requestedConvId, profileId]
      );
      if (ownership.rows.length === 0) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }
      convId = requestedConvId;
    } else {
      const latest = await db.query(
        'SELECT id FROM conversations WHERE profile_id = $1 ORDER BY started_at DESC LIMIT 1',
        [profileId]
      );
      if (latest.rows.length === 0) return { messages: [], conversationId: null };
      convId = latest.rows[0].id;
    }

    // Two row shapes are returned now:
    //   1. User+assistant turns (content_original AND content_response_translated)
    //   2. Server-generated assistant-only messages (briefing) — content_original
    //      IS NULL, content_response_translated IS NOT NULL, metadata.type='briefing'.
    // We accept either as long as content_response_translated exists; client-side
    // shape depends on whether userMessage is non-empty.
    // Phase A.5 follow-up — JOIN stream_cards so the renderer can show a
    // type label ("SHOPPING", "REMINDER", "TASK") on nudge bubbles. Card
    // type is the source of truth on stream_cards; the message's metadata
    // doesn't carry it because the producer (postCardAsMessage) stored
    // title/body/actions there and not type. LEFT JOIN so chat turns
    // without a linked card (the normal case) still return.
    const msgRes = await db.query(
      `SELECT m.id, m.conversation_id, m.content_original, m.content_response_translated,
              m.channel, m.created_at, m.actions_executed, m.metadata, m.retrieval_state,
              m.retrieved_space_uris, m.stream_card_id,
              sc.card_type AS stream_card_type,
              sc.status AS stream_card_status
       FROM messages m
       LEFT JOIN stream_cards sc ON sc.id = m.stream_card_id
       WHERE m.conversation_id = $1
         AND m.content_response_translated IS NOT NULL
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [convId, limit]
    );

    const ordered = msgRes.rows.reverse();

    // Resolve Space artefacts per message. Two paths:
    //   1. PRECISE — actions_executed contains tool-call provenance
    //      (createSpace / updateSpace / findSpaces). Each returns Space
    //      URIs/IDs in its output; resolve those to {id, name, slug,
    //      category} via synthesis_pages. This is what new messages
    //      (post-2026-05-06) carry.
    //   2. FALLBACK — for older messages where actions_executed is NULL,
    //      substring-match Memu's response against existing Space titles.
    //      Word-boundary regex; min 3 chars to avoid noise. Lossy but
    //      avoids leaving the artefact column blank for historical chats.
    const spacesRes = await db.query(
      `SELECT id, uri, title AS name, slug, category
       FROM synthesis_pages
       WHERE family_id = $1`,
      [profileId]
    );
    const allSpaces: Array<{ id: string; uri: string; name: string; slug: string; category: string }> = spacesRes.rows;
    const byUri = new Map(allSpaces.map(sp => [sp.uri, sp]));
    const byId = new Map(allSpaces.map(sp => [sp.id, sp]));
    const matchableByName = allSpaces
      .filter(sp => sp.name && sp.name.trim().length >= 3)
      .map(sp => ({
        ...sp,
        pattern: new RegExp(`\\b${sp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
      }));

    const extractSpaceRefsFromActions = (actions: any[]): Array<{ id: string; name: string; slug: string; category: string }> => {
      if (!Array.isArray(actions)) return [];
      const out: Array<{ id: string; name: string; slug: string; category: string }> = [];
      const seen = new Set<string>();
      for (const action of actions) {
        if (!action || action.ok === false) continue;
        const name = action.name as string;
        const output = action.output || {};

        if (name === 'createSpace' || name === 'updateSpace') {
          const uri = output.uri as string | undefined;
          const id = output.id as string | undefined;
          const sp = (uri && byUri.get(uri)) || (id && byId.get(id));
          if (sp && !seen.has(sp.id)) {
            out.push({ id: sp.id, name: sp.name, slug: sp.slug, category: sp.category });
            seen.add(sp.id);
          }
        } else if (name === 'findSpaces') {
          const list = (output.spaces as Array<{ uri?: string; id?: string }>) || [];
          for (const entry of list) {
            const sp = (entry.uri && byUri.get(entry.uri)) || (entry.id && byId.get(entry.id));
            if (sp && !seen.has(sp.id)) {
              out.push({ id: sp.id, name: sp.name, slug: sp.slug, category: sp.category });
              seen.add(sp.id);
            }
          }
        }
      }
      return out;
    };

    // Resolve a URI list (from retrieved_space_uris) to Space refs, deduped
    // against an already-resolved set so retrieval-touched chips don't double
    // up with tool-touched ones.
    const resolveUrisToSpaceRefs = (uris: unknown, alreadySeen: Set<string>): Array<{ id: string; name: string; slug: string; category: string }> => {
      if (!Array.isArray(uris)) return [];
      const out: Array<{ id: string; name: string; slug: string; category: string }> = [];
      for (const uri of uris) {
        if (typeof uri !== 'string') continue;
        const sp = byUri.get(uri);
        if (sp && !alreadySeen.has(sp.id)) {
          out.push({ id: sp.id, name: sp.name, slug: sp.slug, category: sp.category });
          alreadySeen.add(sp.id);
        }
      }
      return out;
    };

    const messages = ordered.map((row: any) => {
      const text = row.content_response_translated || '';
      let spaces: Array<{ id: string; name: string; slug: string; category: string }> = [];

      const actions = row.actions_executed;
      const retrievedUris = row.retrieved_space_uris;
      const haveStructured = (Array.isArray(actions) && actions.length > 0) ||
        (Array.isArray(retrievedUris) && retrievedUris.length > 0);

      if (haveStructured) {
        // PRECISE path — union of tool-touched (createSpace/updateSpace/
        // findSpaces) AND retrieval-touched Spaces. Tool-touched go first
        // because they represent active intent ("Memu wrote to this");
        // retrieval-touched fill remaining slots ("Memu read this to answer").
        // Deduped on Space id so a Space that's both tool-touched and
        // retrieval-touched only shows once.
        const seenIds = new Set<string>();
        const toolRefs = extractSpaceRefsFromActions(actions || []);
        for (const r of toolRefs) seenIds.add(r.id);
        const retrievedRefs = resolveUrisToSpaceRefs(retrievedUris, seenIds);
        spaces = [...toolRefs, ...retrievedRefs];
      } else {
        // FALLBACK for legacy messages where neither column was populated.
        // Substring-match the response against existing Space titles.
        const seen = new Set<string>();
        for (const sp of matchableByName) {
          if (sp.pattern.test(text) && !seen.has(sp.id)) {
            spaces.push({ id: sp.id, name: sp.name, slug: sp.slug, category: sp.category });
            seen.add(sp.id);
          }
        }
      }

      const metadata = row.metadata || null;
      return {
        id: row.id,
        conversationId: row.conversation_id,
        userMessage: row.content_original,            // NULL for briefing-only messages
        memuResponse: row.content_response_translated,
        channel: row.channel,
        timestamp: row.created_at,
        spaces: spaces.slice(0, 5),
        // Canvas timeline (Phase A.1): renderer dispatches on `type`.
        // 'briefing' renders with the elevated AI-Insight bubble (existing);
        // 'action_nudge' renders the inline action UI (A.5); plain text
        // falls through to a normal bubble.
        type: metadata?.type ?? null,
        // Card linkage: present on action_nudge messages, lets the renderer
        // resolve actions on tap. The full action list rides on
        // metadata.cardActions / cardTitle / cardBody to avoid an extra
        // join here — postCardAsMessage stores them denormalised on purpose.
        streamCardId: row.stream_card_id ?? null,
        cardTitle: metadata?.cardTitle ?? null,
        cardBody: metadata?.cardBody ?? null,
        cardActions: Array.isArray(metadata?.cardActions) ? metadata.cardActions : null,
        // From the LEFT JOIN — type tag the renderer turns into the eyebrow
        // label (e.g. "SHOPPING", "REMINDER", "TASK"). Null when this row
        // isn't linked to a stream_card (normal chat turns).
        cardType: row.stream_card_type ?? null,
        cardStatus: row.stream_card_status ?? null,
        retrievalState: row.retrieval_state ?? null,  // 'sourced'|'fallback'|'empty'|null; null = legacy
        // BUG-16 — when the pipeline failed mid-flight, the row carries
        // metadata.error=true and content_response_translated holds an
        // italic placeholder. The renderer styles this distinctly so the
        // user knows it was an attempted turn, not a real Memu reply.
        error: metadata?.error === true,
      };
    });

    return { messages, conversationId: convId };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load chat history' });
  }
});

// PRIVACY LEDGER: Show what Claude saw — filtered to authenticated profile
server.get('/api/ledger', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const res = await db.query(
      `SELECT id, content_original, content_translated, content_response_raw,
              content_response_translated, entity_translations, channel,
              cloud_tokens_in, cloud_tokens_out, created_at
       FROM messages
       WHERE content_translated IS NOT NULL AND profile_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [profileId]
    );
    return res.rows;
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load ledger' });
  }
});

// ADMIN: Manually Trigger Morning Briefing
server.get('/api/admin/trigger-briefing', async (request, reply) => {
  try {
    let profileId = (request as any).profileId;
    if (!profileId) {
       const res = await db.query('SELECT id FROM profiles LIMIT 1');
       if (res.rows.length === 0) {
          return reply.code(400).send({ error: 'No profiles exist to run briefing for' });
       }
       profileId = res.rows[0].id;
    }
    const message = await generateBriefingText(profileId);
    return { success: true, messagePushed: message };
  } catch (err: any) {
    server.log.error(err);
    return reply.code(500).send({ error: err.message || 'Failed' });
  }
});

// On-demand briefing for the caller. The 07:00 cron is the default cadence;
// this endpoint is what the mobile "Run briefing now" button hits when the
// user wants to absorb a fresh batch of WhatsApp inbox or recompose mid-day.
// Adults only — children's profiles do not get briefings.
server.post('/api/briefing/run-now', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    const profileId = (request as any).profileId;
    if (!profileId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children do not receive briefings' });
    }
    const { channel } = (request.body ?? {}) as { channel?: 'app' | 'push' };
    if (channel === 'push') {
      const briefing = await pushMorningBriefingToMobile(profileId);
      return { success: true, briefing, channel: 'push' };
    }
    const briefing = await generateBriefingText(profileId);
    return { success: true, briefing, channel: 'app' };
  } catch (err: any) {
    server.log.error(err);
    return reply.code(500).send({ error: err.message || 'Failed to run briefing' });
  }
});

// ==========================================
// SLICE 6: TRUST ARCHITECTURE
// ==========================================

// DATA SOVEREIGNTY: Story 3.2 — full Article 20 family export (ZIP).
// Bundles data.json + README.md + spaces/ + attachments/ and records the
// SHA-256 hash to export_log so the family can later prove what they took.
// Adults only — the archive contains adults_only and partners_only material.
server.get('/api/export', async (request, reply) => {
  try {
    const profile = (request as any).profile;
    if (profile?.role === 'child') {
      return reply.code(403).send({ error: 'Children cannot trigger exports' });
    }
    const profileId = (request as any).profileId;
    const profileRes = await db.query("SELECT id FROM profiles WHERE id = $1", [profileId]);
    if (profileRes.rows.length === 0) return reply.code(404).send({ error: 'No profile found' });

    const { buildArticle20Export } = await import('./export/article20');
    const archive = await buildArticle20Export(profileId, profileId);

    const fs = await import('fs');
    const path = await import('path');
    const filename = path.basename(archive.zipPath);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', String(archive.bytes));
    reply.header('X-Export-Hash', archive.dataHash);
    reply.type('application/zip');
    const stream = fs.createReadStream(archive.zipPath);
    stream.on('close', () => {
      fs.unlink(archive.zipPath, () => { /* best-effort cleanup */ });
    });
    return reply.send(stream);
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to export data' });
  }
});

// Profile — update display name
server.patch('/api/profile', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { displayName } = (request.body as { displayName?: string }) || {};
    if (!displayName || !displayName.trim()) {
      return reply.code(400).send({ error: 'displayName required' });
    }
    const trimmed = displayName.trim().slice(0, 80);
    const res = await db.query(
      "UPDATE profiles SET display_name = $1 WHERE id = $2 RETURNING id, display_name, role",
      [trimmed, profileId]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Profile not found' });
    return { success: true, profile: res.rows[0] };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to update profile' });
  }
});

// Chat — clear conversation history for this profile
server.post('/api/chat/clear', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    await db.query("DELETE FROM messages WHERE profile_id = $1", [profileId]);
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to clear chat' });
  }
});

// DATA SOVEREIGNTY: Divorce / Household Detachment
server.post('/api/family/detach', async (request, reply) => {
  try {
    const primaryId = (request as any).profileId;

    // 1. Physically sever the secondary adult into their own parallel household namespace
    const newAdult = await db.query("INSERT INTO profiles (display_name, role) VALUES ('Detached Adult', 'adult') RETURNING id");
    const detachedId = newAdult.rows[0].id;

    // 2. Safely clone the child personas so BOTH parents independently retain the AI's child context going forward
    const childPersonas = await db.query("SELECT * FROM personas WHERE persona_label LIKE 'Child-%'");
    for (const child of childPersonas.rows) {
       await db.query("INSERT INTO personas (id, profile_id, persona_label, attributes) VALUES ($1, $2, $3, $4)",
         [`child-${Date.now()}-${Math.random().toString(36).substring(7)}`, detachedId, child.persona_label, child.attributes]
       );
    }

    return { 
       success: true, 
       message: 'Household successfully separated. Data silos enforced.',
       new_collective_id: detachedId,
       cloned_child_contexts: childPersonas.rows.length
    };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Household detachment failed' });
  }
});

// ==========================================
// HOUSEHOLDS — Story 3.4a: cross-household membership + per-Space Pod grants
// ==========================================
//
// Authorization model:
//   - admin: invite, list, accept-on-behalf-of, force-remove, list any
//     member's grants
//   - the linked internal member (when collective_members.internal_profile_id
//     equals the caller's profile_id): record/revoke own grants, initiate
//     own leave, cancel own leave
//   - children: blocked from all of these (handled by role check)

async function ensureAdminCaller(request: any, reply: any): Promise<string | null> {
  const profile = (request as any).profile;
  if (!profile || profile.role !== 'admin') {
    reply.code(403).send({ error: 'Admin role required' });
    return null;
  }
  return (request as any).profileId as string;
}

async function ensureAdminOrSelf(
  request: any,
  reply: any,
  memberId: string,
): Promise<{ profileId: string; isAdmin: boolean } | null> {
  const profile = (request as any).profile;
  if (!profile) {
    reply.code(401).send({ error: 'Authentication required' });
    return null;
  }
  if (profile.role === 'child') {
    reply.code(403).send({ error: 'Children cannot manage household membership' });
    return null;
  }
  const callerId = (request as any).profileId as string;
  if (profile.role === 'admin') {
    return { profileId: callerId, isAdmin: true };
  }
  const { findMember } = await import('./households/membership');
  const member = await findMember(memberId);
  if (!member) {
    reply.code(404).send({ error: 'Member not found' });
    return null;
  }
  if (member.internalProfileId !== callerId) {
    reply.code(403).send({ error: 'Caller is not the linked member' });
    return null;
  }
  return { profileId: callerId, isAdmin: false };
}

server.post('/api/households/members', async (request, reply) => {
  const adminId = await ensureAdminCaller(request, reply);
  if (!adminId) return;
  const body = request.body as {
    memberWebid?: string;
    memberDisplayName?: string;
    internalProfileId?: string | null;
    leavePolicyForEmergent?: 'retain_attributed' | 'anonymise' | 'remove';
    gracePeriodDays?: number;
  };
  if (!body?.memberWebid || !body.memberDisplayName) {
    return reply.code(400).send({ error: 'memberWebid and memberDisplayName required' });
  }
  try {
    const { inviteMember, MembershipError } = await import('./households/membership');
    const member = await inviteMember({
      collectiveAdminProfileId: adminId,
      memberWebid: body.memberWebid,
      memberDisplayName: body.memberDisplayName,
      invitedByProfileId: adminId,
      internalProfileId: body.internalProfileId,
      leavePolicyForEmergent: body.leavePolicyForEmergent,
      gracePeriodDays: body.gracePeriodDays,
    });
    return reply.code(201).send({ member });
  } catch (err: any) {
    if (err?.name === 'MembershipError') {
      return reply.code(400).send({ error: err.message, reason: err.reason });
    }
    server.log.error({ err }, 'Failed to invite household member');
    return reply.code(500).send({ error: 'Failed to invite member' });
  }
});

server.get('/api/households/members', async (request, reply) => {
  const adminId = await ensureAdminCaller(request, reply);
  if (!adminId) return;
  const includeLeft = (request.query as any)?.includeLeft === 'true';
  try {
    const { listMembers } = await import('./households/membership');
    return { members: await listMembers(adminId, { includeLeft }) };
  } catch (err) {
    server.log.error({ err }, 'Failed to list household members');
    return reply.code(500).send({ error: 'Failed to list members' });
  }
});

server.post<{ Params: { id: string } }>('/api/households/members/:id/accept', async (request, reply) => {
  const ctx = await ensureAdminOrSelf(request, reply, request.params.id);
  if (!ctx) return;
  try {
    const { acceptInvite } = await import('./households/membership');
    return { member: await acceptInvite(request.params.id) };
  } catch (err: any) {
    if (err?.name === 'MembershipError') {
      return reply.code(400).send({ error: err.message, reason: err.reason });
    }
    server.log.error({ err }, 'Failed to accept invite');
    return reply.code(500).send({ error: 'Failed to accept invite' });
  }
});

server.post<{ Params: { id: string } }>('/api/households/members/:id/leave', async (request, reply) => {
  const ctx = await ensureAdminOrSelf(request, reply, request.params.id);
  if (!ctx) return;
  const body = (request.body ?? {}) as {
    policyOverride?: 'retain_attributed' | 'anonymise' | 'remove';
    gracePeriodDaysOverride?: number;
  };
  try {
    const { initiateLeave } = await import('./households/membership');
    const member = await initiateLeave({
      memberId: request.params.id,
      policyOverride: body.policyOverride,
      gracePeriodDaysOverride: body.gracePeriodDaysOverride,
    });
    if (body.gracePeriodDaysOverride === 0) {
      const { dropAllCacheForMember } = await import('./spaces/external_sync');
      await dropAllCacheForMember(request.params.id);
    }
    return { member };
  } catch (err: any) {
    if (err?.name === 'MembershipError') {
      return reply.code(400).send({ error: err.message, reason: err.reason });
    }
    server.log.error({ err }, 'Failed to initiate leave');
    return reply.code(500).send({ error: 'Failed to initiate leave' });
  }
});

server.post<{ Params: { id: string } }>('/api/households/members/:id/cancel-leave', async (request, reply) => {
  const ctx = await ensureAdminOrSelf(request, reply, request.params.id);
  if (!ctx) return;
  try {
    const { cancelLeave } = await import('./households/membership');
    return { member: await cancelLeave(request.params.id) };
  } catch (err: any) {
    if (err?.name === 'MembershipError') {
      return reply.code(400).send({ error: err.message, reason: err.reason });
    }
    server.log.error({ err }, 'Failed to cancel leave');
    return reply.code(500).send({ error: 'Failed to cancel leave' });
  }
});

// Admin force-remove (no grace period). Use sparingly — leave + grace is
// the safer default. Useful for an invited member who never accepted.
server.delete<{ Params: { id: string } }>('/api/households/members/:id', async (request, reply) => {
  const adminId = await ensureAdminCaller(request, reply);
  if (!adminId) return;
  try {
    const { finaliseLeave } = await import('./households/membership');
    const member = await finaliseLeave(request.params.id);
    const { dropAllCacheForMember } = await import('./spaces/external_sync');
    await dropAllCacheForMember(request.params.id);
    return { member };
  } catch (err: any) {
    if (err?.name === 'MembershipError') {
      return reply.code(400).send({ error: err.message, reason: err.reason });
    }
    server.log.error({ err }, 'Failed to remove member');
    return reply.code(500).send({ error: 'Failed to remove member' });
  }
});

server.get<{ Params: { id: string } }>('/api/households/members/:id/grants', async (request, reply) => {
  const ctx = await ensureAdminOrSelf(request, reply, request.params.id);
  if (!ctx) return;
  const includeRevoked = (request.query as any)?.includeRevoked === 'true';
  try {
    const { listGrants } = await import('./households/membership');
    return { grants: await listGrants(request.params.id, { includeRevoked }) };
  } catch (err) {
    server.log.error({ err }, 'Failed to list grants');
    return reply.code(500).send({ error: 'Failed to list grants' });
  }
});

server.post<{ Params: { id: string } }>('/api/households/members/:id/grants', async (request, reply) => {
  const ctx = await ensureAdminOrSelf(request, reply, request.params.id);
  if (!ctx) return;
  const body = request.body as { spaceUrl?: string };
  if (!body?.spaceUrl) {
    return reply.code(400).send({ error: 'spaceUrl required' });
  }
  try {
    const { recordGrant } = await import('./households/membership');
    const grant = await recordGrant({ memberId: request.params.id, spaceUrl: body.spaceUrl });
    return reply.code(201).send({ grant });
  } catch (err: any) {
    if (err?.name === 'MembershipError') {
      return reply.code(400).send({ error: err.message, reason: err.reason });
    }
    server.log.error({ err }, 'Failed to record grant');
    return reply.code(500).send({ error: 'Failed to record grant' });
  }
});

server.delete<{ Params: { id: string }; Querystring: { spaceUrl?: string } }>(
  '/api/households/members/:id/grants',
  async (request, reply) => {
    const ctx = await ensureAdminOrSelf(request, reply, request.params.id);
    if (!ctx) return;
    const spaceUrl = request.query?.spaceUrl;
    if (!spaceUrl) {
      return reply.code(400).send({ error: 'spaceUrl querystring required' });
    }
    try {
      const { revokeGrant } = await import('./households/membership');
      const ok = await revokeGrant(request.params.id, spaceUrl);
      if (!ok) return reply.code(404).send({ error: 'Active grant not found' });
      const { dropCacheForGrant } = await import('./spaces/external_sync');
      await dropCacheForGrant(request.params.id, spaceUrl);
      return { success: true };
    } catch (err: any) {
      if (err?.name === 'MembershipError') {
        return reply.code(400).send({ error: err.message, reason: err.reason });
      }
      server.log.error({ err }, 'Failed to revoke grant');
      return reply.code(500).send({ error: 'Failed to revoke grant' });
    }
  },
);

// Story 3.4b — manually trigger a sync of all active grants for a member.
// Background sweep runs on the 3.4 cron; this is for the wizard's "Test it
// now" button after granting + for ops debugging.
server.post<{ Params: { id: string } }>(
  '/api/households/members/:id/grants/sync',
  async (request, reply) => {
    const ctx = await ensureAdminOrSelf(request, reply, request.params.id);
    if (!ctx) return;
    const body = (request.body ?? {}) as { accessToken?: string; forceRefetch?: boolean };
    try {
      const { syncMemberGrants } = await import('./spaces/external_sync');
      const reports = await syncMemberGrants(request.params.id, {
        accessToken: body.accessToken,
        forceRefetch: body.forceRefetch,
      });
      return { reports };
    } catch (err: any) {
      if (err?.name === 'ExternalSyncError') {
        return reply.code(400).send({ error: err.message, reason: err.reason });
      }
      server.log.error({ err }, 'Failed to sync grants');
      return reply.code(500).send({ error: 'Failed to sync grants' });
    }
  },
);

// Story 3.4b — list parsed Spaces cached from a member's external Pod.
// This is what synthesis / briefings / chat will read from once the
// retrieval layer learns to fold external Spaces in.
server.get<{ Params: { id: string } }>(
  '/api/households/members/:id/grants/cached',
  async (request, reply) => {
    const ctx = await ensureAdminOrSelf(request, reply, request.params.id);
    if (!ctx) return;
    try {
      const { listCachedSpacesForMember } = await import('./spaces/external_sync');
      return { spaces: await listCachedSpacesForMember(request.params.id) };
    } catch (err) {
      server.log.error({ err }, 'Failed to list cached spaces');
      return reply.code(500).send({ error: 'Failed to list cached spaces' });
    }
  },
);

// Boot server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3100', 10);
    
    // Initialize required external services
    await testConnection();
    await runMigrations();
    // TD-01 — after migrations have had a chance to create the
    // memu_app role + apply RLS, verify the runtime pool is actually
    // bound to a non-superuser role. Hosted (Hetzner) sets
    // MEMU_REQUIRE_NOSUPERUSER=true so this fails loud rather than
    // silently leaking across tenants.
    await assertRuntimeRoleNotSuperuser();

    // Validate prompt skills on the way up so a broken SKILL.md crashes boot,
    // not the first LLM call in production.
    validateAllSkills();
    server.log.info(`Loaded ${listSkills().length} skills from skills/`);

    // WhatsApp is OPTIONAL — mobile app is the primary channel
    try {
      await connectToWhatsApp();
    } catch (err) {
      server.log.warn('WhatsApp connection skipped or failed — mobile app is primary channel');
    }

    // Listen on all network interfaces
    await server.listen({ port: 3100, host: '0.0.0.0' });
    server.log.info(`PWA running at http://localhost:3100`);

    // Schedule morning briefings at 07:00 Europe/London every day.
    //
    // Iterate ALL adults/admins, not just those with push_tokens. The
    // pre-2026-05-06 query INNER-JOIN'd push_tokens, which meant a profile
    // with a silently-failed push registration never had its briefing
    // generated at all — opening the app at 8am showed nothing because
    // nothing had been written to stream_cards. Now: briefing is always
    // generated + persisted; pushMorningBriefingToMobile gates only the
    // notification send on token presence.
    cron.schedule('0 7 * * *', async () => {
      server.log.info('Running daily morning briefings...');

      // Pre-Beta Stream 1 — queryAsBootstrap to enumerate adults across
      // every collective. The Tier-B profiles policy requires either
      // collective match or the explicit bootstrap flag; cron enumeration
      // is one of the legitimate bootstrap-flag callers. After fetching
      // we enter each recipient's collective context per-iteration so the
      // briefing generator's tenant-scoped queries resolve correctly.
      const recipients = await db.queryAsBootstrap<{ id: string; display_name: string; collective_id: string }>(`
        SELECT id, display_name, collective_id
        FROM profiles
        WHERE role IN ('adult', 'admin')
      `);
      for (const row of recipients.rows) {
        try {
          server.log.info(`Generating morning briefing for ${row.display_name} (${row.id})`);
          await enterCollectiveContext(row.collective_id, async () => {
            await pushMorningBriefingToMobile(row.id);
          });
        } catch (err) {
          server.log.error({ err, profileId: row.id }, 'Morning briefing failed');
        }
      }

      if (recipients.rows.length === 0) {
        server.log.warn('No adult/admin profiles found — morning briefing skipped.');
      }
    }, { timezone: 'Europe/London' });

    // Daily maintenance at 06:30 — standards check + domain health recompute.
    // Runs before the 07:00 briefing so the domain header is fresh. The daily
    // LLM reflection scan was retired 2026-04-25 (duplicated work the briefing
    // already does and was the primary noise source in stream cards). Weekly
    // pattern detection on Sunday night and per_message contradiction checks
    // remain. Both skip families with reflection_enabled = false.
    cron.schedule('30 6 * * *', async () => {
      server.log.info('Running daily maintenance (standards + domain health) across all families');
      const { runDailyMaintenanceForAllFamilies } = await import('./reflection/reflection');
      const results = await runDailyMaintenanceForAllFamilies();
      server.log.info({ results }, 'Daily maintenance complete');

      // Auto-expire stale active stream cards. Anything still 'active' after
      // 14 days is almost certainly something the user has stopped caring
      // about — without this the briefing's "open commitments" pool grows
      // unbounded and the same items resurface forever (the AWBS-basket
      // bug from 2026-04-29). Items that were genuinely important are
      // still discoverable via Spaces / search; this just stops them
      // counting as "open" for briefing rotation.
      try {
        const expired = await db.query(
          `UPDATE stream_cards
              SET status = 'expired', resolved_at = NOW()
            WHERE status = 'active'
              AND created_at < NOW() - interval '14 days'
              AND card_type != 'briefing'
            RETURNING id`,
        );
        if (expired.rowCount && expired.rowCount > 0) {
          server.log.info({ count: expired.rowCount }, 'Auto-expired stale stream cards');
        }
      } catch (err) {
        server.log.error({ err }, 'Stream card auto-expire failed');
      }
    }, { timezone: 'Europe/London' });

    cron.schedule('0 23 * * 0', async () => {
      server.log.info('Running weekly reflection pass across all families');
      const { runReflectionForAllFamilies } = await import('./reflection/reflection');
      const results = await runReflectionForAllFamilies('weekly');
      server.log.info({ results }, 'Weekly reflection complete');
    }, { timezone: 'Europe/London' });

    // Story 3.1 — weekly git gc on every family's spaces repo to keep
    // pack files compact. Mondays at 04:00 (after Sunday's reflection).
    cron.schedule('0 4 * * 1', async () => {
      server.log.info('Running weekly git gc across all family spaces repos');
      const { gcAllFamilyRepos } = await import('./spaces/maintenance');
      const summary = await gcAllFamilyRepos();
      server.log.info({ summary }, 'Spaces git gc complete');
    }, { timezone: 'Europe/London' });

    // Daytime capture nudges (Fix 5 — 2026-05-12). Two slots per day:
    // 11:00 morning, 16:00 afternoon. For each adult/admin with at least
    // one registered push token, pick one rotating prompt and send. The
    // notification deep-links to /capture/quick on tap where the user can
    // answer in one tap → autolearn routes the answer to the right Space.
    // Weekends OFF by default — Hareesh's life doesn't need a Memu prompt
    // at 11am Saturday morning; flip MEMU_CAPTURE_NUDGES_WEEKENDS=1 if a
    // future user prefers seven-day rhythm.
    const scheduleCaptureNudge = async (whenHour: number) => {
      const day = new Date().getDay(); // 0=Sun … 6=Sat
      const isWeekend = day === 0 || day === 6;
      if (isWeekend && process.env.MEMU_CAPTURE_NUDGES_WEEKENDS !== '1') {
        server.log.info(`[CAPTURE NUDGE ${whenHour}h] skipped — weekend`);
        return;
      }
      const recipients = await db.queryAsBootstrap<{ id: string; display_name: string; collective_id: string }>(
        `SELECT p.id, p.display_name, p.collective_id
           FROM profiles p
           JOIN push_tokens t ON t.profile_id = p.id
          WHERE p.role IN ('adult', 'admin')
          GROUP BY p.id, p.display_name, p.collective_id`,
      );
      for (const row of recipients.rows) {
        try {
          const prompt = pickPrompt(row.id);
          await enterCollectiveContext(row.collective_id, async () => {
            const tokens = await getTokensForProfile(row.id);
            if (tokens.length === 0) return;
            await sendPush(tokens, {
              title: 'Quick capture',
              body: prompt.notification,
              data: { screen: 'capture', promptId: prompt.id, kind: 'capture_nudge' },
            });
          });
          server.log.info(`[CAPTURE NUDGE ${whenHour}h] sent "${prompt.id}" to ${row.display_name}`);
        } catch (err) {
          server.log.error({ err, profileId: row.id }, 'Capture nudge failed');
        }
      }
    };
    cron.schedule('0 11 * * *', () => { scheduleCaptureNudge(11).catch(err => server.log.error(err)); }, { timezone: 'Europe/London' });
    cron.schedule('0 16 * * *', () => { scheduleCaptureNudge(16).catch(err => server.log.error(err)); }, { timezone: 'Europe/London' });

    // Story 3.4 — daily 04:30 sweep: (1) finalise any collective_members whose
    // leave grace period has elapsed (also drops their external Space cache),
    // then (2) refresh granted external Pod Spaces for every collective admin.
    cron.schedule('30 4 * * *', async () => {
      server.log.info('Running daily collective sweep (finaliseExpiredLeaves + syncHouseholdGrants)');
      try {
        const { finaliseExpiredLeaves } = await import('./households/membership');
        const { dropAllCacheForMember, syncHouseholdGrants } = await import('./spaces/external_sync');

        // Pre-Beta Stream 1 — enumerate collectives without an active
        // tenant context (collectives is Tier-C, no RLS), then enter
        // each one for the per-collective work.
        const collectives = await db.queryWithoutTenant<{ id: string; primary_admin_profile_id: string }>(
          `SELECT id, primary_admin_profile_id FROM collectives WHERE status = 'active'`,
        );

        let totalFinalised = 0;
        let totalReports = 0;
        for (const hh of collectives.rows) {
          try {
            await enterCollectiveContext(hh.id, async () => {
              const finalised = await finaliseExpiredLeaves();
              totalFinalised += finalised.length;
              for (const member of finalised) {
                try {
                  await dropAllCacheForMember(member.id);
                } catch (err) {
                  server.log.error({ err, memberId: member.id }, 'Failed to drop cache for finalised member');
                }
              }
              const reports = await syncHouseholdGrants(hh.primary_admin_profile_id);
              totalReports += reports.length;
            });
          } catch (err) {
            server.log.error(
              { err, collectiveId: hh.id },
              'collective sweep failed for collective',
            );
          }
        }
        server.log.info(
          { finalised: totalFinalised, collectives: collectives.rows.length, grantReports: totalReports },
          'Daily collective sweep complete',
        );
      } catch (err) {
        server.log.error({ err }, 'Daily collective sweep failed');
      }
    }, { timezone: 'Europe/London' });

    // Phase 0 of Build Spec 1 — nightly retrieval-eval replay per collective.
    // 05:15 Europe/London sits after the 04:30 households sweep and well
    // before the 07:00 morning briefing. Best-effort: any per-collective
    // failure is logged but doesn't poison subsequent collectives.
    cron.schedule('15 5 * * *', async () => {
      server.log.info('Running nightly retrieval-eval replay');
      try {
        const { loadGoldenQueries } = await import('./eval/golden');
        const { replayAll } = await import('./eval/replay');
        const { renderRecallCard, readPreviousRecallPercent, writeRecallCard } = await import('./eval/card');
        const { resolve } = await import('node:path');

        const dir = resolve(process.cwd(), 'eval/golden');
        const queries = loadGoldenQueries(dir);
        if (queries.length === 0) {
          server.log.warn('[EVAL] no golden queries — skipping nightly recall card');
          return;
        }

        const collectives = await db.queryWithoutTenant<{ id: string; primary_admin_profile_id: string }>(
          `SELECT id, primary_admin_profile_id FROM collectives WHERE status = 'active'`,
        );

        for (const hh of collectives.rows) {
          try {
            await enterCollectiveContext(hh.id, async () => {
              const summary = await replayAll(queries, {
                collectiveId: hh.id,
                viewerProfileId: hh.primary_admin_profile_id,
              });
              const previous = await readPreviousRecallPercent();
              const card = renderRecallCard(summary, previous);
              await writeRecallCard(hh.id, hh.primary_admin_profile_id, card);
              server.log.info(
                { collectiveId: hh.id, recallPercent: summary.recallPercent, passed: summary.passed, total: summary.total },
                '[EVAL] recall card written',
              );
            });
          } catch (err) {
            server.log.error({ err, collectiveId: hh.id }, '[EVAL] per-collective replay failed');
          }
        }
      } catch (err) {
        server.log.error({ err }, '[EVAL] nightly sweep failed');
      }
    }, { timezone: 'Europe/London' });

  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
