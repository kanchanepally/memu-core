import 'dotenv/config';
import { pool } from '../src/db/connection';
import { randomUUID } from 'crypto';

async function inject(content: string) {
  try {
    const profileId = '00000000-0000-0000-0000-000000000000'; // Default dev family ID (or your real one)
    // Try to get the real family ID if it exists
    const familyRes = await pool.query('SELECT id FROM profiles LIMIT 1');
    const realProfileId = familyRes.rows[0]?.id || profileId;

    await pool.query(
      `INSERT INTO inbox_messages (id, profile_id, channel, sender_jid, content, is_image) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), realProfileId, 'cli-test', 'user@s.whatsapp.net', content, false]
    );

    console.log(`✅ Successfully injected: "${content}"`);
    console.log(`👉 Now run the trigger URL: http://localhost:3100/api/admin/trigger-briefing`);
  } catch (err) {
    console.error('Failed to inject message:', err);
  } finally {
    await pool.end();
  }
}

const message = process.argv[2];
if (!message) {
  console.log('Please provide a message. Example:');
  console.log('npx tsx scripts/inject-test-message.ts "We need a carpet cleaner bloke"');
  process.exit(1);
}

inject(message);
