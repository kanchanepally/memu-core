import fs from 'fs';
import path from 'path';
import { migrationPool } from './connection';

// Runs migrations/*.sql files in alphabetical order. Each migration is
// expected to be idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
// We track applied migrations in a small table so we don't re-run them.
//
// TD-01 — runs on a single checked-out client from `migrationPool` (the
// superuser connection) so that session GUCs set at the top of the run
// remain in scope for every migration. The `memu.app_password` GUC is
// the load-bearing one: migration 036_app_role.sql reads it via
// current_setting('memu.app_password', true) to set the password on
// the NOSUPERUSER app role. If MEMU_APP_DB_PASSWORD is unset, the GUC
// resolves to NULL and migration 036 emits a NOTICE and skips creation
// (still marked applied — re-run by DELETEing the row after fixing the
// env var).
export async function runMigrations() {
  const client = await migrationPool.connect();
  try {
    // Set session-scoped GUCs that individual migrations consume via
    // current_setting(..., true). is_local=false here means session
    // (not transaction) scope — these survive across the BEGIN/COMMIT
    // boundary of each migration file.
    const appPassword = process.env.MEMU_APP_DB_PASSWORD || '';
    if (appPassword) {
      await client.query("SELECT set_config('memu.app_password', $1, false)", [appPassword]);
    }

    await client.query(`
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
      const existing = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file]
      );
      if (existing.rows.length > 0) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`[MIGRATE] Applying ${file}...`);
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );
      console.log(`[MIGRATE] Applied ${file}`);
    }
  } finally {
    client.release();
  }
}
