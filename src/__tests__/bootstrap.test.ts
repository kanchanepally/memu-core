/**
 * Pre-Beta Stream 1 — bootstrap-flow integration tests.
 *
 * The audit phase didn't catch that registerProfile + signInWithGoogle's
 * first-boot path were broken under migration 026's NOT NULL constraint
 * because Hareesh's existing data is backfilled — every existing profile
 * already has a collective_id, so the production-tested code paths never
 * exercise INSERT-with-NULL-collective-id-then-UPDATE.
 *
 * These tests exercise the three distinct profile-creation flows
 * against a fresh database state, catching the class of bug where the
 * bootstrap transaction's circular FK + NOT NULL invariant + RLS
 * WITH CHECK conspire against any of the obvious-looking inserts.
 *
 *   Test 1 — registerProfile, no options.collectiveId
 *            → registerPrimaryCollectiveAndProfile flow.
 *            Assert profile + collective + persona all exist with
 *            correct linkage. collective.primary_admin_profile_id
 *            points back at the profile; profile.collective_id points
 *            at the collective.
 *
 *   Test 2 — signInWithGoogle, empty DB (no existing profiles)
 *            → first-boot branch. Same assertion shape as Test 1
 *            but exercising the Google-OAuth creation path.
 *
 *   Test 3 — registerProfile with options.collectiveId set on a
 *            collective that already exists
 *            → inviteProfileToExistingCollective flow. Caller is
 *            inside the inviting admin's collective context. Assert
 *            new profile linked to existing collective; collective's
 *            primary_admin remains the inviter, NOT the invitee.
 *
 * Cleanup: each test creates collective(s) prefixed with a unique
 * marker and removes them in afterEach. A test failure that leaves
 * rows behind is recoverable manually by `DELETE FROM collectives
 * WHERE name LIKE 'BOOTSTRAP_TEST_%'`.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { registerProfile } from '../auth';
import { signInWithGoogle, type GoogleIdentity } from '../channels/auth/google-signin';
import { enterCollectiveContext } from '../db/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const SHOULD_RUN = !!DATABASE_URL;

describe.skipIf(!SHOULD_RUN)('bootstrap flows — collective + profile creation', () => {
  let setupPool: Pool;
  const testMarker = `BOOTSTRAP_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    setupPool = new Pool({ connectionString: DATABASE_URL });
  });

  // Verification helper — runs a SELECT inside a transaction with the
  // collective context set, so RLS lets the query see tenant-scoped rows.
  // Use this for any read against profiles/personas/entity_registry/etc.
  // in the test verifications. SELECTs against collectives (Tier-C) can
  // use setupPool.query directly.
  async function selectInContext<R extends Record<string, any> = any>(
    collectiveId: string,
    sql: string,
    params: any[] = [],
  ): Promise<{ rowCount: number; rows: R[] }> {
    const client = await setupPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('memu.collective_id', $1, true)", [collectiveId]);
      const res = await client.query<R>(sql, params);
      await client.query('COMMIT');
      return { rowCount: res.rowCount ?? 0, rows: res.rows };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  afterEach(async () => {
    // Per-collective cleanup with context set so RLS lets the DELETEs
    // actually find the rows. Without context, DELETEs match zero rows
    // and the collective DELETE then fails on FK references.
    const client = await setupPool.connect();
    try {
      // collectives is Tier-C (no RLS) — list directly.
      const hhRes = await client.query<{ id: string }>(
        `SELECT id FROM collectives WHERE name LIKE $1`,
        [`%${testMarker}%`],
      );
      const hhIds = hhRes.rows.map(r => r.id);
      for (const hh of hhIds) {
        // Both FKs (collectives.primary_admin_profile_id → profiles,
        // profiles.collective_id → collectives) are DEFERRABLE INITIALLY
        // DEFERRED per migration 026. They validate at COMMIT, so the
        // deletes have to happen in the SAME transaction or the
        // surviving row violates its FK to the deleted one.
        await client.query('BEGIN');
        await client.query("SELECT set_config('memu.collective_id', $1, true)", [hh]);
        await client.query(`DELETE FROM personas WHERE collective_id = $1`, [hh]);
        await client.query(`DELETE FROM entity_registry WHERE collective_id = $1`, [hh]);
        await client.query(`DELETE FROM profiles WHERE collective_id = $1`, [hh]);
        await client.query(`DELETE FROM collectives WHERE id = $1`, [hh]);
        await client.query('COMMIT');
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (setupPool) await setupPool.end();
  });

  it('Flow A: registerProfile creates collective + primary profile in one transaction', async () => {
    const displayName = `${testMarker}_PrimaryAdmin`;
    const email = `${testMarker}_primary@example.test`;

    const profile = await registerProfile(
      displayName,
      email,
      'adult',
      '',
      { allowExisting: false }, // bypass the legacy backstop so we genuinely create
    );

    expect(profile).toBeDefined();
    expect(profile.id).toBeDefined();
    expect(profile.collective_id).toBeDefined();
    expect(profile.api_key).toMatch(/^memu_/);

    // Verify collective exists and points back at the profile
    const hh = await setupPool.query<{ id: string; name: string; primary_admin_profile_id: string; status: string }>(
      `SELECT id, name, primary_admin_profile_id, status FROM collectives WHERE id = $1`,
      [profile.collective_id],
    );
    expect(hh.rowCount).toBe(1);
    expect(hh.rows[0].primary_admin_profile_id).toBe(profile.id);
    expect(hh.rows[0].status).toBe('active');
    expect(hh.rows[0].name).toContain(displayName);

    // Profile points back at the collective — context required for RLS
    const p = await selectInContext<{ id: string; collective_id: string; display_name: string }>(
      profile.collective_id,
      `SELECT id, collective_id, display_name FROM profiles WHERE id = $1`,
      [profile.id],
    );
    expect(p.rowCount).toBe(1);
    expect(p.rows[0].collective_id).toBe(profile.collective_id);
    expect(p.rows[0].display_name).toBe(displayName);

    // Persona row was created with the collective_id
    const personas = await selectInContext<{ persona_label: string; collective_id: string }>(
      profile.collective_id,
      `SELECT persona_label, collective_id FROM personas WHERE profile_id = $1`,
      [profile.id],
    );
    expect(personas.rowCount).toBeGreaterThan(0);
    expect(personas.rows[0].collective_id).toBe(profile.collective_id);

    // entity_registry self-row exists
    const entries = await selectInContext<{ real_name: string; collective_id: string }>(
      profile.collective_id,
      `SELECT real_name, collective_id FROM entity_registry WHERE collective_id = $1 AND detected_by = 'onboarding'`,
      [profile.collective_id],
    );
    expect(entries.rowCount).toBeGreaterThan(0);
    expect(entries.rows.some(r => r.real_name === displayName)).toBe(true);
  });

  it('Flow A via Google: signInWithGoogle creates collective + primary profile on first boot', async () => {
    // signInWithGoogle's "first boot" branch is reached when no profile
    // exists yet. Skip if the DB is not empty (a real test run on
    // Hareesh's data, for instance, would have his profile sitting
    // there). The skip is to avoid muddying real deployments; in CI
    // against an empty test DB this runs.
    const profileCount = await setupPool.query<{ count: string }>('SELECT COUNT(*) AS count FROM profiles');
    if (parseInt(profileCount.rows[0].count, 10) > 0) {
      // We're not in a clean-DB state. Test the path differently —
      // skip this case but record it so the test result tells us we
      // weren't run in the right environment.
      console.warn(
        '[bootstrap.test.ts] Skipping signInWithGoogle first-boot test: DB has %s profile(s). Run against a fresh DB to exercise this path.',
        profileCount.rows[0].count,
      );
      return;
    }

    const identity: GoogleIdentity = {
      sub: `${testMarker}_sub`,
      email: `${testMarker}_google@example.test`,
      name: `${testMarker}_GoogleUser`,
    };

    const profile = await signInWithGoogle(identity);

    expect(profile).toBeDefined();
    expect(profile.id).toBeDefined();
    expect(profile.collective_id).toBeDefined();
    expect(profile.email).toBe(identity.email);

    // Same shape of post-conditions as Flow A above
    const hh = await setupPool.query<{ primary_admin_profile_id: string; status: string }>(
      `SELECT primary_admin_profile_id, status FROM collectives WHERE id = $1`,
      [profile.collective_id],
    );
    expect(hh.rowCount).toBe(1);
    expect(hh.rows[0].primary_admin_profile_id).toBe(profile.id);
    expect(hh.rows[0].status).toBe('active');

    const entries = await selectInContext<{ detected_by: string }>(
      profile.collective_id,
      `SELECT detected_by FROM entity_registry WHERE collective_id = $1`,
      [profile.collective_id],
    );
    // The self-row inserted by signInWithGoogle is marked 'google_signin'
    expect(entries.rows.some(r => r.detected_by === 'google_signin')).toBe(true);
  });

  it('Flow B: registerProfile with collectiveId joins existing collective', async () => {
    // First create a collective + admin via Flow A
    const adminName = `${testMarker}_Admin`;
    const admin = await registerProfile(adminName, `${testMarker}_admin@example.test`, 'adult', '', { allowExisting: false });
    const collectiveId = admin.collective_id;

    // Now invite a second profile into that collective. The invite path
    // requires the caller to be inside the collective's context (real
    // production flow: the admin is in their authenticated request,
    // requireCollective has set the context). We replicate that with
    // enterCollectiveContext.
    const inviteeName = `${testMarker}_Invitee`;
    const inviteeEmail = `${testMarker}_invitee@example.test`;

    const invitee = await enterCollectiveContext(collectiveId, async () => {
      return registerProfile(
        inviteeName,
        inviteeEmail,
        'adult',
        '',
        { allowExisting: false, collectiveId },
      );
    });

    expect(invitee).toBeDefined();
    expect(invitee.id).toBeDefined();
    expect(invitee.id).not.toBe(admin.id);
    expect(invitee.collective_id).toBe(collectiveId);

    // The collective's primary_admin_profile_id is STILL the inviter, NOT the invitee
    const hh = await setupPool.query<{ primary_admin_profile_id: string }>(
      `SELECT primary_admin_profile_id FROM collectives WHERE id = $1`,
      [collectiveId],
    );
    expect(hh.rows[0].primary_admin_profile_id).toBe(admin.id);

    // Both profiles point at the same collective
    const profiles = await selectInContext<{ id: string; collective_id: string }>(
      collectiveId,
      `SELECT id, collective_id FROM profiles WHERE id = ANY($1)`,
      [[admin.id, invitee.id]],
    );
    expect(profiles.rowCount).toBe(2);
    expect(profiles.rows.every(p => p.collective_id === collectiveId)).toBe(true);

    // Invitee gets their own persona row in the same collective
    const personas = await selectInContext<{ profile_id: string; collective_id: string }>(
      collectiveId,
      `SELECT profile_id, collective_id FROM personas WHERE collective_id = $1`,
      [collectiveId],
    );
    expect(personas.rowCount).toBe(2); // one for admin, one for invitee
    expect(personas.rows.every(p => p.collective_id === collectiveId)).toBe(true);
  });

  it('Flow B: invite into non-existent collective is rejected', async () => {
    // Defence-in-depth: even if a caller manages to call the invite
    // path with a bogus collective id, we throw rather than create a
    // profile with a dangling FK. The deferred FK would catch it at
    // COMMIT, but the explicit lookup gives a cleaner error message.
    const fakeCollectiveId = 'nonexistent-collective-' + Date.now();
    await expect(
      enterCollectiveContext(fakeCollectiveId, async () => {
        return registerProfile(
          `${testMarker}_BadInvitee`,
          `${testMarker}_bad@example.test`,
          'adult',
          '',
          { allowExisting: false, collectiveId: fakeCollectiveId },
        );
      }),
    ).rejects.toThrow(/collective not found|collective not active/);
  });
});
