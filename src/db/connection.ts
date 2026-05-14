import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL environment variable is not set. Database connection will fail.');
}

// Runtime pool — every db.query / db.transaction / queryAsBootstrap call
// in the app uses this. In Hosted (Hetzner) deployments this should
// point at the NOSUPERUSER `memu_app` role created by migration 036 so
// that the RLS policies shipped in migration 028 actually enforce. In
// standalone (Z2) it can still point at the superuser `memu` until the
// operator chooses to flip — RLS is then bypassed, which is acceptable
// for single-household personal use.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Migration pool — checked out only by the migration runner at boot.
// Needs DDL rights (CREATE TABLE, CREATE INDEX, CREATE ROLE) so it
// connects as the superuser. Falls back to DATABASE_URL when
// MEMU_DB_MIGRATE_URL is unset — that's the dev / standalone shape
// where both pools share one role. On Hosted, the two MUST diverge.
export const migrationPool = new Pool({
  connectionString: process.env.MEMU_DB_MIGRATE_URL || process.env.DATABASE_URL
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

/**
 * TD-01 boot assertion.
 *
 * Checks the role used by the runtime pool. If it's SUPERUSER or has
 * the BYPASSRLS attribute, the RLS policies shipped in migration 028
 * are NOT actually enforced — every tenant-scoped query effectively
 * sees the whole database.
 *
 * Behaviour:
 *   - In any deployment, log a structured warning so an operator
 *     glancing at boot output can see they're not getting tenant
 *     isolation.
 *   - When MEMU_REQUIRE_NOSUPERUSER=true (set in Hosted deploy
 *     scripts), the warning becomes a hard error and boot aborts.
 *     This is the production safety net: a misconfigured Hetzner
 *     stack fails closed rather than silently leaking across
 *     tenants.
 *
 * This is best-effort — a query failure does not block boot. If the
 * pg_roles read fails for any reason, we log and move on; the
 * application itself works either way.
 */
export async function assertRuntimeRoleNotSuperuser(): Promise<void> {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>(
      'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    );
    const row = res.rows[0];
    if (!row) {
      console.warn('[BOOT] could not resolve current Postgres role — skipping RLS-enforcement assertion.');
      return;
    }
    const { rolname, rolsuper, rolbypassrls } = row;
    if (!rolsuper && !rolbypassrls) {
      console.log(`✅ Runtime DB role '${rolname}' is NOSUPERUSER + NOBYPASSRLS — RLS policies will enforce.`);
      return;
    }
    const requireStrict = (process.env.MEMU_REQUIRE_NOSUPERUSER || '').toLowerCase() === 'true';
    const reasons: string[] = [];
    if (rolsuper) reasons.push('SUPERUSER');
    if (rolbypassrls) reasons.push('BYPASSRLS');
    const msg =
      `Runtime DB role '${rolname}' has ${reasons.join(' + ')} — RLS policies are NOT enforced. ` +
      `Flip DATABASE_URL to use the memu_app role created by migration 036 (and set MEMU_DB_MIGRATE_URL ` +
      `to the superuser URL for the migration runner).`;
    if (requireStrict) {
      throw new Error('[BOOT][FATAL] ' + msg);
    }
    console.warn('⚠️  [BOOT] ' + msg);
  } catch (err) {
    // Re-throw the strict-mode failure; swallow anything else so the
    // assertion never blocks boot on its own.
    if (err instanceof Error && err.message.startsWith('[BOOT][FATAL]')) throw err;
    console.warn('[BOOT] assertRuntimeRoleNotSuperuser skipped:', err instanceof Error ? err.message : err);
  } finally {
    if (client) client.release();
  }
}
