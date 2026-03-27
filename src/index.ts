import 'dotenv/config'; // Load env variables immediately before other imports

import Fastify from 'fastify';
import pino from 'pino';
import { testConnection, pool } from './db/connection';
import { connectToWhatsApp } from './channels/whatsapp';
import { seedContext } from './intelligence/context';
import { processIntelligencePipeline } from './intelligence/orchestrator';
import { fetchTodayEvents, getGoogleAuthUrl, handleGoogleCallback } from './channels/calendar/google';
import fastifyStatic from '@fastify/static';
import path from 'path';

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
    return reply.redirect('/dashboard.html?calendarConnected=true');
  } catch (err) {
    server.log.error(err);
    return reply.code(500).send({ error: 'OAuth failed' });
  }
});

// PWA: Today's Brief + Stream Cards Endpoint
server.get('/api/dashboard/brief', async (request, reply) => {
  try {
    const adultRes = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
    if (adultRes.rows.length === 0) return reply.code(500).send({ error: 'System not initialized' });
    const profileId = adultRes.rows[0].id;

    // 1. Fetch live events strictly for today
    const events = await fetchTodayEvents(profileId);
    
    // Convert to standard internal shape for the frontend
    const formattedEvents = events.map((e: any) => ({
      title: e.summary,
      startTime: e.start.dateTime || e.start.date,
      endTime: e.end.dateTime || e.end.date
    }));
    
    // 2. Fetch Active Stream Cards (Empty until Slice 2d)
    const streamRes = await pool.query(
      `SELECT * FROM stream_cards WHERE family_id = $1 AND status = 'active' ORDER BY created_at DESC`, 
      [profileId]
    );

    return { 
      events: formattedEvents,
      streamCards: streamRes.rows
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

// Boot server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3100', 10);
    
    // Initialize required external services
    await testConnection();
    await connectToWhatsApp();

    // Listen on all network interfaces
    await server.listen({ port, host: '0.0.0.0' });
    server.log.info(`🚀 memu-core gateway running on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
