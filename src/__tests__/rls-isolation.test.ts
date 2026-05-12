/**
 * Pre-Beta Stream 1 — RLS isolation tests.
 *
 * The load-bearing safety check for the whole stream: prove that two
 * collectives on the same database cannot see each other's data, that
 * a session with no collective context sees nothing tenant-scoped, and
 * that INSERTs are gated by the same collective match.
 *
 * These tests skip gracefully when DATABASE_URL is not set (the unit
 * tests in the rest of the suite are pure-logic and don't need a DB;
 * this file is the integration check). When the DB is available, the
 * tests create temp collectives, insert distinguishable rows, and
 * exercise db.query / db.transaction across context boundaries.
 *
 * Cleanup: each test wraps its writes in a collective it creates and
 * then deletes (cascading). A test failure that leaves rows behind
 * is recoverable by manually dropping the test collectives' rows;
 * the test schema is the same as production.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import crypto from 'crypto';
import { db, enterCollectiveContext, currentCollectiveId } from '../db/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const SHOULD_RUN = !!DATABASE_URL;

// Top-level conditional describe — vitest runs when DATABASE_URL is set,
// otherwise the entire suite is skipped with a clear message.
describe.skipIf(!SHOULD_RUN)('RLS collective isolation', () => {
  // We use the production pool through a separate Pool instance for
  // setup/teardown so we can bypass RLS deliberately during fixture
  // setup. The `db` singleton goes through the AsyncLocalStorage-aware
  // wrapper.
  let setupPool: Pool;
  let collectives: { hh1: string; hh2: string; profile1: string; profile2: string };

  beforeAll(async () => {
    setupPool = new Pool({ connectionString: DATABASE_URL });

    // Create two collectives with one profile each. Wrap in a single
    // transaction so we either get both or neither.
    //
    // Pre-026 the test inserted profiles without collective_id and
    // backfilled with UPDATE. After 026 made collective_id NOT NULL,
    // we use the same pattern as registerPrimaryCollectiveAndProfile:
    // pre-generate collective UUID, INSERT profile pointing at it
    // (deferred FK lets this through), then INSERT collective. Both
    // circular FKs validate at COMMIT.
    //
    // We also need to set memu.collective_id to the pre-generated value
    // before the profile INSERT — the profiles_write WITH CHECK in
    // 028 requires it. SET LOCAL discards on COMMIT so it doesn't
    // leak when the connection returns to the pool.
    const client = await setupPool.connect();
    try {
      await client.query('BEGIN');

      // Profile 1 + collective 1
      const profile1 = crypto.randomUUID();
      const hh1 = crypto.randomUUID();
      await client.query("SELECT set_config('memu.collective_id', $1, true)", [hh1]);
      await client.query(
        `INSERT INTO profiles (id, display_name, role, api_key, collective_id)
         VALUES ($1, 'RLS Test 1', 'adult', 'memu_rls_test_1_' || gen_random_uuid()::text, $2)`,
        [profile1, hh1],
      );
      await client.query(
        `INSERT INTO collectives (id, type, name, primary_admin_profile_id)
         VALUES ($1, 'household', 'RLS Test Household 1', $2)`,
        [hh1, profile1],
      );

      // Profile 2 + collective 2 — switch the session var to hh2 first
      // so the second profile's WITH CHECK passes against its own
      // collective.
      const profile2 = crypto.randomUUID();
      const hh2 = crypto.randomUUID();
      await client.query("SELECT set_config('memu.collective_id', $1, true)", [hh2]);
      await client.query(
        `INSERT INTO profiles (id, display_name, role, api_key, collective_id)
         VALUES ($1, 'RLS Test 2', 'adult', 'memu_rls_test_2_' || gen_random_uuid()::text, $2)`,
        [profile2, hh2],
      );
      await client.query(
        `INSERT INTO collectives (id, type, name, primary_admin_profile_id)
         VALUES ($1, 'household', 'RLS Test Household 2', $2)`,
        [hh2, profile2],
      );

      // Switch session var to hh1 for the hh1 fixtures (RLS WITH CHECK).
      await client.query("SELECT set_config('memu.collective_id', $1, true)", [hh1]);
      await client.query(
        `INSERT INTO stream_cards (family_id, collective_id, card_type, title, body, source, status)
         VALUES ($1, $2, 'reminder', 'HH1 only — RLS test', 'private to HH1', 'manual', 'active')`,
        [profile1, hh1],
      );
      await client.query(
        `INSERT INTO synthesis_pages (id, profile_id, family_id, collective_id, uri, slug, category, title, body_markdown, last_updated_at)
         VALUES ($1, $2, $2, $3, $4, 'rls-test-1', 'household', 'RLS Test Space 1', 'HH1 body', NOW())`,
        ['rls-test-space-1-' + Date.now(), profile1, hh1, 'memu://' + profile1 + '/household/rls-test-space-1'],
      );

      // Switch to hh2 for the hh2 fixtures.
      await client.query("SELECT set_config('memu.collective_id', $1, true)", [hh2]);
      await client.query(
        `INSERT INTO stream_cards (family_id, collective_id, card_type, title, body, source, status)
         VALUES ($1, $2, 'reminder', 'HH2 only — RLS test', 'private to HH2', 'manual', 'active')`,
        [profile2, hh2],
      );
      await client.query(
        `INSERT INTO synthesis_pages (id, profile_id, family_id, collective_id, uri, slug, category, title, body_markdown, last_updated_at)
         VALUES ($1, $2, $2, $3, $4, 'rls-test-2', 'household', 'RLS Test Space 2', 'HH2 body', NOW())`,
        ['rls-test-space-2-' + Date.now(), profile2, hh2, 'memu://' + profile2 + '/household/rls-test-space-2'],
      );

      await client.query('COMMIT');
      collectives = { hh1, hh2, profile1, profile2 };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!setupPool || !collectives) return;
    // Per-collective cleanup, RLS-aware. Without setting
    // memu.collective_id per delete, the policies filter rows out and
    // the collective DELETE then fails on FK references that the
    // earlier (silently-zero-rows) deletes didn't actually remove.
    const client = await setupPool.connect();
    try {
      await client.query('BEGIN');
      for (const hh of [collectives.hh1, collectives.hh2]) {
        await client.query("SELECT set_config('memu.collective_id', $1, true)", [hh]);
        await client.query(`DELETE FROM stream_cards WHERE collective_id = $1`, [hh]);
        await client.query(`DELETE FROM synthesis_pages WHERE collective_id = $1`, [hh]);
        await client.query(`DELETE FROM personas WHERE collective_id = $1`, [hh]);
        await client.query(`DELETE FROM entity_registry WHERE collective_id = $1`, [hh]);
        await client.query(`DELETE FROM profiles WHERE collective_id = $1`, [hh]);
      }
      // collectives is Tier-C (no RLS) — no context needed.
      await client.query(
        `DELETE FROM collectives WHERE id IN ($1, $2)`,
        [collectives.hh1, collectives.hh2],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    await setupPool.end();
  });

  it('returns only HH1 stream_cards when context is HH1', async () => {
    await enterCollectiveContext(collectives.hh1, async () => {
      const res = await db.query<{ title: string }>(
        `SELECT title FROM stream_cards WHERE title LIKE 'HH%'`,
      );
      const titles = res.rows.map(r => r.title);
      expect(titles).toContain('HH1 only — RLS test');
      expect(titles).not.toContain('HH2 only — RLS test');
    });
  });

  it('returns only HH2 stream_cards when context is HH2', async () => {
    await enterCollectiveContext(collectives.hh2, async () => {
      const res = await db.query<{ title: string }>(
        `SELECT title FROM stream_cards WHERE title LIKE 'HH%'`,
      );
      const titles = res.rows.map(r => r.title);
      expect(titles).toContain('HH2 only — RLS test');
      expect(titles).not.toContain('HH1 only — RLS test');
    });
  });

  it('returns zero rows when no collective context is set', async () => {
    // No enterCollectiveContext wrapper — db.query falls through to
    // pool.query without a context. RLS still applies because of FORCE,
    // and the policy's USING clause evaluates to false (NULL = anything
    // is false).
    expect(currentCollectiveId()).toBeNull();
    const res = await db.query<{ title: string }>(
      `SELECT title FROM stream_cards WHERE title LIKE 'HH%'`,
    );
    expect(res.rows.length).toBe(0);
  });

  it('rejects INSERT into stream_cards when collective_id mismatches active context', async () => {
    await expect(
      enterCollectiveContext(collectives.hh1, async () => {
        // Try to insert a card with HH2's collective_id while context is HH1.
        // RLS WITH CHECK should fail this; we expect a thrown error.
        await db.query(
          `INSERT INTO stream_cards (family_id, collective_id, card_type, title, body, source, status)
           VALUES ($1, $2, 'reminder', 'cross-tenant write attempt', 'should not appear', 'manual', 'active')`,
          [collectives.profile1, collectives.hh2],
        );
      }),
    ).rejects.toThrow(/row[- ]level security|new row violates/i);
  });

  it('synthesis_pages also isolated by collective_id', async () => {
    const titles1 = await enterCollectiveContext(collectives.hh1, async () => {
      const r = await db.query<{ title: string }>(
        `SELECT title FROM synthesis_pages WHERE title LIKE 'RLS Test Space%'`,
      );
      return r.rows.map(row => row.title);
    });
    const titles2 = await enterCollectiveContext(collectives.hh2, async () => {
      const r = await db.query<{ title: string }>(
        `SELECT title FROM synthesis_pages WHERE title LIKE 'RLS Test Space%'`,
      );
      return r.rows.map(row => row.title);
    });

    expect(titles1).toContain('RLS Test Space 1');
    expect(titles1).not.toContain('RLS Test Space 2');
    expect(titles2).toContain('RLS Test Space 2');
    expect(titles2).not.toContain('RLS Test Space 1');
  });

  it('profiles strict policy: with NO context, profile reads return zero rows', async () => {
    // C1 design change (2026-05-10): the OLD Tier-B policy was
    // "no context = all profiles visible" which let any code path
    // that forgot to set context read every profile in the deployment.
    // That was security-by-convention. The new policy requires an
    // explicit `memu.bootstrap` flag (set by db.queryAsBootstrap)
    // for cross-collective profile reads. Anywhere else, reads with
    // no context return zero rows. Mechanical, not conventional.
    //
    // Auth-flow callers that legitimately need cross-collective reads
    // (getProfileByApiKey, requireCollective's join, signInWithGoogle
    // steps 1+2, lookupPrimaryProfile, cron enumeration) all use
    // db.queryAsBootstrap — covered by the test below.
    expect(currentCollectiveId()).toBeNull();
    const res = await db.query<{ id: string; collective_id: string }>(
      `SELECT id, collective_id FROM profiles WHERE id IN ($1, $2)`,
      [collectives.profile1, collectives.profile2],
    );
    expect(res.rows.length).toBe(0);
  });

  it('profiles strict policy: with context set, only same-collective profiles visible', async () => {
    await enterCollectiveContext(collectives.hh1, async () => {
      const res = await db.query<{ id: string }>(
        `SELECT id FROM profiles WHERE id IN ($1, $2)`,
        [collectives.profile1, collectives.profile2],
      );
      const ids = res.rows.map(r => r.id);
      expect(ids).toContain(collectives.profile1);
      expect(ids).not.toContain(collectives.profile2);
    });
  });

  it('profiles strict write policy: rejects cross-collective profile INSERT', async () => {
    // The Tier-B profiles_write policy is FOR ALL with USING + WITH CHECK
    // both requiring collective match. Even though profiles_read permits
    // bootstrap-mode reads, writes never get the bootstrap shortcut —
    // a profile cannot be created in a collective other than the active
    // context's. This is the asymmetry that makes the bootstrap flag
    // safe.
    await expect(
      enterCollectiveContext(collectives.hh1, async () => {
        await db.query(
          `INSERT INTO profiles (display_name, role, api_key, collective_id)
           VALUES ('cross-tenant write attempt', 'adult', 'memu_should_not_persist', $1)`,
          [collectives.hh2],
        );
      }),
    ).rejects.toThrow(/row[- ]level security|new row violates/i);
  });

  it('profiles bootstrap mode: queryAsBootstrap returns rows across collectives', async () => {
    // The auth-flow contract — getProfileByApiKey, signInWithGoogle,
    // requireCollective all need to find a profile by an identifier
    // (api_key, email, id) before they can know which collective to
    // enter. queryAsBootstrap sets the explicit memu.bootstrap flag
    // so the Tier-B policy lets them through.
    const res = await db.queryAsBootstrap<{ id: string }>(
      `SELECT id FROM profiles WHERE id IN ($1, $2)`,
      [collectives.profile1, collectives.profile2],
    );
    const ids = res.rows.map(r => r.id);
    expect(ids).toContain(collectives.profile1);
    expect(ids).toContain(collectives.profile2);
  });

  it('profiles bootstrap mode: does NOT permit cross-collective writes', async () => {
    // Bootstrap is a READ permission only. The FOR ALL profiles_write
    // policy still gates INSERTs/UPDATEs/DELETEs on collective match.
    // Even with the bootstrap flag set, a write to another collective
    // is rejected.
    await expect(
      db.queryAsBootstrap(
        `INSERT INTO profiles (display_name, role, api_key, collective_id)
         VALUES ('bootstrap write attempt', 'adult', 'memu_should_not_persist_2', $1)`,
        [collectives.hh2],
      ),
    ).rejects.toThrow(/row[- ]level security|new row violates/i);
  });
});
