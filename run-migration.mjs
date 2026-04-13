import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS synthesis_pages (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        category TEXT NOT NULL CHECK (category IN ('person', 'routine', 'household', 'commitment', 'document')),
        title TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        last_updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(profile_id, category, title)
    );
  `);
  console.log("Migrated synthesis_pages success");
  process.exit(0);
}
run().catch(console.error);
