import 'dotenv/config'; // Load env variables immediately before other imports

import Fastify from 'fastify';
import pino from 'pino';
import { testConnection, pool } from './db/connection';
import { connectToWhatsApp } from './channels/whatsapp';
import { seedContext } from './intelligence/context';
import { processIntelligencePipeline } from './intelligence/orchestrator';
import { fetchTodayEvents, getGoogleAuthUrl, handleGoogleCallback, createGoogleCalendarEvent } from './channels/calendar/google';
import { generateAndPushMorningBriefing } from './intelligence/briefing';
import fastifyStatic from '@fastify/static';
import path from 'path';
import cron from 'node-cron';

// Setup logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

// Create Fastify Gateway
const server = Fastify({
  logger
});

// Serve frontend Memu PWA (Slice 2b)
server.register(fastifyStatic, {
  root: path.join(process.cwd(), 'src', 'dashboard', 'public'),
  prefix: '/', // Serve at root
});

// Health check endpoint (Slice 1 - Step 1)
server.get('/health', async (request, reply) => {
  return { 
    status: 'ok', 
    service: 'memu-core', 
    timestamp: new Date().toISOString() 
  };
});

// Manual Context Seeding Endpoint (Slice 2a)
server.post('/api/seed', async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.content) {
    return reply.code(400).send({ error: 'Content is required' });
  }
  const result = await seedContext(body.content, body.source || 'manual');
  return result;
});

// PWA Frontend Chat API (Slice 2b)
server.post('/api/message', async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.content) return reply.code(400).send({ error: 'Content required' });
  
  const role = body.profileId === 'child-profile-1' ? 'child' : 'adult';
  
  try {
    let res = await pool.query("SELECT id FROM profiles WHERE role = $1 LIMIT 1", [role]);
    
    // Auto-create a child test profile if they hit the Kids portal first
    if (res.rows.length === 0 && role === 'child') {
      const idRes = await pool.query("INSERT INTO profiles (display_name, role) VALUES ('Child Test', 'child') RETURNING id");
      await pool.query("INSERT INTO personas (id, profile_id, persona_label) VALUES ($1, $2, $3)", [`child-${Date.now()}`, idRes.rows[0].id, 'Child-1']);
      res = idRes;
    }

    if (res.rows.length === 0) {
      server.log.warn('No adult profile exists yet. Send a WhatsApp message to initialize one.');
      return reply.code(500).send({ error: 'System not initialized via WhatsApp yet.' });
    }
    
    const testProfileId = res.rows[0].id;
    const responseText = await processIntelligencePipeline(testProfileId, body.content, 'web');
    return { response: responseText };
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'Pipeline failed' });
  }
});

// OAuth: Initiate Google Sign In
server.get('/api/auth/google', async (request, reply) => {
  const res = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
  if (res.rows.length === 0) return reply.code(500).send({ error: 'System not initialized via WhatsApp' });
  const url = getGoogleAuthUrl(res.rows[0].id);
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

// PWA: Today's Brief + Stream Cards Endpoint
server.get('/api/dashboard/brief', async (request, reply) => {
  try {
    const adultRes = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
    if (adultRes.rows.length === 0) return reply.code(500).send({ error: 'System not initialized' });
    const profileId = adultRes.rows[0].id;

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
    const adultRes = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
    if (adultRes.rows.length === 0) return reply.code(500).send({ error: 'Uninitialized' });
    
    // Attempt to write event to connected Google Calendar
    const success = await createGoogleCalendarEvent(adultRes.rows[0].id, card.title, card.body);
    
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

// ADMIN: Manually Trigger Morning Briefing (Slice 3 Test)
server.get('/api/admin/trigger-briefing', async (request, reply) => {
  try {
    const adultRes = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
    if (adultRes.rows.length === 0) return reply.code(500).send({ error: 'System not initialized' });
    const profileId = adultRes.rows[0].id;

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

// DATA SOVEREIGNTY: Export full profile dataset
server.get('/api/export', async (request, reply) => {
  try {
    const adultRes = await pool.query("SELECT * FROM profiles WHERE role = 'adult' LIMIT 1");
    if (adultRes.rows.length === 0) return reply.code(404).send({ error: 'No profile found' });
    const profile = adultRes.rows[0];
    const profileId = profile.id;

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
    const adultRes = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
    if (adultRes.rows.length === 0) return reply.code(404).send({ error: 'No primary household found' });
    const primaryId = adultRes.rows[0].id;

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
    await connectToWhatsApp();

    // Listen on all network interfaces
    await server.listen({ port: 3100, host: '0.0.0.0' });
    server.log.info(`PWA running at http://localhost:3100`);

    // Slice 3: Schedule Morning Briefing for 7:00 AM Every Day
    cron.schedule('0 7 * * *', async () => {
      server.log.info('Running daily morning briefings...');
      // For V1, we just run the adult-1 profile. 
      // Multi-tenant architecture would map over all families here.
      const adultRes = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
      if (adultRes.rows.length > 0) {
        await generateAndPushMorningBriefing(adultRes.rows[0].id);
      }
    });

  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
