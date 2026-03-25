import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL environment variable is not set. Database connection will fail.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export async function testConnection() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT NOW()');
    console.log('✅ PostgreSQL connected:', res.rows[0].now);
  } catch (err) {
    console.error('❌ PostgreSQL connection failed', err);
    throw err;
  } finally {
    client.release();
  }
}
