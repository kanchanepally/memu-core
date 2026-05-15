/**
 * Phase 5 of Build Spec 1 — workspace API (backend).
 *
 * ## What ships here
 *
 *   GET    /api/workspaces                — list caller's workspaces
 *                                            (every active membership)
 *   POST   /api/workspaces                — create new Collective + own
 *                                            it as 'owner' (Story 3.1)
 *   GET    /api/workspaces/:id/projects   — list projects in workspace
 *   POST   /api/workspaces/:id/projects   — create a project
 *
 * ## Multi-Collective Membership status
 *
 * Story 3.1 (this commit): POST /api/workspaces is real. A caller
 * can create a new Collective and is automatically an owner
 * membership of it. listWorkspaces (Story 2.1) already widened to
 * read from collective_memberships, so the new workspace appears in
 * the caller's list immediately. ensureWorkspaceMatchesCaller
 * widened to membership-check so the project endpoints accept any
 * workspaceId the caller is an active member of (not just the
 * profile's home collective).
 *
 * Story 3.2 (next): active-Collective switching — the implicit
 * per-request collective_id (used by every endpoint that doesn't
 * carry an explicit workspaceId) becomes settable. Until then,
 * `profile.collective_id` remains the implicit home and is
 * unchanged by 3.1's create flow.
 *
 * Story 3.3 (later): auto-create a personal Collective for every
 * user (existing + new). Migration reconciles existing profiles;
 * registration auto-creates type='personal'. NOT pulled forward —
 * see feedback memory no-pull-forward-ahead-of-unblocking-slice.
 *
 * RLS still scopes every read/write. The project endpoints
 * explicitly enterCollectiveContext on the URL workspace so they
 * operate inside its tenant context regardless of which collective
 * is the caller's implicit home.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { pool } from '../db/connection';
import { db, enterCollectiveContext } from '../db/tenant';

interface AuthedRequest extends FastifyRequest {
  profileId?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB)
// ---------------------------------------------------------------------------

/**
 * The canonical workspace-type enum (matches collectives_type_check
 * from migration 039). Exposed here so callers can validate inputs
 * against a single source of truth.
 */
export const WORKSPACE_TYPES = [
  'household',
  'personal',
  'family',
  'work',
  'project',
  'research',
  'community',
] as const;
export type WorkspaceType = typeof WORKSPACE_TYPES[number];

export function isWorkspaceType(s: unknown): s is WorkspaceType {
  return typeof s === 'string' && (WORKSPACE_TYPES as readonly string[]).includes(s);
}

const PROJECT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface ProjectCreateInput {
  name: string;
  slug?: string;
  description?: string;
}

export type ProjectCreateValidation =
  | { ok: true; name: string; slug: string; description: string }
  | { ok: false; reason: 'name_required' | 'slug_invalid' };

export function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function validateProjectCreate(input: unknown): ProjectCreateValidation {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'name_required' };
  const b = input as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { ok: false, reason: 'name_required' };
  const rawSlug = typeof b.slug === 'string' && b.slug.trim() ? b.slug.trim().toLowerCase() : slugifyProjectName(name);
  if (!PROJECT_SLUG_RE.test(rawSlug)) return { ok: false, reason: 'slug_invalid' };
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  return { ok: true, name, slug: rawSlug, description };
}

// ---------------------------------------------------------------------------
// Story 3.1 — POST /api/workspaces validator
// ---------------------------------------------------------------------------

export interface WorkspaceCreateInput {
  name: string;
  type: WorkspaceType;
  parentCollectiveId?: string | null;
}

export type WorkspaceCreateValidation =
  | { ok: true; name: string; type: WorkspaceType; parentCollectiveId: string | null }
  | { ok: false; reason: 'name_required' | 'type_required' | 'type_invalid' | 'household_reserved' };

/**
 * Validate a POST /api/workspaces body. Pure — testable without DB.
 *
 * Type rules:
 *   - Must be one of WORKSPACE_TYPES.
 *   - `household` is REJECTED. A household Collective is the auth-
 *     time root created by registerPrimaryCollectiveAndProfile; users
 *     don't create new households via this API. (They could in
 *     principle, but the household role and ownership semantics are
 *     entangled with `profiles.collective_id` in the 1:1 era, and
 *     opening that door would invite drift.)
 *   - `personal` is allowed here in Story 3.1, even though the
 *     auto-personal-on-registration flow is Story 3.3. A user who
 *     explicitly creates one now gets a perfectly real personal
 *     Collective; 3.3's job is making it automatic for everyone.
 */
export function validateWorkspaceCreate(input: unknown): WorkspaceCreateValidation {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'name_required' };
  const b = input as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { ok: false, reason: 'name_required' };
  if (typeof b.type !== 'string' || !b.type) return { ok: false, reason: 'type_required' };
  if (!isWorkspaceType(b.type)) return { ok: false, reason: 'type_invalid' };
  if (b.type === 'household') return { ok: false, reason: 'household_reserved' };
  const parentCollectiveId =
    typeof b.parentCollectiveId === 'string' && b.parentCollectiveId.trim()
      ? b.parentCollectiveId.trim()
      : null;
  return { ok: true, name: name.slice(0, 120), type: b.type, parentCollectiveId };
}

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/:id validator
// ---------------------------------------------------------------------------

export interface WorkspaceUpdateInput {
  name: string;
}

export type WorkspaceUpdateValidation =
  | { ok: true; name: string }
  | { ok: false; reason: 'name_required' };

export function validateWorkspaceUpdate(input: unknown): WorkspaceUpdateValidation {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'name_required' };
  const b = input as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { ok: false, reason: 'name_required' };
  return { ok: true, name: name.slice(0, 120) };
}

/** Roles allowed to rename a workspace. Mirrors the adult-bucket from
 *  the spec's role-to-bucket mapping. Children + viewers + members
 *  cannot rename. */
export const WORKSPACE_RENAME_ROLES = ['owner', 'admin', 'adult'] as const;
export type WorkspaceRenameRole = typeof WORKSPACE_RENAME_ROLES[number];
export function canRenameWorkspace(role: string | null | undefined): boolean {
  return typeof role === 'string' && (WORKSPACE_RENAME_ROLES as readonly string[]).includes(role);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

interface WorkspaceRow {
  id: string;
  name: string;
  type: WorkspaceType;
  parent_collective_id: string | null;
  status: string;
}

interface ProjectRow {
  id: string;
  collective_id: string;
  name: string;
  slug: string;
  description: string;
  status: 'active' | 'archived';
  created_at: Date;
}

async function listWorkspaces(profileId: string) {
  // Story 2.1: read from the collective_memberships relationship
  // rather than profiles.role. status='active' filters out
  // invited/left rows. Single-membership today still returns one
  // row; the same query widens cleanly when Story 3.2 lifts the
  // 1:1 constraint and a profile may have multiple active
  // memberships.
  //
  // queryAsBootstrap is needed because the auth path enters this
  // before requireCollective has bound a context (the caller is
  // discovering which collective(s) they belong to). Bootstrap is
  // a READ-only escape hatch on profiles + collective_memberships;
  // writes still gate on collective match.
  const res = await db.queryAsBootstrap<WorkspaceRow & { role: string }>(
    `SELECT c.id, c.name, c.type, c.parent_collective_id, c.status, cm.role
       FROM collective_memberships cm
       JOIN collectives c ON c.id = cm.collective_id
      WHERE cm.profile_id = $1 AND cm.status = 'active'
      ORDER BY c.created_at ASC`,
    [profileId],
  );
  return res.rows.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    parentCollectiveId: r.parent_collective_id,
    status: r.status,
    role: r.role,
  }));
}

async function ensureWorkspaceMatchesCaller(profileId: string, workspaceId: string): Promise<boolean> {
  // Story 3.1: widened from profiles.collective_id (the 1:1 home
  // pointer) to collective_memberships (the relationship). A caller
  // is a "member" of any Collective they have an active membership
  // row in, regardless of which one is their implicit home. After
  // Story 3.1, a user can have ≥2 active memberships (their home
  // plus any workspace they create), and project ops must work
  // against any of them.
  //
  // queryAsBootstrap so the read works even before per-workspace
  // context is entered. status='active' filters out invited/left.
  const res = await db.queryAsBootstrap<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM collective_memberships
      WHERE profile_id = $1 AND collective_id = $2 AND status = 'active'`,
    [profileId, workspaceId],
  );
  return Number(res.rows[0]?.count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Story 3.1 — create a new Collective + owner membership
// ---------------------------------------------------------------------------

interface WorkspaceCreateResult {
  id: string;
  name: string;
  type: WorkspaceType;
  parentCollectiveId: string | null;
  status: string;
  role: 'owner';
}

/**
 * Create a new Collective with the caller as the owner-membership.
 *
 * Transaction shape:
 *   1. Pre-generate collective_id as UUID in JS so we can specify it
 *      on both the collectives INSERT and the membership INSERT.
 *   2. SET LOCAL memu.collective_id to the pre-generated id so the
 *      WITH CHECK on collective_memberships passes (the policy
 *      requires collective_id = current_setting('memu.collective_id')).
 *   3. INSERT INTO collectives — Tier-C, no RLS, no FK problem (the
 *      caller's profile already exists).
 *   4. INSERT INTO collective_memberships — role='owner', status=
 *      'active'. The session var matches the new collective so the
 *      WITH CHECK passes.
 *
 * After commit, the caller has TWO active memberships: their home
 * (created at first registration) plus this new one. listWorkspaces
 * (Story 2.1) sees both.
 *
 * Uses raw pool.connect() rather than db.transaction because we need
 * the transaction-local SET LOCAL to a collective_id that's not in
 * any AsyncLocalStorage context yet — the new one is being bootstrapped.
 */
async function createWorkspace(
  ownerProfileId: string,
  validated: { name: string; type: WorkspaceType; parentCollectiveId: string | null },
): Promise<WorkspaceCreateResult> {
  const collectiveId = crypto.randomUUID();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Switch the session var so the membership INSERT's WITH CHECK
    // passes against the about-to-exist collective. SET LOCAL —
    // discarded on COMMIT, doesn't leak when the connection returns
    // to the pool.
    await client.query("SELECT set_config('memu.collective_id', $1, true)", [collectiveId]);

    // Collective insert. Tier-C, no RLS gate. parent_collective_id is
    // optional — used by the Pod model when a workspace nests under
    // another (e.g. a project workspace inside a household). Caller-
    // chosen; we don't validate the FK target's existence beyond the
    // FK itself.
    await client.query(
      `INSERT INTO collectives (id, type, name, parent_collective_id, primary_admin_profile_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [collectiveId, validated.type, validated.name, validated.parentCollectiveId, ownerProfileId],
    );

    // Owner membership. role='owner' is the role that creates +
    // configures the Collective; existing households use 'admin' as
    // the alias for their primary admin, but new-Collective owners
    // get 'owner' so the role distinction is explicit. Both are
    // adult-bucket per the spec's role-to-bucket mapping.
    await client.query(
      `INSERT INTO collective_memberships (collective_id, profile_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [collectiveId, ownerProfileId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return {
    id: collectiveId,
    name: validated.name,
    type: validated.type,
    parentCollectiveId: validated.parentCollectiveId,
    status: 'active',
    role: 'owner',
  };
}

/**
 * Rename an existing workspace. Caller's role in the workspace must be
 * adult-bucket (owner / admin / adult). `collectives` is Tier-C with
 * no RLS, so the role check is done explicitly in code via
 * collective_memberships before the UPDATE.
 *
 * Returns the updated workspace shape, or null when caller is not a
 * member / not allowed / workspace doesn't exist (all three collapse
 * into 404 from the route handler — we don't distinguish for the
 * client's sake).
 */
async function renameWorkspace(
  callerProfileId: string,
  workspaceId: string,
  newName: string,
): Promise<{ id: string; name: string; type: WorkspaceType; status: string } | null> {
  // Verify the caller has an adult-bucket role in this workspace.
  // queryAsBootstrap because the caller may not have entered this
  // workspace's RLS context for this request — they're operating on
  // a workspace from their list, not necessarily their active one.
  const memberRes = await db.queryAsBootstrap<{ role: string }>(
    `SELECT role FROM collective_memberships
      WHERE profile_id = $1 AND collective_id = $2 AND status = 'active'
      LIMIT 1`,
    [callerProfileId, workspaceId],
  );
  if (memberRes.rowCount === 0) return null;
  if (!canRenameWorkspace(memberRes.rows[0].role)) return null;

  // collectives is Tier-C — no RLS gating on the write. Update + return
  // the row in one statement.
  const res = await db.queryWithoutTenant<{ id: string; name: string; type: WorkspaceType; status: string }>(
    `UPDATE collectives SET name = $1 WHERE id = $2 RETURNING id, name, type, status`,
    [newName, workspaceId],
  );
  return res.rows[0] ?? null;
}

async function listProjects(workspaceId: string) {
  // RLS scopes to active collective; the URL workspaceId is the same
  // collective today so the predicate is functionally redundant —
  // included explicitly so multi-collective membership can use this
  // same query unchanged.
  const res = await db.query<ProjectRow>(
    `SELECT id, collective_id, name, slug, description, status, created_at
       FROM projects
      WHERE collective_id = $1
      ORDER BY created_at DESC`,
    [workspaceId],
  );
  return res.rows.map(r => ({
    id: r.id,
    workspaceId: r.collective_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
  }));
}

async function createProject(workspaceId: string, validated: { name: string; slug: string; description: string }) {
  // collective_id defaults from memu.collective_id session var;
  // pass it explicitly anyway so the row is unambiguous if the
  // session var ever drifts. The UNIQUE (collective_id, slug)
  // constraint surfaces duplicates as 23505 — caller-handled.
  const res = await db.query<ProjectRow>(
    `INSERT INTO projects (collective_id, name, slug, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id, collective_id, name, slug, description, status, created_at`,
    [workspaceId, validated.name, validated.slug, validated.description],
  );
  const r = res.rows[0];
  return {
    id: r.id,
    workspaceId: r.collective_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fastify plugin — register routes via the standard server.register pattern
// ---------------------------------------------------------------------------

export async function workspaceRoutes(server: FastifyInstance) {
  server.get('/api/workspaces', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId as string;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const workspaces = await listWorkspaces(profileId);
      return reply.send({ workspaces });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'Failed to list workspaces' });
    }
  });

  // Story 3.1 — real workspace creation. Caller becomes owner of the
  // new Collective. The new workspace appears in their next GET
  // /api/workspaces immediately (Story 2.1 widened the list to read
  // from collective_memberships).
  //
  // No role check: any authenticated user can create a workspace they
  // own. The spec is silent on per-user creation quotas; rate
  // limiting is an operator concern (and a Tier-1 hosted concern,
  // not a Z2 standalone concern).
  server.post('/api/workspaces', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId as string;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const validated = validateWorkspaceCreate(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: validated.reason });
      }
      const workspace = await createWorkspace(profileId, validated);
      return reply.code(201).send({ workspace });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'Failed to create workspace' });
    }
  });

  // Rename a workspace. Role check is in renameWorkspace itself —
  // caller must be adult-bucket (owner/admin/adult) in this workspace.
  // Not-a-member, wrong-role, and not-found all collapse to 404; we
  // don't distinguish for the client (less information leaked).
  server.patch('/api/workspaces/:id', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId as string;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      const validated = validateWorkspaceUpdate(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: validated.reason });
      }
      const workspace = await renameWorkspace(profileId, id, validated.name);
      if (!workspace) {
        return reply.code(404).send({ error: 'workspace not found' });
      }
      return reply.send({ workspace });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'Failed to rename workspace' });
    }
  });

  // Project endpoints operate against the URL workspaceId. Because the
  // caller's implicit collective context (from requireCollective) is
  // their HOME, not necessarily the URL workspace, we enter the URL
  // workspace's context explicitly for the duration of the project
  // operation. ensureWorkspaceMatchesCaller has already confirmed the
  // caller has an active membership in the URL workspace, so this is
  // not a privilege escalation — it's the per-request "operate inside
  // this collective" pattern that Story 3.2's switch-flow will later
  // make implicit for non-project endpoints too.
  server.get('/api/workspaces/:id/projects', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId as string;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      if (!await ensureWorkspaceMatchesCaller(profileId, id)) {
        return reply.code(404).send({ error: 'workspace not found' });
      }
      const projects = await enterCollectiveContext(id, () => listProjects(id));
      return reply.send({ projects });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'Failed to list projects' });
    }
  });

  server.post('/api/workspaces/:id/projects', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId as string;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      if (!await ensureWorkspaceMatchesCaller(profileId, id)) {
        return reply.code(404).send({ error: 'workspace not found' });
      }
      const validated = validateProjectCreate(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: validated.reason });
      }
      try {
        const project = await enterCollectiveContext(id, () => createProject(id, validated));
        return reply.code(201).send({ project });
      } catch (err: any) {
        if (err?.code === '23505') {
          // UNIQUE (collective_id, slug) — duplicate slug in workspace.
          return reply.code(409).send({ error: 'slug already taken in this workspace', reason: 'slug_conflict' });
        }
        throw err;
      }
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'Failed to create project' });
    }
  });
}
