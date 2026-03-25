import 'dotenv/config'; // Load env variables immediately before other imports

import Fastify from 'fastify';
import pino from 'pino';
import { testConnection } from './db/connection';
import { connectToWhatsApp } from './channels/whatsapp';

// Setup logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

// Create Fastify Gateway
const server = Fastify({
  logger
});

// Health check endpoint (Slice 1 - Step 1)
server.get('/health', async (request, reply) => {
  return { 
    status: 'ok', 
    service: 'memu-core', 
    timestamp: new Date().toISOString() 
  };
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
