import fs from 'fs';
import path from 'path';
import { pool } from './connection';

// Runs migrations/*.sql files in alphabetical order. Each migration is
// expected to be idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
// We track applied migrations in a small table so we don't re-run them.
export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const existing = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (existing.rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`[MIGRATE] Applying ${file}...`);
    await pool.query(sql);
    await pool.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [file]
    );
    console.log(`[MIGRATE] Applied ${file}`);
  }
}
