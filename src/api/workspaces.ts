/**
 * Phase 5 of Build Spec 1 — workspace API (backend).
 *
 * Scope adapted to today's reality:
 *
 * - Today every profile belongs to exactly one collective via
 *   `profiles.collective_id` (1:1 membership). The Phase 3 reconciliation
 *   memory (project_memu_phase3_interim_role_on_profile) explicitly
 *   documents this as the interim model — role lives on `profiles.role`,
 *   not on a membership relation, valid only while membership is 1:1.
 *
 * - Spec 1 §8 asks for endpoints to list, create, and switch between
 *   workspaces a profile is a member of. The list endpoint works
 *   today (returns one row). The create + switch endpoints are
 *   deferred until multi-collective membership lands — they're
 *   surfaced here as 501 Not Implemented so the API shape is
 *   discoverable from the start and so the mobile switcher (Story
 *   5.3) can detect "create disabled" without guessing.
 *
 * - Projects are per-collective and multiple-per-collective DOES
 *   work today (Phase 4 / migration 041). The project list + create
 *   endpoints are real, shippable, useful surfaces.
 *
 * Routes registered (mounted in src/index.ts):
 *
 *   GET    /api/workspaces                     — list caller's workspaces
 *   POST   /api/workspaces                     — 501; multi-collective deferred
 *   GET    /api/workspaces/:id/projects        — list projects in workspace
 *   POST   /api/workspaces/:id/projects        — create a project
 *
 * RLS scopes every read/write; a workspaceId in the URL that doesn't
 * match the caller's collective returns 404 because RLS hides it.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/tenant';

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
  // Single-membership today — return the caller's collective alongside
  // their role on profiles.role. RLS scopes to that collective; we
  // explicitly read the caller's row first to recover the collective_id
  // and role in one query.
  const res = await db.query<WorkspaceRow & { role: string }>(
    `SELECT c.id, c.name, c.type, c.parent_collective_id, c.status, p.role
       FROM profiles p
       JOIN collectives c ON c.id = p.collective_id
      WHERE p.id = $1
      LIMIT 1`,
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
  // RLS already restricts the SELECT, but we want to distinguish 404
  // ("workspace exists but not yours") from 403. Since 1:1 membership
  // means the caller's profile.collective_id IS their workspace, any
  // workspaceId that doesn't match is "not yours" — 404 is the right
  // shape (the workspace might exist in another collective; from
  // here it's indistinguishable from non-existent).
  const res = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM profiles WHERE id = $1 AND collective_id = $2`,
    [profileId, workspaceId],
  );
  return Number(res.rows[0]?.count ?? 0) > 0;
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

  server.post('/api/workspaces', async (_request: AuthedRequest, reply: FastifyReply) => {
    return reply.code(501).send({
      error: 'workspace creation requires multi-collective membership',
      reason: 'multi_collective_not_implemented',
      note: "Today every profile belongs to exactly one collective (1:1 model — see memory project_memu_phase3_interim_role_on_profile). Creating a second workspace requires multi-collective membership, which is a separate slice of Build Spec 1 that hasn't shipped yet.",
    });
  });

  server.get('/api/workspaces/:id/projects', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId as string;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      if (!await ensureWorkspaceMatchesCaller(profileId, id)) {
        return reply.code(404).send({ error: 'workspace not found' });
      }
      const projects = await listProjects(id);
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
        const project = await createProject(id, validated);
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
