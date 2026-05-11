import { AsyncLocalStorage } from 'node:async_hooks';
import { pool } from './connection';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * Pre-Beta Stream 1 — collective-scoped query helpers.
 *
 * Every query that touches a tenant-scoped table (anything with
 * collective_id, per migration 027) must run inside a transaction with
 * the `memu.collective_id` session variable set to the active
 * collective. RLS policies (migration 028) gate visibility on that
 * variable; a query without it returns zero rows.
 *
 * The active collective is carried in AsyncLocalStorage. The Fastify
 * lifecycle hook in src/index.ts enters a context with the resolved
 * collective at request start; cron jobs and background workers enter
 * explicit contexts via `enterCollectiveContext`.
 *
 * When code calls `db.query` or `db.transaction`:
 *   - If a collective context is active, the call runs inside a
 *     transaction with set_config('memu.collective_id', $1, true).
 *     RLS policies see the collective and gate the query.
 *   - If no collective context is active, the call runs directly via
 *     pool.query. This is the right behaviour for auth-time profile
 *     lookups and OIDC IdP queries against non-tenant-scoped tables.
 *
 * Why AsyncLocalStorage rather than threading collectiveId through
 * every signature: a parameter-passing refactor would touch ~150
 * call sites and every service function in the codebase. Threading
 * is more explicit, but every new function added later has to
 * remember to take the parameter — a missed thread silently
 * returns zero rows under RLS, which is a confusing failure mode.
 * AsyncLocalStorage carries the context automatically across awaits,
 * fire-and-forget promises, and microtask boundaries (it's how
 * OpenTelemetry trace context, Express request context, etc. work).
 */

interface TenantContext {
  collectiveId: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Enter a collective context for the duration of the callback. Used by
 * the request lifecycle hook (every authenticated request enters a
 * context after requireCollective resolves the id) and by cron / batch
 * jobs that iterate over collectives.
 *
 * Nested calls are allowed but the inner context wins for queries
 * inside it. This matches the Postgres semantics — set_config with
 * is_local=true is scoped to the current transaction, and we always
 * use a fresh transaction per `db.query` invocation.
 */
export async function enterCollectiveContext<T>(
  collectiveId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!collectiveId || typeof collectiveId !== 'string') {
    throw new Error(`enterCollectiveContext: invalid collectiveId: ${JSON.stringify(collectiveId)}`);
  }
  return tenantStorage.run({ collectiveId }, fn);
}

/**
 * Synchronously bind the current async-context to a collective. For
 * Fastify preHandlers and other middleware that don't naturally have
 * a wrapping callback. Once called, every db.query / db.transaction
 * call later in the same async chain (including post-handler hooks
 * and fire-and-forget chains) sees this collective.
 *
 * Prefer `enterCollectiveContext(id, fn)` when you have a callback
 * boundary — it's more obviously scoped. Use `bindCollectiveContext`
 * when integrating with a framework whose hook doesn't pass through
 * the rest-of-request execution (Fastify preHandlers are the typical
 * case).
 *
 * Node's AsyncLocalStorage docs flag `enterWith` as more dangerous
 * than `run` because the context persists past the synchronous
 * caller. For Fastify, that's exactly what we want — the context
 * needs to survive until the handler finishes. Each request gets its
 * own async context tree, so contexts don't leak between requests.
 */
export function bindCollectiveContext(collectiveId: string): void {
  if (!collectiveId || typeof collectiveId !== 'string') {
    throw new Error(`bindCollectiveContext: invalid collectiveId: ${JSON.stringify(collectiveId)}`);
  }
  tenantStorage.enterWith({ collectiveId });
}

/**
 * Read the current collective id, or null if no context is active.
 * Most callers should not need this — they should call `db.query` or
 * `db.transaction` and let those check the context. Exposed for
 * diagnostics and for the rare case where a query needs to know
 * whether it's running tenant-scoped (e.g., conditional logging).
 */
export function currentCollectiveId(): string | null {
  return tenantStorage.getStore()?.collectiveId ?? null;
}

/**
 * The canonical query API. Use this in place of `pool.query` for
 * every query in the codebase.
 *
 * If a collective context is active, the query runs inside a fresh
 * transaction with `memu.collective_id` set; RLS policies gate
 * visibility. If no context is active, the query runs directly
 * (via pool.query) — appropriate for auth-time profile lookups and
 * for queries against non-tenant-scoped tables (collectives,
 * oidc_payload, oidc_jwks, schema_migrations).
 *
 * Bypass the context explicitly with `db.queryWithoutTenant` if you
 * have a specific reason to skip tenant scoping inside an active
 * context. Almost no code should need this.
 */
async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    return pool.query<T>(text, params);
  }
  return runInTenantTransaction(ctx.collectiveId, async (client) => {
    return client.query<T>(text, params);
  });
}

/**
 * Bypass the active tenant context and run directly via pool.query.
 *
 * Reserved for queries against Tier-C tables that have no RLS at all
 * (collectives, oidc_payload, oidc_jwks, schema_migrations). For
 * cross-collective reads against profiles (Tier-B), use
 * `queryAsBootstrap` instead — it sets the explicit memu.bootstrap
 * flag the Tier-B policy checks for.
 *
 * If you find yourself reaching for this in a normal request handler,
 * stop and check whether your code path is leaking across the tenant
 * boundary.
 */
async function queryWithoutTenant<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Run a single query in BOOTSTRAP mode — the Tier-B permissive policy
 * on `profiles` checks for `memu.bootstrap = 'true'` and lets the read
 * through regardless of collective context. Use this only for the
 * deliberate cross-collective reads:
 *
 *   - `getProfileByApiKey` (auth.ts) — looking up which profile a
 *     bearer token belongs to, before collective context can be set.
 *   - `requireCollective` (auth.ts) — joining profiles + collectives
 *     to resolve the collective for the resolved profile.
 *   - `signInWithGoogle` steps 1+2 (channels/auth/google-signin.ts) —
 *     finding an existing profile by email or the primary profile.
 *   - `lookupPrimaryProfile` (orchestrator.ts) — WhatsApp ingest
 *     resolution before per-collective processing.
 *   - Cron enumeration of profiles across collectives (index.ts).
 *
 * Bootstrap mode does NOT bypass the strict Tier-A policies (Spaces,
 * messages, lists, etc. all require an exact collective_id match) and
 * does NOT permit cross-collective writes to profiles (the FOR ALL
 * profiles_write policy still requires an exact match for INSERT /
 * UPDATE / DELETE). It only opens reads against profiles.
 *
 * Implementation: opens a fresh transaction, sets the bootstrap flag
 * via set_config(..., true) so it's transaction-local and discarded
 * on COMMIT. Like queryWithoutTenant, this does NOT honour any active
 * collective context — the call is explicitly cross-collective.
 */
async function queryAsBootstrap<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('memu.bootstrap', 'true', true)");
    const result = await client.query<T>(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore — the original error is what matters.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Multi-statement transaction inside the active collective context.
 * If no context is active, throws — multi-statement transactions
 * outside a tenant context are almost always a bug; if you genuinely
 * need one, use a raw `pool.connect()` directly.
 *
 * The callback receives a PoolClient. All queries on that client run
 * inside the same transaction; the collective setting is in scope
 * throughout. On any throw, ROLLBACK; otherwise COMMIT.
 */
async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error('db.transaction requires an active collective context — call enterCollectiveContext first, or use pool.connect() directly for non-tenant transactions');
  }
  return runInTenantTransaction(ctx.collectiveId, fn);
}

/**
 * Multi-statement transaction with an explicit collective — for cron
 * jobs and batch workers that aren't inside an enterCollectiveContext
 * but need atomicity over a sequence of statements.
 */
async function transactionAs<T>(
  collectiveId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return runInTenantTransaction(collectiveId, fn);
}

/**
 * Internal: open a connection, BEGIN, set memu.collective_id (transaction-
 * local so it can't leak when the connection returns to the pool),
 * run fn, COMMIT (or ROLLBACK on error), release. The single point
 * where the RLS session variable is set.
 */
async function runInTenantTransaction<T>(
  collectiveId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('memu.collective_id', $1, true)", [collectiveId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore — the original error is what matters.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The single export. Call sites use `db.query(...)` or
 * `db.transaction(...)` — same shape as `pool.query` / `pool.connect`,
 * just tenant-aware.
 */
export const db = {
  query,
  queryWithoutTenant,
  queryAsBootstrap,
  transaction,
  transactionAs,
};
