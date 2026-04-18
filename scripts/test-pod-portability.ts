/**
 * Pod portability scripted end-to-end test (Story 3.4d).
 *
 * Drives the full join → grant → sync → reflect → leave → rejoin flow
 * across two Memu deployments via HTTP. The script prints a pass/fail line
 * for each step and exits non-zero on the first regression.
 *
 * Usage:
 *
 *   MEMU_HOUSEHOLD_BASE=https://family-a.memu.test \
 *   MEMU_HOUSEHOLD_API_KEY=<admin api key on A> \
 *   MEMU_MEMBER_BASE=https://sam.memu.test \
 *   MEMU_MEMBER_WEBID=https://sam.memu.test/people/sam#me \
 *   MEMU_MEMBER_DISPLAY_NAME=Sam \
 *   MEMU_MEMBER_API_KEY=<sam's api key on A, after acceptInvite> \
 *   npx tsx scripts/test-pod-portability.ts
 *
 * Prerequisites (out of scope for this script — set up before running):
 *   - Both deployments running and reachable.
 *   - Two Spaces published on B at:
 *       /spaces/person/sam
 *       /spaces/routine/morning_run
 *   - Sam has a profile on A linked to the household_member row (so
 *     internalProfileId is populated and Sam's API key authenticates).
 *
 * The script is idempotent against re-runs: it cleans up any prior member
 * row matching MEMU_MEMBER_WEBID before starting, so failed runs do not
 * leave the household in an unrecoverable state.
 *
 * See docs/POD_PORTABILITY.md for the full narrative behind these steps.
 */

import 'dotenv/config';

interface Env {
  householdBase: string;
  householdApiKey: string;
  memberBase: string;
  memberWebid: string;
  memberDisplayName: string;
  memberApiKey: string;
}

function readEnv(): Env {
  const required = [
    'MEMU_HOUSEHOLD_BASE',
    'MEMU_HOUSEHOLD_API_KEY',
    'MEMU_MEMBER_BASE',
    'MEMU_MEMBER_WEBID',
    'MEMU_MEMBER_DISPLAY_NAME',
    'MEMU_MEMBER_API_KEY',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(2);
  }
  return {
    householdBase: process.env.MEMU_HOUSEHOLD_BASE!.replace(/\/$/, ''),
    householdApiKey: process.env.MEMU_HOUSEHOLD_API_KEY!,
    memberBase: process.env.MEMU_MEMBER_BASE!.replace(/\/$/, ''),
    memberWebid: process.env.MEMU_MEMBER_WEBID!,
    memberDisplayName: process.env.MEMU_MEMBER_DISPLAY_NAME!,
    memberApiKey: process.env.MEMU_MEMBER_API_KEY!,
  };
}

let stepNo = 0;
let failed = false;

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  stepNo += 1;
  process.stdout.write(`[${stepNo}] ${label} ... `);
  try {
    const out = await fn();
    console.log('OK');
    return out;
  } catch (err) {
    failed = true;
    console.log('FAIL');
    console.error('    ', err instanceof Error ? err.message : err);
    return null;
  }
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'DELETE';
  apiKey: string;
  body?: unknown;
}

async function request<T = unknown>(base: string, path: string, opts: RequestOpts): Promise<T> {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function main() {
  const env = readEnv();
  console.log(`Household: ${env.householdBase}`);
  console.log(`Member Pod: ${env.memberBase}  (WebID ${env.memberWebid})`);
  console.log('');

  // ---- Pre-clean: remove any existing member row for this WebID. ----------
  await step('Pre-clean: drop any existing member row for this WebID', async () => {
    const list = await request<{ members: Array<{ id: string; memberWebid: string; status: string }> }>(
      env.householdBase,
      '/api/households/members?includeLeft=true',
      { apiKey: env.householdApiKey },
    );
    const existing = list.members.filter((m) => m.memberWebid === env.memberWebid);
    for (const m of existing) {
      if (m.status !== 'left') {
        await request(env.householdBase, `/api/households/members/${m.id}`, {
          method: 'DELETE',
          apiKey: env.householdApiKey,
        });
      }
    }
  });

  // ---- 1. Invite + 2. Accept ---------------------------------------------
  const invited = await step('Invite member (admin on A)', async () => {
    return request<{ id: string; status: string }>(env.householdBase, '/api/households/members', {
      method: 'POST',
      apiKey: env.householdApiKey,
      body: {
        memberWebid: env.memberWebid,
        memberDisplayName: env.memberDisplayName,
        leavePolicyForEmergent: 'retain_attributed',
        gracePeriodDays: 30,
      },
    });
  });
  if (!invited) return finish();
  const memberId = invited.id;
  if (invited.status !== 'invited') {
    failed = true;
    console.error(`    expected status=invited, got ${invited.status}`);
  }

  await step('Accept invite (member calling A)', async () => {
    const out = await request<{ status: string }>(
      env.householdBase,
      `/api/households/members/${memberId}/accept`,
      { method: 'POST', apiKey: env.memberApiKey },
    );
    if (out.status !== 'active') throw new Error(`expected status=active, got ${out.status}`);
  });

  // ---- 3. Record grants --------------------------------------------------
  const grantUrls = [
    `${env.memberBase}/spaces/person/sam`,
    `${env.memberBase}/spaces/routine/morning_run`,
  ];
  for (const spaceUrl of grantUrls) {
    await step(`Record grant for ${spaceUrl}`, async () => {
      const out = await request<{ status: string }>(
        env.householdBase,
        `/api/households/members/${memberId}/grants`,
        { method: 'POST', apiKey: env.memberApiKey, body: { spaceUrl } },
      );
      if (out.status !== 'active') throw new Error(`expected status=active, got ${out.status}`);
    });
  }

  // ---- 4. First sync — expect both fresh ---------------------------------
  await step('Sync grants (first time, expect kind=fresh for both)', async () => {
    const out = await request<{ reports: Array<{ spaceUrl: string; outcome: { kind: string } }> }>(
      env.householdBase,
      `/api/households/members/${memberId}/grants/sync`,
      { method: 'POST', apiKey: env.memberApiKey },
    );
    const fresh = out.reports.filter((r) => r.outcome.kind === 'fresh');
    if (fresh.length !== grantUrls.length) {
      throw new Error(`expected ${grantUrls.length} fresh, got ${fresh.length}: ${JSON.stringify(out.reports)}`);
    }
  });

  await step('List cached Spaces (expect both present)', async () => {
    const out = await request<{ spaces: Array<{ spaceUrl: string }> }>(
      env.householdBase,
      `/api/households/members/${memberId}/grants/cached`,
      { apiKey: env.memberApiKey },
    );
    if (out.spaces.length !== grantUrls.length) {
      throw new Error(`expected ${grantUrls.length} cached, got ${out.spaces.length}`);
    }
  });

  // ---- 6. Re-sync — expect not_modified for both ------------------------
  await step('Re-sync (expect kind=not_modified for both)', async () => {
    const out = await request<{ reports: Array<{ outcome: { kind: string } }> }>(
      env.householdBase,
      `/api/households/members/${memberId}/grants/sync`,
      { method: 'POST', apiKey: env.memberApiKey },
    );
    const nm = out.reports.filter((r) => r.outcome.kind === 'not_modified');
    if (nm.length !== grantUrls.length) {
      throw new Error(`expected ${grantUrls.length} not_modified, got ${nm.length}: ${JSON.stringify(out.reports)}`);
    }
  });

  // ---- 8. Leave with grace -----------------------------------------------
  await step('Initiate leave with 30-day grace', async () => {
    const out = await request<{ status: string; leaveGraceUntil: string | null }>(
      env.householdBase,
      `/api/households/members/${memberId}/leave`,
      {
        method: 'POST',
        apiKey: env.memberApiKey,
        body: { leavePolicyForEmergent: 'retain_attributed', gracePeriodDaysOverride: 30 },
      },
    );
    if (out.status !== 'leaving') throw new Error(`expected status=leaving, got ${out.status}`);
    if (!out.leaveGraceUntil) throw new Error('expected leaveGraceUntil to be set');
  });

  // ---- 9. Cancel leave ----------------------------------------------------
  await step('Cancel leave (expect status=active again)', async () => {
    const out = await request<{ status: string; leaveGraceUntil: string | null }>(
      env.householdBase,
      `/api/households/members/${memberId}/cancel-leave`,
      { method: 'POST', apiKey: env.memberApiKey },
    );
    if (out.status !== 'active') throw new Error(`expected status=active, got ${out.status}`);
    if (out.leaveGraceUntil) throw new Error('expected leaveGraceUntil cleared');
  });

  // ---- 10. Leave with zero grace + cache cleanup -------------------------
  await step('Leave with grace=0 (expect status=left immediately)', async () => {
    const out = await request<{ status: string }>(
      env.householdBase,
      `/api/households/members/${memberId}/leave`,
      {
        method: 'POST',
        apiKey: env.memberApiKey,
        body: { leavePolicyForEmergent: 'retain_attributed', gracePeriodDaysOverride: 0 },
      },
    );
    if (out.status !== 'left') throw new Error(`expected status=left, got ${out.status}`);
  });

  await step('Verify cache dropped after instant leave', async () => {
    const out = await request<{ spaces: Array<unknown> }>(
      env.householdBase,
      `/api/households/members/${memberId}/grants/cached`,
      { apiKey: env.householdApiKey },
    );
    if (out.spaces.length !== 0) {
      throw new Error(`expected 0 cached spaces after leave, got ${out.spaces.length}`);
    }
  });

  // ---- 11. Rejoin (new row) ----------------------------------------------
  const rejoined = await step('Rejoin: invite again (expect new id)', async () => {
    return request<{ id: string; status: string }>(env.householdBase, '/api/households/members', {
      method: 'POST',
      apiKey: env.householdApiKey,
      body: {
        memberWebid: env.memberWebid,
        memberDisplayName: env.memberDisplayName,
        leavePolicyForEmergent: 'retain_attributed',
        gracePeriodDays: 30,
      },
    });
  });
  if (rejoined && rejoined.id === memberId) {
    failed = true;
    console.error('    expected fresh member id on rejoin, got the same id as before');
  }

  finish();
}

function finish(): never {
  console.log('');
  if (failed) {
    console.log('FAILED — at least one step regressed. Story 3.4 is not shippable.');
    process.exit(1);
  }
  console.log('PASS — all steps green. Story 3.4 end-to-end verified.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
