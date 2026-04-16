import 'dotenv/config'; // Load env variables immediately before other imports

import Fastify from 'fastify';
import pino from 'pino';
import { testConnection, pool } from './db/connection';
import { runMigrations } from './db/migrate';
import { connectToWhatsApp } from './channels/whatsapp';
import { seedContext } from './intelligence/context';
import { processIntelligencePipeline } from './intelligence/orchestrator';
import { fetchUpcomingEvents, getGoogleAuthUrl, handleGoogleCallback, createGoogleCalendarEvent } from './channels/calendar/google';
import { generateAndPushMorningBriefing, generateProactiveSynthesis, pushMorningBriefingToMobile } from './intelligence/briefing';
import { registerPushToken } from './channels/mobile';
import { requireAuth, registerProfile } from './auth';
import { verifyGoogleIdToken, signInWithGoogle } from './channels/auth/google-signin';
import { importWhatsAppExport, importTextFile, importFileBundle } from './intelligence/import';
import { validateAllSkills, listSkills } from './skills/loader';
import {
  setProviderKey,
  revokeProviderKey,
  setProviderKeyEnabled,
  listProviderKeyStatus,
  type BYOKProvider,
} from './security/byok';
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
  const profileId = (request as any).profileId;
  const url = getGoogleAuthUrl(profileId);
  const query = request.query as any;
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
    await handleGoogleCallback(code, state);
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

    // 3. Fetch Shopping List
    const shoppingRes = await pool.query(
      `SELECT * FROM stream_cards WHERE family_id = $1 AND status = 'active' AND card_type = 'shopping' ORDER BY created_at ASC`, 
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

// PWA: Move Card to Shopping List
server.post('/api/stream/to-shopping', async (request, reply) => {
  const { cardId } = request.body as any;
  if (!cardId) return reply.code(400).send({ error: 'cardId required' });
  
  try {
    await pool.query("UPDATE stream_cards SET card_type = 'shopping' WHERE id = $1", [cardId]);
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
    const profileId = (request as any).profileId;
    const message = await generateAndPushMorningBriefing(profileId);
    return { success: true, messagePushed: message };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed' });
  }
});

// ==========================================
// SLICE 6: TRUST ARCHITECTURE
// ==========================================

// DATA SOVEREIGNTY: Export full profile dataset — uses authenticated profile
server.get('/api/export', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;
    const profileRes = await pool.query("SELECT * FROM profiles WHERE id = $1", [profileId]);
    if (profileRes.rows.length === 0) return reply.code(404).send({ error: 'No profile found' });
    const profile = profileRes.rows[0];

    // Fetch all related sovereign data
    const personas = await pool.query("SELECT * FROM personas WHERE profile_id = $1", [profileId]);
    const channels = await pool.query("SELECT channel, channel_identifier FROM profile_channels WHERE profile_id = $1", [profileId]);
    const messages = await pool.query("SELECT * FROM messages WHERE profile_id = $1 ORDER BY created_at ASC", [profileId]);
    const streamCards = await pool.query("SELECT * FROM stream_cards WHERE family_id = $1", [profileId]);

    // Build the sovereign JSON archive
    const archive = {
      exported_at: new Date().toISOString(),
      profile: {
         id: profile.id,
         display_name: profile.display_name,
         role: profile.role
      },
      personas: personas.rows,
      connected_channels: channels.rows,
      intelligence_stream_cards: streamCards.rows,
      private_chat_history: messages.rows
    };

    reply.header('Content-Disposition', 'attachment; filename="memu_household_export.json"');
    reply.type('application/json');
    return archive;
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

  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
