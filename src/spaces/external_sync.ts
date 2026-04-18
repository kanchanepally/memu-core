/**
 * Story 3.4b — external Pod read pipeline.
 *
 * Walks pod_grants for a member (or all active grants across the household),
 * fetches each granted Space from the member's external Pod via
 * solid_client.fetchExternalSpaceConditional, upserts the parsed result into
 * external_space_cache, and propagates cache hints (etag, last-modified) back
 * onto pod_grants so the next conditional request can short-circuit with a
 * 304.
 *
 * Twin extension: any foreign WebID surfaced by a fetched Space's people[]
 * (or the member's own webid on first sync) gets registered into
 * entity_registry as a person entity with detected_by='auto_pod_grant',
 * confirmed=FALSE. The display name comes from the Space context where
 * available; for the member themselves it's their member_display_name.
 *
 * What this module does NOT do (lives in 3.4c/d):
 *   - Mobile UI for triggering sync (3.4c)
 *   - End-to-end test against a real second deployment (3.4d)
 */

import { pool } from '../db/connection';
import { fetchExternalSpaceConditional, type ExternalSpace, type FetchCacheHints, SolidClientError } from './solid_client';
import { findMember, listGrants, recordGrantSync, type HouseholdMember, type PodGrant } from '../households/membership';
import { resetEntityNameCache } from '../twin/guard';

export class ExternalSyncError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
    this.name = 'ExternalSyncError';
  }
}

export type SyncOutcome =
  | { kind: 'fetched'; cache: CachedExternalSpace; cacheHints: FetchCacheHints }
  | { kind: 'not_modified'; cache: CachedExternalSpace | null; cacheHints: FetchCacheHints }
  | { kind: 'error'; reason: string; message: string };

export interface SyncReport {
  memberId: string;
  spaceUrl: string;
  outcome: SyncOutcome;
}

export interface CachedExternalSpace {
  id: string;
  memberId: string;
  spaceUrl: string;
  sourceUrl: string;
  uri: string;
  category: string;
  slug: string;
  name: string;
  description: string;
  domains: string[];
  people: string[];
  visibility: unknown;
  confidence: number;
  sourceReferences: string[];
  tags: string[];
  bodyMarkdown: string;
  remoteLastUpdated: Date | null;
  fetchedAt: Date;
}

export interface SyncOptions {
  /** Override the fetch implementation — used by tests. */
  fetchImpl?: typeof fetch;
  /** Bearer token for the external Pod. Optional — public Spaces fetch without one. */
  accessToken?: string;
  /** Skip the conditional GET headers even if cache hints are present (force re-fetch). */
  forceRefetch?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without a database).
// ---------------------------------------------------------------------------

/**
 * Extract the foreign WebID URLs from an ExternalSpace.people[] (or anywhere
 * else we surface https URLs as identifiers). Drops anything that isn't an
 * https URL — local profile ids stay out.
 */
export function extractForeignWebids(space: Pick<ExternalSpace, 'people'>): string[] {
  const out: string[] = [];
  for (const p of space.people) {
    if (typeof p !== 'string') continue;
    if (!/^https:\/\//i.test(p)) continue;
    out.push(p);
  }
  return Array.from(new Set(out));
}

/**
 * Decide whether to send conditional headers given the grant's stored cache
 * hints. Returns the headers verbatim (or empty when forceRefetch / no hints).
 */
export function buildConditionalHeaders(
  grant: Pick<PodGrant, 'lastEtag' | 'lastModifiedHeader'>,
  opts: { forceRefetch?: boolean } = {},
): { ifNoneMatch?: string; ifModifiedSince?: string } {
  if (opts.forceRefetch) return {};
  const headers: { ifNoneMatch?: string; ifModifiedSince?: string } = {};
  if (grant.lastEtag) headers.ifNoneMatch = grant.lastEtag;
  if (grant.lastModifiedHeader) headers.ifModifiedSince = grant.lastModifiedHeader;
  return headers;
}

// ---------------------------------------------------------------------------
// Twin: foreign WebID auto-registration.
// ---------------------------------------------------------------------------

/**
 * Best-effort label allocation for a foreign WebID. We pick the next
 * Person-N slot by counting existing person entries — same convention as
 * twin/novel.ts allocateLabel for the 'person' kind.
 */
async function allocatePersonLabel(): Promise<string> {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM entity_registry WHERE entity_type = 'person'",
  );
  const next = (rows[0]?.n ?? 0) + 1;
  return `Person-${next}`;
}

/**
 * Register a foreign WebID (a person on someone else's Pod) into
 * entity_registry. Idempotent — short-circuits when the WebID is already
 * present. Returns true when a new row was inserted.
 */
export async function registerForeignWebid(webid: string, displayName: string): Promise<boolean> {
  if (!/^https:\/\//i.test(webid)) return false;
  const existing = await pool.query(
    'SELECT id FROM entity_registry WHERE webid = $1 LIMIT 1',
    [webid],
  );
  if ((existing.rowCount ?? 0) > 0) return false;

  const label = await allocatePersonLabel();
  await pool.query(
    `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, webid, detected_by, confirmed)
     VALUES ('person', $1, $2, $3, 'auto_pod_grant', FALSE)`,
    [displayName, label, webid],
  );
  resetEntityNameCache();
  return true;
}

// ---------------------------------------------------------------------------
// Cache CRUD.
// ---------------------------------------------------------------------------

interface DbCacheRow {
  id: string;
  member_id: string;
  space_url: string;
  source_url: string;
  uri: string;
  category: string;
  slug: string;
  name: string;
  description: string;
  domains: string[];
  people: string[];
  visibility: unknown;
  confidence: string | number;
  source_references: string[];
  tags: string[];
  body_markdown: string;
  remote_last_updated: Date | null;
  fetched_at: Date;
}

function rowToCache(row: DbCacheRow): CachedExternalSpace {
  return {
    id: row.id,
    memberId: row.member_id,
    spaceUrl: row.space_url,
    sourceUrl: row.source_url,
    uri: row.uri,
    category: row.category,
    slug: row.slug,
    name: row.name,
    description: row.description,
    domains: row.domains ?? [],
    people: row.people ?? [],
    visibility: row.visibility,
    confidence: typeof row.confidence === 'string' ? Number(row.confidence) : row.confidence,
    sourceReferences: row.source_references ?? [],
    tags: row.tags ?? [],
    bodyMarkdown: row.body_markdown,
    remoteLastUpdated: row.remote_last_updated,
    fetchedAt: row.fetched_at,
  };
}

async function upsertCache(memberId: string, space: ExternalSpace): Promise<CachedExternalSpace> {
  const res = await pool.query<DbCacheRow>(
    `INSERT INTO external_space_cache (
        member_id, space_url, source_url, uri, category, slug, name, description,
        domains, people, visibility, confidence, source_references, tags,
        body_markdown, remote_last_updated, fetched_at
     ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9::jsonb, $10::jsonb, $11::jsonb, $12, $13::jsonb, $14::jsonb,
        $15, $16, NOW()
     )
     ON CONFLICT (member_id, space_url) DO UPDATE SET
        source_url = EXCLUDED.source_url,
        uri = EXCLUDED.uri,
        category = EXCLUDED.category,
        slug = EXCLUDED.slug,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        domains = EXCLUDED.domains,
        people = EXCLUDED.people,
        visibility = EXCLUDED.visibility,
        confidence = EXCLUDED.confidence,
        source_references = EXCLUDED.source_references,
        tags = EXCLUDED.tags,
        body_markdown = EXCLUDED.body_markdown,
        remote_last_updated = EXCLUDED.remote_last_updated,
        fetched_at = NOW()
     RETURNING *`,
    [
      memberId,
      space.sourceUrl,
      space.sourceUrl,
      space.uri,
      space.category,
      space.slug,
      space.name,
      space.description,
      JSON.stringify(space.domains),
      JSON.stringify(space.people),
      JSON.stringify(space.visibility),
      space.confidence,
      JSON.stringify(space.sourceReferences),
      JSON.stringify(space.tags),
      space.bodyMarkdown,
      space.lastUpdated,
    ],
  );
  return rowToCache(res.rows[0]);
}

async function findCache(memberId: string, spaceUrl: string): Promise<CachedExternalSpace | null> {
  const res = await pool.query<DbCacheRow>(
    'SELECT * FROM external_space_cache WHERE member_id = $1 AND space_url = $2 LIMIT 1',
    [memberId, spaceUrl],
  );
  return res.rows[0] ? rowToCache(res.rows[0]) : null;
}

export async function listCachedSpacesForMember(memberId: string): Promise<CachedExternalSpace[]> {
  const res = await pool.query<DbCacheRow>(
    'SELECT * FROM external_space_cache WHERE member_id = $1 ORDER BY fetched_at DESC',
    [memberId],
  );
  return res.rows.map(rowToCache);
}

/**
 * Drop cache entries for a (member, space_url) tuple — called by
 * revokeGrant so a revoked Space is no longer surfaced.
 */
export async function dropCacheForGrant(memberId: string, spaceUrl: string): Promise<void> {
  await pool.query(
    'DELETE FROM external_space_cache WHERE member_id = $1 AND space_url = $2',
    [memberId, spaceUrl],
  );
}

/**
 * Drop every cache entry for a member — called by finaliseLeave so a
 * fully-left member's Spaces stop appearing in the household.
 */
export async function dropAllCacheForMember(memberId: string): Promise<void> {
  await pool.query('DELETE FROM external_space_cache WHERE member_id = $1', [memberId]);
}

// ---------------------------------------------------------------------------
// Sync orchestration.
// ---------------------------------------------------------------------------

/**
 * Fetch one granted Space from the member's external Pod, upsert the parsed
 * body into external_space_cache, and propagate cache hints back onto
 * pod_grants. On 304 keeps the existing cache row, only refreshes hints.
 * On error returns kind:'error' rather than throwing — sync of one Space
 * shouldn't poison the rest of the sweep.
 */
export async function syncGrant(
  member: Pick<HouseholdMember, 'id' | 'memberWebid' | 'memberDisplayName'>,
  grant: PodGrant,
  opts: SyncOptions = {},
): Promise<SyncOutcome> {
  if (grant.status !== 'active') {
    return { kind: 'error', reason: 'grant_not_active', message: `Grant ${grant.id} is ${grant.status}` };
  }
  const conditional = buildConditionalHeaders(grant, { forceRefetch: opts.forceRefetch });
  let result;
  try {
    result = await fetchExternalSpaceConditional(grant.spaceUrl, {
      accessToken: opts.accessToken,
      fetchImpl: opts.fetchImpl,
      ifNoneMatch: conditional.ifNoneMatch ?? null,
      ifModifiedSince: conditional.ifModifiedSince ?? null,
    });
  } catch (err) {
    if (err instanceof SolidClientError) {
      return { kind: 'error', reason: err.reason, message: err.message };
    }
    return { kind: 'error', reason: 'fetch_failed', message: (err as Error).message };
  }

  if (result.kind === 'not_modified') {
    await recordGrantSync(member.id, grant.spaceUrl, {
      etag: result.cacheHints.etag,
      lastModified: result.cacheHints.lastModified,
    });
    const existing = await findCache(member.id, grant.spaceUrl);
    return { kind: 'not_modified', cache: existing, cacheHints: result.cacheHints };
  }

  // Fresh body — upsert + register foreign WebIDs.
  const cached = await upsertCache(member.id, result.space);
  await recordGrantSync(member.id, grant.spaceUrl, {
    etag: result.cacheHints.etag,
    lastModified: result.cacheHints.lastModified,
  });
  // Member's own WebID — register on first encounter so the Twin guard
  // protects it. Display name from the household roster.
  await registerForeignWebid(member.memberWebid, member.memberDisplayName);
  // Foreign WebIDs surfaced by the Space's people[].
  for (const webid of extractForeignWebids(result.space)) {
    if (webid === member.memberWebid) continue;
    // Best-effort display name: derive from the slug at the end of the URL.
    const fallbackName = webid.replace(/#.*$/, '').split('/').filter(Boolean).pop() ?? webid;
    await registerForeignWebid(webid, fallbackName);
  }
  return { kind: 'fetched', cache: cached, cacheHints: result.cacheHints };
}

/**
 * Walk every active grant for a member and sync each. Errors on individual
 * Spaces are reported per-row; the sweep does not abort.
 */
export async function syncMemberGrants(memberId: string, opts: SyncOptions = {}): Promise<SyncReport[]> {
  const member = await findMember(memberId);
  if (!member) throw new ExternalSyncError('member_not_found', `No member with id ${memberId}`);
  const grants = await listGrants(memberId);
  const reports: SyncReport[] = [];
  for (const grant of grants) {
    const outcome = await syncGrant(member, grant, opts);
    reports.push({ memberId, spaceUrl: grant.spaceUrl, outcome });
  }
  return reports;
}

/**
 * Walk every active grant across every active member of a household and
 * sync. Used by the cron (3.4 sweep).
 */
export async function syncHouseholdGrants(
  householdAdminProfileId: string,
  opts: SyncOptions = {},
): Promise<SyncReport[]> {
  const memberRows = await pool.query<{ id: string; member_webid: string; member_display_name: string }>(
    `SELECT id, member_webid, member_display_name
       FROM household_members
      WHERE household_admin_profile_id = $1 AND status IN ('invited', 'active', 'leaving')`,
    [householdAdminProfileId],
  );
  const reports: SyncReport[] = [];
  for (const row of memberRows.rows) {
    const grants = await listGrants(row.id);
    for (const grant of grants) {
      const outcome = await syncGrant(
        { id: row.id, memberWebid: row.member_webid, memberDisplayName: row.member_display_name },
        grant,
        opts,
      );
      reports.push({ memberId: row.id, spaceUrl: grant.spaceUrl, outcome });
    }
  }
  return reports;
}
