/**
 * Build Spec 2 Phase Z Story Z.6b — per-(profile, space) reading state.
 *
 * Wraps the space_reading_state sidecar table (migration 048) behind
 * a thin functional API. Callers go through these helpers; nobody
 * touches the table directly outside this module.
 *
 * Today's slice records open-time only — `recordRead(profileId,
 * spaceId)` bumps last_read_at to NOW(). The read_progress column
 * exists and is preserved on UPSERT (we don't clobber a real progress
 * value with 0 when re-opening), but no caller updates it yet —
 * scroll-position tracking lands in a follow-up.
 *
 * RLS scopes every query to the active Collective; recordRead also
 * implicitly enforces "the Space belongs to this Collective" — a row
 * with a space_id that's invisible to this session returns 0 rows from
 * the existence check below, and the UPSERT bails out with `false`.
 */

import { db } from '../db/tenant';

export interface RecentlyReadEntry {
  spaceId: string;
  lastReadAt: Date;
  readProgress: number;
  pinnedAt: Date | null;
}

/**
 * Mark a Space as read by this profile. Idempotent — repeated calls
 * for the same (profile, space) just bump last_read_at to NOW().
 * Preserves any existing read_progress / pinned_at.
 *
 * Returns true on a recorded write; false when the Space doesn't exist
 * in this Collective (RLS scopes the existence check to the active
 * context — a stale Space id from another Collective looks identical
 * to a not-found from this side).
 */
export async function recordRead(profileId: string, spaceId: string): Promise<boolean> {
  // Existence check — the FK on space_id would catch a non-existent
  // Space too, but doing it as a separate read returns a structured
  // false instead of an opaque INSERT/UPSERT failure.
  const exists = await db.query<{ id: string }>(
    `SELECT id FROM synthesis_pages WHERE id = $1 LIMIT 1`,
    [spaceId],
  );
  if (exists.rowCount === 0) return false;

  await db.query(
    `INSERT INTO space_reading_state (profile_id, space_id, last_read_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (profile_id, space_id)
       DO UPDATE SET last_read_at = NOW()`,
    [profileId, spaceId],
  );
  return true;
}

/**
 * Return the most-recently-read Spaces for this profile in the active
 * Collective, newest first. Up to `limit` rows; default 5. Does NOT
 * join to synthesis_pages — the caller already has the Spaces
 * catalogue and just needs the ordering hints.
 */
export async function listRecentlyRead(
  profileId: string,
  limit = 5,
): Promise<RecentlyReadEntry[]> {
  const cap = Math.max(1, Math.min(limit, 50));
  const res = await db.query<{
    space_id: string;
    last_read_at: Date;
    read_progress: number;
    pinned_at: Date | null;
  }>(
    `SELECT space_id, last_read_at, read_progress, pinned_at
       FROM space_reading_state
       WHERE profile_id = $1
       ORDER BY last_read_at DESC
       LIMIT $2`,
    [profileId, cap],
  );
  return res.rows.map(r => ({
    spaceId: r.space_id,
    lastReadAt: r.last_read_at,
    readProgress: r.read_progress,
    pinnedAt: r.pinned_at,
  }));
}
