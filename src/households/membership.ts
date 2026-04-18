/**
 * Story 3.4a — household membership + per-Space Pod grants service layer.
 *
 * The marriage / immigration flow. An adult whose primary Pod lives elsewhere
 * is invited into a household, accepts the invite, grants this household
 * read access to specific Spaces from their Pod (per-Space consent, not
 * blanket access), and can later leave with a configurable grace period
 * before the leave is finalised.
 *
 * What this module does NOT do (lives in 3.4b/c/d):
 *   - Actually fetch the granted Spaces (3.4b — uses solid_client.fetchExternalSpace)
 *   - Twin-register the foreign WebID (3.4b)
 *   - The mobile UI for Join / Leave a household (3.4c)
 *   - End-to-end two-deployment test against a "Sam" Pod (3.4d)
 *
 * Authorization model (enforced in the route layer, mirrored here for
 * documentation): an admin of the household can invite, list, accept on
 * behalf of, or remove members. The member themselves (when they have an
 * internal_profile_id on this deployment) can record/revoke their own
 * grants and initiate their own leave.
 */

import { pool } from '../db/connection';

export type MemberStatus = 'invited' | 'active' | 'leaving' | 'left';
export type LeavePolicy = 'retain_attributed' | 'anonymise' | 'remove';
export type GrantStatus = 'active' | 'revoked';

export const LEAVE_POLICIES: readonly LeavePolicy[] = ['retain_attributed', 'anonymise', 'remove'] as const;

export interface HouseholdMember {
  id: string;
  householdAdminProfileId: string;
  memberWebid: string;
  memberDisplayName: string;
  internalProfileId: string | null;
  invitedByProfileId: string;
  status: MemberStatus;
  leavePolicyForEmergent: LeavePolicy;
  gracePeriodDays: number;
  invitedAt: Date;
  joinedAt: Date | null;
  leaveInitiatedAt: Date | null;
  leaveGraceUntil: Date | null;
  leftAt: Date | null;
}

export interface PodGrant {
  id: string;
  memberId: string;
  spaceUrl: string;
  status: GrantStatus;
  grantedAt: Date;
  revokedAt: Date | null;
  lastSyncedAt: Date | null;
  lastEtag: string | null;
  lastModifiedHeader: string | null;
}

export class MembershipError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
    this.name = 'MembershipError';
  }
}

// ---------------------------------------------------------------------------
// Pure state-transition rules — testable without a database.
// ---------------------------------------------------------------------------

/**
 * Which target statuses a member may transition into from `from`. The route
 * layer uses this to reject illegal transitions (e.g. accept a left member,
 * leave an invited member) without a round-trip query.
 */
export function allowedNextStatuses(from: MemberStatus): MemberStatus[] {
  switch (from) {
    case 'invited':  return ['active', 'left'];           // accept, or admin removes
    case 'active':   return ['leaving', 'left'];          // initiate leave, or admin removes
    case 'leaving':  return ['active', 'left'];           // cancel leave, or finalise
    case 'left':     return [];                           // terminal
  }
}

export function canTransition(from: MemberStatus, to: MemberStatus): boolean {
  return allowedNextStatuses(from).includes(to);
}

/**
 * Validate a normalised WebID URL. We accept https only — Solid-OIDC bearer
 * verification will fail anything else later, but rejecting here gives a
 * clearer error to the inviting admin.
 */
export function validateWebid(webid: string): { ok: true; normalised: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(webid);
  } catch {
    return { ok: false, reason: 'webid_not_a_url' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'webid_must_be_https' };
  }
  // Accept URLs with or without #me — store as-given so the joiner's
  // identity provider sees the exact form they advertised.
  return { ok: true, normalised: url.toString() };
}

/**
 * Validate a Space URL on an external Pod. Same rules as validateWebid plus
 * we don't care about the fragment (Spaces aren't fragment-addressable).
 */
export function validateSpaceUrl(spaceUrl: string): { ok: true; normalised: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(spaceUrl);
  } catch {
    return { ok: false, reason: 'space_url_not_a_url' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'space_url_must_be_https' };
  }
  url.hash = '';
  return { ok: true, normalised: url.toString() };
}

/**
 * Compute the leave_grace_until timestamp from a base time and a member's
 * grace_period_days. Pure — exposed for tests so we don't need wall-clock
 * fixtures.
 */
export function computeGraceUntil(now: Date, gracePeriodDays: number): Date {
  if (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0) {
    throw new MembershipError('invalid_grace_days', `grace_period_days must be a non-negative integer, got ${gracePeriodDays}`);
  }
  return new Date(now.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
}

/**
 * True when a member in 'leaving' status is past their grace window and
 * the cron should finalise them to 'left'. Pure.
 */
export function isLeaveFinalisable(member: Pick<HouseholdMember, 'status' | 'leaveGraceUntil'>, now: Date): boolean {
  if (member.status !== 'leaving') return false;
  if (!member.leaveGraceUntil) return false;
  return now.getTime() >= member.leaveGraceUntil.getTime();
}

// ---------------------------------------------------------------------------
// DB-touching service functions. Tested via manual QA per story DoD until a
// test database is wired up (same pattern as store.ts, evaluator, etc.).
// ---------------------------------------------------------------------------

interface DbMemberRow {
  id: string;
  household_admin_profile_id: string;
  member_webid: string;
  member_display_name: string;
  internal_profile_id: string | null;
  invited_by_profile_id: string;
  status: MemberStatus;
  leave_policy_for_emergent: LeavePolicy;
  grace_period_days: number;
  invited_at: Date;
  joined_at: Date | null;
  leave_initiated_at: Date | null;
  leave_grace_until: Date | null;
  left_at: Date | null;
}

function rowToMember(row: DbMemberRow): HouseholdMember {
  return {
    id: row.id,
    householdAdminProfileId: row.household_admin_profile_id,
    memberWebid: row.member_webid,
    memberDisplayName: row.member_display_name,
    internalProfileId: row.internal_profile_id,
    invitedByProfileId: row.invited_by_profile_id,
    status: row.status,
    leavePolicyForEmergent: row.leave_policy_for_emergent,
    gracePeriodDays: row.grace_period_days,
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
    leaveInitiatedAt: row.leave_initiated_at,
    leaveGraceUntil: row.leave_grace_until,
    leftAt: row.left_at,
  };
}

interface DbGrantRow {
  id: string;
  member_id: string;
  space_url: string;
  status: GrantStatus;
  granted_at: Date;
  revoked_at: Date | null;
  last_synced_at: Date | null;
  last_etag: string | null;
  last_modified_header: string | null;
}

function rowToGrant(row: DbGrantRow): PodGrant {
  return {
    id: row.id,
    memberId: row.member_id,
    spaceUrl: row.space_url,
    status: row.status,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    lastSyncedAt: row.last_synced_at,
    lastEtag: row.last_etag,
    lastModifiedHeader: row.last_modified_header,
  };
}

export interface InviteMemberInput {
  householdAdminProfileId: string;
  memberWebid: string;
  memberDisplayName: string;
  invitedByProfileId: string;
  internalProfileId?: string | null;
  leavePolicyForEmergent?: LeavePolicy;
  gracePeriodDays?: number;
}

export async function inviteMember(input: InviteMemberInput): Promise<HouseholdMember> {
  const webid = validateWebid(input.memberWebid);
  if (!webid.ok) {
    throw new MembershipError(webid.reason, `Invalid member_webid: ${input.memberWebid}`);
  }
  const policy = input.leavePolicyForEmergent ?? 'retain_attributed';
  if (!LEAVE_POLICIES.includes(policy)) {
    throw new MembershipError('invalid_leave_policy', `leave_policy_for_emergent must be one of ${LEAVE_POLICIES.join(', ')}`);
  }
  const grace = input.gracePeriodDays ?? 30;
  if (!Number.isInteger(grace) || grace < 0) {
    throw new MembershipError('invalid_grace_days', `grace_period_days must be a non-negative integer, got ${grace}`);
  }

  const res = await pool.query<DbMemberRow>(
    `INSERT INTO household_members
       (household_admin_profile_id, member_webid, member_display_name,
        internal_profile_id, invited_by_profile_id,
        leave_policy_for_emergent, grace_period_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.householdAdminProfileId,
      webid.normalised,
      input.memberDisplayName,
      input.internalProfileId ?? null,
      input.invitedByProfileId,
      policy,
      grace,
    ],
  );
  return rowToMember(res.rows[0]);
}

export async function listMembers(
  householdAdminProfileId: string,
  opts: { includeLeft?: boolean } = {},
): Promise<HouseholdMember[]> {
  const where = opts.includeLeft
    ? 'household_admin_profile_id = $1'
    : "household_admin_profile_id = $1 AND status <> 'left'";
  const res = await pool.query<DbMemberRow>(
    `SELECT * FROM household_members WHERE ${where} ORDER BY invited_at ASC`,
    [householdAdminProfileId],
  );
  return res.rows.map(rowToMember);
}

export async function findMember(memberId: string): Promise<HouseholdMember | null> {
  const res = await pool.query<DbMemberRow>(
    'SELECT * FROM household_members WHERE id = $1 LIMIT 1',
    [memberId],
  );
  return res.rows[0] ? rowToMember(res.rows[0]) : null;
}

async function transitionMember(
  memberId: string,
  to: MemberStatus,
  patch: Partial<{ joined_at: Date; leave_initiated_at: Date; leave_grace_until: Date; left_at: Date }>,
): Promise<HouseholdMember> {
  const current = await findMember(memberId);
  if (!current) throw new MembershipError('member_not_found', `No member with id ${memberId}`);
  if (!canTransition(current.status, to)) {
    throw new MembershipError('illegal_transition', `Cannot transition member from ${current.status} to ${to}`);
  }

  const setClauses = ['status = $2'];
  const values: unknown[] = [memberId, to];
  let i = 3;
  for (const [col, val] of Object.entries(patch)) {
    setClauses.push(`${col} = $${i}`);
    values.push(val);
    i++;
  }

  const res = await pool.query<DbMemberRow>(
    `UPDATE household_members SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    values,
  );
  return rowToMember(res.rows[0]);
}

export async function acceptInvite(memberId: string): Promise<HouseholdMember> {
  return transitionMember(memberId, 'active', { joined_at: new Date() });
}

export interface InitiateLeaveInput {
  memberId: string;
  policyOverride?: LeavePolicy;
  gracePeriodDaysOverride?: number;
  now?: Date;
}

export async function initiateLeave(input: InitiateLeaveInput): Promise<HouseholdMember> {
  const current = await findMember(input.memberId);
  if (!current) throw new MembershipError('member_not_found', `No member with id ${input.memberId}`);

  const grace = input.gracePeriodDaysOverride ?? current.gracePeriodDays;
  const now = input.now ?? new Date();
  const graceUntil = computeGraceUntil(now, grace);

  // Update policy if overridden, in the same transition.
  if (input.policyOverride) {
    if (!LEAVE_POLICIES.includes(input.policyOverride)) {
      throw new MembershipError('invalid_leave_policy', `leave_policy_for_emergent must be one of ${LEAVE_POLICIES.join(', ')}`);
    }
    await pool.query(
      'UPDATE household_members SET leave_policy_for_emergent = $1 WHERE id = $2',
      [input.policyOverride, input.memberId],
    );
  }

  return transitionMember(input.memberId, 'leaving', {
    leave_initiated_at: now,
    leave_grace_until: graceUntil,
  });
}

export async function cancelLeave(memberId: string): Promise<HouseholdMember> {
  const current = await findMember(memberId);
  if (!current) throw new MembershipError('member_not_found', `No member with id ${memberId}`);
  if (current.status !== 'leaving') {
    throw new MembershipError('not_leaving', `Member is not in leaving state (current: ${current.status})`);
  }
  // Clear leave timestamps when cancelling.
  await pool.query(
    `UPDATE household_members
        SET leave_initiated_at = NULL, leave_grace_until = NULL
      WHERE id = $1`,
    [memberId],
  );
  return transitionMember(memberId, 'active', {});
}

/**
 * Mark a member as fully left and cascade-revoke all their active grants.
 * Called by the route on admin force-remove and by the cron when grace
 * period expires.
 */
export async function finaliseLeave(memberId: string, now: Date = new Date()): Promise<HouseholdMember> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const memberRes = await client.query<DbMemberRow>(
      'SELECT * FROM household_members WHERE id = $1 FOR UPDATE',
      [memberId],
    );
    if (!memberRes.rows[0]) throw new MembershipError('member_not_found', `No member with id ${memberId}`);
    const current = rowToMember(memberRes.rows[0]);
    if (current.status === 'left') {
      await client.query('ROLLBACK');
      return current;
    }
    if (!canTransition(current.status, 'left')) {
      await client.query('ROLLBACK');
      throw new MembershipError('illegal_transition', `Cannot transition member from ${current.status} to left`);
    }
    await client.query(
      `UPDATE pod_grants SET status = 'revoked', revoked_at = $2
         WHERE member_id = $1 AND status = 'active'`,
      [memberId, now],
    );
    const updated = await client.query<DbMemberRow>(
      `UPDATE household_members
          SET status = 'left', left_at = $2
        WHERE id = $1
        RETURNING *`,
      [memberId, now],
    );
    await client.query('COMMIT');
    return rowToMember(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The cron-friendly batch finaliser: walks every member in 'leaving' whose
 * grace window has expired and finalises them.
 */
export async function finaliseExpiredLeaves(now: Date = new Date()): Promise<HouseholdMember[]> {
  const res = await pool.query<DbMemberRow>(
    `SELECT * FROM household_members
       WHERE status = 'leaving' AND leave_grace_until <= $1`,
    [now],
  );
  const finalised: HouseholdMember[] = [];
  for (const row of res.rows) {
    finalised.push(await finaliseLeave(row.id, now));
  }
  return finalised;
}

// ---------------------------------------------------------------------------
// Pod grants — per-Space external Pod read access from a member to this
// household. Recorded by the member themselves in 3.4c (wizard step); the
// route layer enforces who may call.
// ---------------------------------------------------------------------------

export interface RecordGrantInput {
  memberId: string;
  spaceUrl: string;
}

export async function recordGrant(input: RecordGrantInput): Promise<PodGrant> {
  const url = validateSpaceUrl(input.spaceUrl);
  if (!url.ok) {
    throw new MembershipError(url.reason, `Invalid space_url: ${input.spaceUrl}`);
  }
  const member = await findMember(input.memberId);
  if (!member) throw new MembershipError('member_not_found', `No member with id ${input.memberId}`);
  if (member.status !== 'active' && member.status !== 'invited') {
    throw new MembershipError('member_not_grantable', `Cannot record grant for member in status ${member.status}`);
  }

  // Idempotent: if an active grant already exists, return it.
  const existing = await pool.query<DbGrantRow>(
    `SELECT * FROM pod_grants
       WHERE member_id = $1 AND space_url = $2 AND status = 'active'
       LIMIT 1`,
    [input.memberId, url.normalised],
  );
  if (existing.rows[0]) return rowToGrant(existing.rows[0]);

  const res = await pool.query<DbGrantRow>(
    `INSERT INTO pod_grants (member_id, space_url) VALUES ($1, $2) RETURNING *`,
    [input.memberId, url.normalised],
  );
  return rowToGrant(res.rows[0]);
}

export async function listGrants(
  memberId: string,
  opts: { includeRevoked?: boolean } = {},
): Promise<PodGrant[]> {
  const where = opts.includeRevoked
    ? 'member_id = $1'
    : "member_id = $1 AND status = 'active'";
  const res = await pool.query<DbGrantRow>(
    `SELECT * FROM pod_grants WHERE ${where} ORDER BY granted_at ASC`,
    [memberId],
  );
  return res.rows.map(rowToGrant);
}

export async function revokeGrant(memberId: string, spaceUrl: string): Promise<boolean> {
  const url = validateSpaceUrl(spaceUrl);
  if (!url.ok) {
    throw new MembershipError(url.reason, `Invalid space_url: ${spaceUrl}`);
  }
  const res = await pool.query(
    `UPDATE pod_grants
        SET status = 'revoked', revoked_at = NOW()
      WHERE member_id = $1 AND space_url = $2 AND status = 'active'`,
    [memberId, url.normalised],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Update cache hints after a successful fetch of a granted Space (3.4b
 * uses this). No-op if the grant isn't active.
 */
export async function recordGrantSync(
  memberId: string,
  spaceUrl: string,
  meta: { etag?: string | null; lastModified?: string | null; syncedAt?: Date },
): Promise<boolean> {
  const url = validateSpaceUrl(spaceUrl);
  if (!url.ok) return false;
  const res = await pool.query(
    `UPDATE pod_grants
        SET last_synced_at = $3,
            last_etag = $4,
            last_modified_header = $5
      WHERE member_id = $1 AND space_url = $2 AND status = 'active'`,
    [
      memberId,
      url.normalised,
      meta.syncedAt ?? new Date(),
      meta.etag ?? null,
      meta.lastModified ?? null,
    ],
  );
  return (res.rowCount ?? 0) > 0;
}
