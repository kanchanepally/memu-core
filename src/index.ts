import 'dotenv/config'; // Load env variables immediately before other imports

import Fastify from 'fastify';
import pino from 'pino';
import { testConnection, pool } from './db/connection';
import { runMigrations } from './db/migrate';
import { connectToWhatsApp } from './channels/whatsapp';
import { seedContext } from './intelligence/context';
import { processIntelligencePipeline } from './intelligence/orchestrator';
import { processChatVisionInput } from './intelligence/vision';
import { processDocumentIngestion } from './intelligence/documentIngestion';
import { fetchUpcomingEvents, getGoogleAuthUrl, handleGoogleCallback, createGoogleCalendarEvent, insertCalendarEvent } from './channels/calendar/google';
import { generateAndPushMorningBriefing, generateProactiveSynthesis, pushMorningBriefingToMobile } from './intelligence/briefing';
import { registerPushToken } from './channels/mobile';
import { requireAuth, registerProfile } from './auth';
import { verifyGoogleIdToken, signInWithGoogle } from './channels/auth/google-signin';
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
import { upsertSpace, findSpaceBySlug } from './spaces/store';
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

// Health check endpoint (no auth required)
server.get('/health', async (request, reply) => {
  return {
    status: 'ok',
    service: 'memu-core',
    timestamp: new Date().toISOString()
  };
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

server.addHook('preHandler', async (request, reply) => {
  const url = request.url;
  // Skip auth for health, registration, Google sign-in, OAuth callback, and static assets
  if (
    url === '/health' ||
    url === '/api/register' ||
    url === '/api/auth/google/signin' ||
    url === '/api/admin/trigger-briefing' ||
    url.startsWith('/api/auth/google/callback') ||
    !url.startsWith('/api/')
  ) {
    return;
  }
  return requireAuth(request, reply);
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
    const messageId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const visibility = body.visibility === 'personal' ? 'personal' : 'family';
    const responseText = await processIntelligencePipeline(profileId, body.content, 'mobile', messageId, visibility);
    return { response: responseText };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Pipeline failed' });
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
    const res = await pool.query(
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
    await pool.query(
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
    const { rows } = await pool.query(
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
    const { rows } = await pool.query(
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
    const { rows, rowCount } = await pool.query(
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
    const { rowCount } = await pool.query('DELETE FROM entity_registry WHERE id = $1', [id]);
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
    await pool.query(
      `DELETE FROM profile_channels WHERE profile_id = $1 AND channel = 'google_calendar'`,
      [profileId]
    );
    return { success: true };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to disconnect calendar' });
  }
});

// Synthesis Endpoint for App Landing Page
server.get('/api/dashboard/synthesis', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const synthesis = await generateProactiveSynthesis(profileId);
    return { synthesis };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to generate synthesis' });
  }
});

// Family Memory Endpoint
server.get('/api/memory/recent', async (request, reply) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, source, content, created_at FROM context_entries ORDER BY created_at DESC LIMIT 50`
    );
    return rows;
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to fetch memory' });
  }
});

// Today's Brief + Stream Cards — uses authenticated profile
server.get('/api/dashboard/brief', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;

    // 1. Fetch upcoming Calendar Events (Next 7 days)
    const events = await fetchUpcomingEvents(profileId);
    
    // Nori Dashboard pattern: Today vs Future
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    
    const todayEvents = [];
    const futureEvents = [];

    for (const e of events) {
      const startTime = e.start?.dateTime || e.start?.date || null;
      if (!startTime) continue;
      
      const evt = {
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
    
    // Check if the calendar is linked
    const linkRes = await pool.query(`SELECT 1 FROM profile_channels WHERE profile_id = $1 AND channel = 'google_calendar'`, [profileId]);
    const isCalendarConnected = linkRes.rows.length > 0;
    
    // 2. Fetch Active Stream Cards (excluding shopping)
    const streamRes = await pool.query(
      `SELECT * FROM stream_cards WHERE family_id = $1 AND status = 'active' AND card_type != 'shopping' ORDER BY created_at DESC`, 
      [profileId]
    );

    // 3. Fetch Shopping List from list_items (bug 3 — committed items live here, not stream_cards)
    const shoppingRes = await pool.query(
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
      isCalendarConnected
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
    const res = await pool.query(
      `SELECT * FROM synthesis_pages WHERE profile_id = $1 ORDER BY last_updated_at DESC`,
      [profileId]
    );
    return { spaces: res.rows };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to fetch spaces' });
  }
});

// Create a new Space manually
server.post('/api/spaces', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { title, category, body_markdown } = request.body as {
      title?: string;
      category?: string;
      body_markdown?: string;
    };

    const validCategories = ['person', 'routine', 'household', 'commitment', 'document'];
    if (!title || !title.trim()) {
      return reply.code(400).send({ error: 'title is required' });
    }
    if (!category || !validCategories.includes(category)) {
      return reply.code(400).send({ error: 'category must be one of person, routine, household, commitment, document' });
    }

    const res = await pool.query(
      `INSERT INTO synthesis_pages (profile_id, category, title, body_markdown)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (profile_id, category, title)
       DO UPDATE SET body_markdown = EXCLUDED.body_markdown, last_updated_at = NOW()
       RETURNING *`,
      [profileId, category, title.trim(), body_markdown || '']
    );
    return { space: res.rows[0] };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to create space' });
  }
});

// Update a Space (human-edited synthesis page)
server.put('/api/spaces/:id', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const { id } = request.params as { id: string };
    const { title, body_markdown } = request.body as { title?: string; body_markdown?: string };

    if (typeof body_markdown !== 'string' || body_markdown.length === 0) {
      return reply.code(400).send({ error: 'body_markdown is required' });
    }

    const res = await pool.query(
      `UPDATE synthesis_pages
         SET title = COALESCE($1, title),
             body_markdown = $2,
             last_updated_at = NOW()
       WHERE id = $3 AND profile_id = $4
       RETURNING *`,
      [title || null, body_markdown, id, profileId]
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
    const res = await pool.query(
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

// PWA: Resolve Stream Card
server.post('/api/stream/resolve', async (request, reply) => {
  const { cardId } = request.body as any;
  if (!cardId) return reply.code(400).send({ error: 'cardId required' });
  
  try {
    await pool.query("UPDATE stream_cards SET status = 'resolved', resolved_at = NOW() WHERE id = $1", [cardId]);
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

  try {
    await pool.query("UPDATE stream_cards SET status = 'dismissed', resolved_at = NOW() WHERE id = $1", [cardId]);
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
    await pool.query(
      `UPDATE stream_cards SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    // Return the updated card
    const res = await pool.query("SELECT * FROM stream_cards WHERE id = $1", [cardId]);
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
    const cardRes = await pool.query(
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

    await pool.query(
      `UPDATE stream_cards SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
      [cardId]
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
  const res = await pool.query(
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

async function resolveCard(cardId: string) {
  await pool.query(
    `UPDATE stream_cards SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
    [cardId],
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
    await resolveCard(cardId);
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
    await resolveCard(cardId);
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
    if (!existing) {
      return reply.code(404).send({ error: `Space not found: ${payload.category}/${payload.slug}` });
    }
    const space = await upsertSpace({
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
    });
    await resolveCard(cardId);
    return { success: true, uri: space.uri };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'update-space failed' });
  }
});

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
  await resolveCard(cardId);
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
    const { list_type, item_text, note, list_name, source } = request.body as {
      list_type?: string;
      item_text?: string;
      note?: string | null;
      list_name?: string | null;
      source?: string | null;
    };
    if (!list_type || !['shopping', 'task', 'custom'].includes(list_type)) {
      return reply.code(400).send({ error: 'list_type must be shopping, task, or custom' });
    }
    if (!item_text || !item_text.trim()) {
      return reply.code(400).send({ error: 'item_text required' });
    }
    const item = await addListItem({
      familyId: profileId,
      listType: list_type as ListType,
      itemText: item_text.trim(),
      note: note ?? null,
      listName: list_name ?? null,
      source: source ?? 'manual',
      createdBy: profileId,
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
    const { item_text, note } = request.body as { item_text?: string; note?: string | null };
    const item = await updateListItem(id, profileId, {
      itemText: item_text,
      note,
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
server.post('/api/calendar/add', async (request, reply) => {
  const { cardId } = request.body as any;
  if (!cardId) return reply.code(400).send({ error: 'cardId required' });
  
  try {
    const cardRes = await pool.query("SELECT * FROM stream_cards WHERE id = $1", [cardId]);
    if (cardRes.rows.length === 0) return reply.code(404).send({ error: 'Card not found' });
    
    const card = cardRes.rows[0];
    const profileId = (request as any).profileId;

    // Attempt to write event to connected Google Calendar
    const success = await createGoogleCalendarEvent(profileId, card.title, card.body);
    
    if (success) {
       // Mark card as handled
       await pool.query("UPDATE stream_cards SET status = 'resolved', resolved_at = NOW() WHERE id = $1", [cardId]);
       return { success: true };
    } else {
       return reply.code(500).send({ error: 'Google Calendar sync failed. Check OAuth credentials.' });
    }
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// Chat history — uses authenticated profile
server.get('/api/chat/history', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const query = request.query as any;

    // Get the most recent conversation
    const convRes = await pool.query(
      'SELECT id FROM conversations WHERE profile_id = $1 ORDER BY started_at DESC LIMIT 1',
      [profileId]
    );
    if (convRes.rows.length === 0) return { messages: [] };

    const limit = Math.min(parseInt(query.limit || '50', 10), 100);

    // Return real (de-anonymised) content for display in the app
    const msgRes = await pool.query(
      `SELECT id, content_original, content_response_translated, channel, created_at
       FROM messages
       WHERE conversation_id = $1
         AND content_original IS NOT NULL
         AND content_response_translated IS NOT NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [convRes.rows[0].id, limit]
    );

    // Reverse to chronological order for the app
    const messages = msgRes.rows.reverse().map((row: any) => ({
      id: row.id,
      userMessage: row.content_original,
      memuResponse: row.content_response_translated,
      channel: row.channel,
      timestamp: row.created_at,
    }));

    return { messages };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to load chat history' });
  }
});

// PRIVACY LEDGER: Show what Claude saw — filtered to authenticated profile
server.get('/api/ledger', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const res = await pool.query(
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
       const res = await pool.query('SELECT id FROM profiles LIMIT 1');
       if (res.rows.length === 0) {
          return reply.code(400).send({ error: 'No profiles exist to run briefing for' });
       }
       profileId = res.rows[0].id;
    }
    const message = await generateAndPushMorningBriefing(profileId);
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
    const briefing = await generateAndPushMorningBriefing(profileId);
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
    const profileRes = await pool.query("SELECT id FROM profiles WHERE id = $1", [profileId]);
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
    const res = await pool.query(
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
    await pool.query("DELETE FROM messages WHERE profile_id = $1", [profileId]);
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
    const newAdult = await pool.query("INSERT INTO profiles (display_name, role) VALUES ('Detached Adult', 'adult') RETURNING id");
    const detachedId = newAdult.rows[0].id;

    // 2. Safely clone the child personas so BOTH parents independently retain the AI's child context going forward
    const childPersonas = await pool.query("SELECT * FROM personas WHERE persona_label LIKE 'Child-%'");
    for (const child of childPersonas.rows) {
       await pool.query("INSERT INTO personas (id, profile_id, persona_label, attributes) VALUES ($1, $2, $3, $4)",
         [`child-${Date.now()}-${Math.random().toString(36).substring(7)}`, detachedId, child.persona_label, child.attributes]
       );
    }

    return { 
       success: true, 
       message: 'Household successfully separated. Data silos enforced.',
       new_household_id: detachedId,
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
//   - the linked internal member (when household_members.internal_profile_id
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
      householdAdminProfileId: adminId,
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
    // Mobile push is the primary delivery. WhatsApp is a legacy fallback for
    // profiles that still have a linked channel.
    cron.schedule('0 7 * * *', async () => {
      server.log.info('Running daily morning briefings...');

      // Mobile push path: any adult/admin with a registered Expo token.
      const pushRes = await pool.query(`
        SELECT DISTINCT p.id, p.display_name
        FROM profiles p
        INNER JOIN push_tokens pt ON pt.profile_id = p.id
        WHERE p.role IN ('adult', 'admin')
      `);
      for (const row of pushRes.rows) {
        try {
          server.log.info(`Pushing mobile briefing to ${row.display_name} (${row.id})`);
          await pushMorningBriefingToMobile(row.id);
        } catch (err) {
          server.log.error({ err, profileId: row.id }, 'Mobile briefing push failed');
        }
      }

      // Legacy WhatsApp path.
      const waRes = await pool.query(`
        SELECT p.id, p.display_name
        FROM profiles p
        INNER JOIN profile_channels pc
          ON pc.profile_id = p.id AND pc.channel = 'whatsapp'
        WHERE p.role IN ('adult', 'admin')
      `);
      for (const row of waRes.rows) {
        try {
          server.log.info(`Pushing WhatsApp briefing to ${row.display_name} (${row.id})`);
          await generateAndPushMorningBriefing(row.id);
        } catch (err) {
          server.log.error({ err, profileId: row.id }, 'WhatsApp briefing failed');
        }
      }

      if (pushRes.rows.length === 0 && waRes.rows.length === 0) {
        server.log.warn('No recipients registered for briefings — skipping');
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

    // Story 3.4 — daily 04:30 sweep: (1) finalise any household_members whose
    // leave grace period has elapsed (also drops their external Space cache),
    // then (2) refresh granted external Pod Spaces for every household admin.
    cron.schedule('30 4 * * *', async () => {
      server.log.info('Running daily household sweep (finaliseExpiredLeaves + syncHouseholdGrants)');
      try {
        const { finaliseExpiredLeaves } = await import('./households/membership');
        const { dropAllCacheForMember, syncHouseholdGrants } = await import('./spaces/external_sync');
        const { pool } = await import('./db/connection');

        const finalised = await finaliseExpiredLeaves();
        for (const member of finalised) {
          try {
            await dropAllCacheForMember(member.id);
          } catch (err) {
            server.log.error({ err, memberId: member.id }, 'Failed to drop cache for finalised member');
          }
        }

        const admins = await pool.query<{ household_admin_profile_id: string }>(
          'SELECT DISTINCT household_admin_profile_id FROM household_members',
        );
        let totalReports = 0;
        for (const row of admins.rows) {
          try {
            const reports = await syncHouseholdGrants(row.household_admin_profile_id);
            totalReports += reports.length;
          } catch (err) {
            server.log.error(
              { err, household: row.household_admin_profile_id },
              'syncHouseholdGrants failed for household',
            );
          }
        }
        server.log.info(
          { finalised: finalised.length, households: admins.rows.length, grantReports: totalReports },
          'Daily household sweep complete',
        );
      } catch (err) {
        server.log.error({ err }, 'Daily household sweep failed');
      }
    }, { timezone: 'Europe/London' });

  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
