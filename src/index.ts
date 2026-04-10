import 'dotenv/config'; // Load env variables immediately before other imports

import Fastify from 'fastify';
import pino from 'pino';
import { testConnection, pool } from './db/connection';
import { connectToWhatsApp } from './channels/whatsapp';
import { seedContext } from './intelligence/context';
import { processIntelligencePipeline } from './intelligence/orchestrator';
import { fetchTodayEvents, getGoogleAuthUrl, handleGoogleCallback, createGoogleCalendarEvent } from './channels/calendar/google';
import { generateAndPushMorningBriefing } from './intelligence/briefing';
import { requireAuth, registerProfile } from './auth';
import { importWhatsAppExport, importTextFile, importFileBundle } from './intelligence/import';
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
      body.role || 'adult'
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
  // Skip auth for health, registration, OAuth callback, and static assets
  if (
    url === '/health' ||
    url === '/api/register' ||
    url.startsWith('/api/auth/google/callback') ||
    !url.startsWith('/api/')
  ) {
    return;
  }
  return requireAuth(request, reply);
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
    const responseText = await processIntelligencePipeline(profileId, body.content, 'mobile', messageId);
    return { response: responseText };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Pipeline failed' });
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

// Today's Brief + Stream Cards — uses authenticated profile
server.get('/api/dashboard/brief', async (request, reply) => {
  try {
    const profileId = (request as any).profileId;

    // 1. Fetch Today's Calendar Events
    const events = await fetchTodayEvents(profileId);
    const formattedEvents = events.map(e => ({
      title: e.summary || 'Busy',
      startTime: e.start?.dateTime || e.start?.date || null,
      endTime: e.end?.dateTime || e.end?.date || null
    }));
    
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
      events: formattedEvents,
      streamCards: streamRes.rows,
      shoppingItems: shoppingRes.rows,
      isCalendarConnected
    };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Failed to build brief' });
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

    // WhatsApp is OPTIONAL — mobile app is the primary channel
    try {
      await connectToWhatsApp();
    } catch (err) {
      server.log.warn('WhatsApp connection skipped or failed — mobile app is primary channel');
    }

    // Listen on all network interfaces
    await server.listen({ port: 3100, host: '0.0.0.0' });
    server.log.info(`PWA running at http://localhost:3100`);

    // Slice 3: Schedule Morning Briefing for 7:00 AM Every Day
    // Picks every adult/admin profile that has a linked WhatsApp channel.
    // Runs them sequentially so one bad briefing can't take down the rest.
    cron.schedule('0 7 * * *', async () => {
      server.log.info('Running daily morning briefings...');
      const recipientsRes = await pool.query(`
        SELECT p.id, p.display_name
        FROM profiles p
        INNER JOIN profile_channels pc
          ON pc.profile_id = p.id AND pc.channel = 'whatsapp'
        WHERE p.role IN ('adult', 'admin')
      `);

      if (recipientsRes.rows.length === 0) {
        server.log.warn('No adults with a linked WhatsApp channel — skipping briefings');
        return;
      }

      for (const row of recipientsRes.rows) {
        try {
          server.log.info(`Pushing briefing to ${row.display_name} (${row.id})`);
          await generateAndPushMorningBriefing(row.id);
        } catch (err) {
          server.log.error({ err, profileId: row.id }, 'Briefing failed for profile');
        }
      }
    });

  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
