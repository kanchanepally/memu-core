/**
 * BS3 Phase W1 — Workbench API.
 *
 * Two endpoints:
 *
 *   POST /api/workbench/query
 *        Run corpus_query (hybrid: embedding search → LLM rank) over
 *        the active workspace's visible artefacts. Returns ranked
 *        results with per-result rationale.
 *
 *   GET /api/spaces/connections?uri=<spaceUri>
 *        List all active connections involving the given Space URI,
 *        with the other-endpoint artefact's metadata (title /
 *        category) joined in for display.
 *
 * The POST /api/spaces/connections handler for creating connections
 * lives in src/index.ts (Phase 6 of BS1) — this slice patches that
 * handler to accept the new `relationshipType` field, not duplicates.
 *
 * Both endpoints rely on the request-time collective context bound by
 * `requireCollective` in the auth pipeline — RLS scopes every query.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/tenant';
import { corpusQuery, type WorkbenchQueryInput } from '../intelligence/workbench';
import type { SpaceCategory } from '../spaces/model';

interface AuthedRequest extends FastifyRequest {
  profileId?: string;
  familyId?: string;
}

// ---------------------------------------------------------------------------
// Pure validators — testable without DB
// ---------------------------------------------------------------------------

export interface ValidatedWorkbenchQuery {
  query: string;
  candidateLimit: number;
  resultLimit: number;
}

export type WorkbenchQueryValidation =
  | { ok: true; input: ValidatedWorkbenchQuery }
  | { ok: false; reason: 'body_required' | 'query_required' | 'query_too_long' | 'limit_invalid' };

const MAX_QUERY_CHARS = 1000;
const DEFAULT_CANDIDATE_LIMIT = 30;
const DEFAULT_RESULT_LIMIT = 10;
const MAX_CANDIDATE_LIMIT = 100;
const MAX_RESULT_LIMIT = 30;

export function validateWorkbenchQuery(body: unknown): WorkbenchQueryValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;
  const rawQuery = typeof b.query === 'string' ? b.query.trim() : '';
  if (!rawQuery) return { ok: false, reason: 'query_required' };
  if (rawQuery.length > MAX_QUERY_CHARS) return { ok: false, reason: 'query_too_long' };

  let candidateLimit = DEFAULT_CANDIDATE_LIMIT;
  if (b.candidateLimit !== undefined) {
    const n = Number(b.candidateLimit);
    if (!Number.isFinite(n) || n < 1 || n > MAX_CANDIDATE_LIMIT) {
      return { ok: false, reason: 'limit_invalid' };
    }
    candidateLimit = Math.floor(n);
  }
  let resultLimit = DEFAULT_RESULT_LIMIT;
  if (b.resultLimit !== undefined) {
    const n = Number(b.resultLimit);
    if (!Number.isFinite(n) || n < 1 || n > MAX_RESULT_LIMIT) {
      return { ok: false, reason: 'limit_invalid' };
    }
    resultLimit = Math.floor(n);
  }
  return {
    ok: true,
    input: { query: rawQuery, candidateLimit, resultLimit },
  };
}

export interface ConnectionListItem {
  /** Other endpoint's URI (the side NOT equal to the queried URI). */
  otherUri: string;
  otherTitle: string;
  otherCategory: SpaceCategory;
  sourceMechanism: 'wikilink' | 'manual' | 'proposed';
  relationshipType: string | null;
  confidence: number;
  createdAt: string;
  sourceSkill: string | null;
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export async function workbenchRoutes(server: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /api/workbench/query
  // -------------------------------------------------------------------------
  server.post('/api/workbench/query', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      const familyId = request.familyId;
      if (!profileId || !familyId) {
        return reply.code(401).send({ error: 'not authenticated' });
      }
      const validated = validateWorkbenchQuery(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid query', reason: validated.reason });
      }
      const input: WorkbenchQueryInput = {
        familyId,
        viewerProfileId: profileId,
        query: validated.input.query,
        candidateLimit: validated.input.candidateLimit,
        resultLimit: validated.input.resultLimit,
      };
      const result = await corpusQuery(input);
      return reply.send(result);
    } catch (err) {
      server.log.error(err);
      const message = err instanceof Error ? err.message : 'unknown error';
      return reply.code(500).send({ error: 'workbench query failed', detail: message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/spaces/connections?uri=<spaceUri>
  //
  // List active connections where one endpoint matches the queried URI.
  // The other endpoint's metadata (title, category) is joined in so the
  // UI can render the connection card without a follow-up request per
  // edge.
  //
  // Returns an empty array when the URI has no connections, OR when it
  // doesn't exist in the active collective — RLS hides the row and we
  // surface the same shape rather than 404 (the user simply sees no
  // connections, which is the truthful answer).
  // -------------------------------------------------------------------------
  server.get('/api/spaces/connections', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const q = request.query as Record<string, unknown> | undefined;
      const uri = typeof q?.uri === 'string' ? q.uri.trim() : '';
      if (!uri) {
        return reply.code(400).send({ error: 'uri query parameter required' });
      }

      // Join space_connections with the other-endpoint's synthesis_pages
      // row to pull title + category. The conditional CASE picks the
      // "other" side for each row — connections are canonically ordered
      // (a < b) so either side can match the queried uri.
      const res = await db.query<{
        other_uri: string;
        other_title: string;
        other_category: SpaceCategory;
        source_mechanism: 'wikilink' | 'manual' | 'proposed';
        relationship_type: string | null;
        confidence: string;
        created_at: Date;
        source_skill: string | null;
      }>(
        `SELECT
            CASE WHEN c.space_uri_a = $1 THEN c.space_uri_b ELSE c.space_uri_a END AS other_uri,
            s.title AS other_title,
            s.category AS other_category,
            c.source_mechanism,
            c.relationship_type,
            c.confidence::text AS confidence,
            c.created_at,
            c.source_skill
           FROM space_connections c
           JOIN synthesis_pages s
             ON s.uri = CASE WHEN c.space_uri_a = $1 THEN c.space_uri_b ELSE c.space_uri_a END
          WHERE (c.space_uri_a = $1 OR c.space_uri_b = $1)
            AND c.status = 'active'
          ORDER BY c.created_at DESC`,
        [uri],
      );

      const connections: ConnectionListItem[] = res.rows.map(r => ({
        otherUri: r.other_uri,
        otherTitle: r.other_title || 'Untitled',
        otherCategory: r.other_category,
        sourceMechanism: r.source_mechanism,
        relationshipType: r.relationship_type,
        confidence: Number(r.confidence),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
        sourceSkill: r.source_skill,
      }));

      return reply.send({ uri, connections });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to list connections' });
    }
  });
}

// ---------------------------------------------------------------------------
// Helper exported for the inline POST /api/spaces/connections handler in
// index.ts — validates an optional `relationshipType` field. Pure so it
// can be tested without spinning up Fastify.
// ---------------------------------------------------------------------------

export const VALID_RELATIONSHIP_TYPES = [
  'supports',
  'contradicts',
  'extends',
  'exemplifies',
  'motivates',
  'answers',
  'references',
] as const;
export type RelationshipType = (typeof VALID_RELATIONSHIP_TYPES)[number];

export function isRelationshipType(s: unknown): s is RelationshipType {
  return typeof s === 'string' && (VALID_RELATIONSHIP_TYPES as readonly string[]).includes(s);
}

export type RelationshipTypeValidation =
  | { ok: true; value: RelationshipType | null }
  | { ok: false; reason: 'relationship_type_invalid' };

/**
 * Validate the optional relationshipType field on a connection-create
 * request. Empty / undefined / null → ok with value=null (untyped
 * connection — same as the wikilink-extraction path). A string that's
 * one of the 7 valid types → ok with that type. Anything else → reject.
 */
export function validateRelationshipType(raw: unknown): RelationshipTypeValidation {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  if (isRelationshipType(raw)) {
    return { ok: true, value: raw };
  }
  return { ok: false, reason: 'relationship_type_invalid' };
}
