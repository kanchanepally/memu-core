/**
 * BS3 Phase W3 — Writing Spaces API.
 *
 * A Writing Space is a long-form draft (essay, paper, substack article)
 * with version history, typed citation rows, and a status lifecycle.
 *
 * Endpoints (all RLS-scoped to the active collective via the auth
 * pipeline's requireCollective hook):
 *
 *   POST   /api/writing-spaces                       — create
 *   GET    /api/writing-spaces                       — list (newest first)
 *   GET    /api/writing-spaces/:id                   — full payload + citations
 *   PUT    /api/writing-spaces/:id                   — save a new version
 *   GET    /api/writing-spaces/:id/versions          — list versions
 *   GET    /api/writing-spaces/:id/versions/:n       — one version
 *   POST   /api/writing-spaces/:id/status            — transition status
 *   DELETE /api/writing-spaces/:id                   — cascade-delete
 *   POST   /api/writing-spaces/:id/citations         — insert citation
 *   GET    /api/writing-spaces/:id/citations         — list citations
 *   DELETE /api/writing-spaces/:id/citations/:cid    — remove citation
 *   POST   /api/writing-spaces/:id/cite-picker       — deterministic ranker
 *
 * W3 ships the deterministic cite-picker baseline (ILIKE-driven scoring);
 * W4 replaces the body of that endpoint with an LLM rank step. Shape
 * stays stable across both.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createWritingSpace,
  findWritingSpace,
  findWritingSpaceWithCitations,
  listWritingSpaces,
  saveWritingSpaceVersion,
  transitionStatus,
  deleteWritingSpace,
  insertCitation,
  listCitations,
  deleteCitation,
  listVersions,
  findVersion,
  runCitePickerDeterministic,
  isWritingStatus,
  isCitationFormat,
  type WritingStatus,
  type CitationFormat,
} from '../spaces/writingSpaceStore';

interface AuthedRequest extends FastifyRequest {
  profileId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Templates allowed on POST /api/writing-spaces. NOT enforced as a DB
 * CHECK constraint — BS3 §8 deliberately treats templates as additive
 * so new types (memoir, technical report, …) can be added without a
 * migration. We validate at the API edge with a permissive allow-list
 * here so the API surface stays predictable; new templates land here +
 * in the PWA picker simultaneously.
 */
export const WRITING_TEMPLATES = [
  'essay',
  'substack',
  'paper',
  'memoir',
  'note',
  'thread',
] as const;
export type WritingTemplate = typeof WRITING_TEMPLATES[number];

export function isWritingTemplate(s: unknown): s is WritingTemplate {
  return typeof s === 'string' && (WRITING_TEMPLATES as readonly string[]).includes(s);
}

const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 2_000_000; // generous; ~2MB plaintext
const MAX_SUMMARY_CHARS = 500;
const MAX_CURSOR_CONTEXT_CHARS = 4_000;
const DEFAULT_CITE_PICKER_LIMIT = 10;
const MAX_CITE_PICKER_LIMIT = 50;
const DEFAULT_VERSIONS_LIMIT = 20;
const MAX_VERSIONS_LIMIT = 200;

// ---------------------------------------------------------------------------
// Pure validators
// ---------------------------------------------------------------------------

export interface ValidatedCreateInput {
  title: string;
  template: WritingTemplate;
  workingSetId: string | null;
}

export type CreateValidation =
  | { ok: true; input: ValidatedCreateInput }
  | { ok: false; reason: 'body_required' | 'title_required' | 'title_too_long' | 'template_invalid' | 'working_set_id_invalid' };

export function validateCreateInput(body: unknown): CreateValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title) return { ok: false, reason: 'title_required' };
  if (title.length > MAX_TITLE_CHARS) return { ok: false, reason: 'title_too_long' };

  const rawTemplate = typeof b.template === 'string' && b.template.trim()
    ? b.template.trim()
    : 'essay';
  if (!isWritingTemplate(rawTemplate)) {
    return { ok: false, reason: 'template_invalid' };
  }

  let workingSetId: string | null = null;
  if (b.workingSetId !== undefined && b.workingSetId !== null) {
    if (typeof b.workingSetId !== 'string' || !b.workingSetId.trim()) {
      return { ok: false, reason: 'working_set_id_invalid' };
    }
    workingSetId = b.workingSetId.trim();
  }

  return { ok: true, input: { title, template: rawTemplate, workingSetId } };
}

export interface ValidatedSaveInput {
  bodyMarkdown: string;
  changesSummary: string | null;
}

export type SaveValidation =
  | { ok: true; input: ValidatedSaveInput }
  | { ok: false; reason: 'body_required' | 'body_markdown_required' | 'body_too_long' | 'summary_too_long' };

export function validateSaveInput(body: unknown): SaveValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;
  if (typeof b.bodyMarkdown !== 'string') {
    // Empty string is allowed (clearing the draft); only missing/non-string is rejected.
    return { ok: false, reason: 'body_markdown_required' };
  }
  if (b.bodyMarkdown.length > MAX_BODY_CHARS) {
    return { ok: false, reason: 'body_too_long' };
  }
  let summary: string | null = null;
  if (b.changesSummary !== undefined && b.changesSummary !== null) {
    if (typeof b.changesSummary !== 'string') {
      return { ok: false, reason: 'summary_too_long' };
    }
    if (b.changesSummary.length > MAX_SUMMARY_CHARS) {
      return { ok: false, reason: 'summary_too_long' };
    }
    summary = b.changesSummary;
  }
  return { ok: true, input: { bodyMarkdown: b.bodyMarkdown, changesSummary: summary } };
}

export interface ValidatedStatusInput {
  status: WritingStatus;
}

export type StatusValidation =
  | { ok: true; input: ValidatedStatusInput }
  | { ok: false; reason: 'body_required' | 'status_required' | 'status_invalid' };

export function validateStatusInput(body: unknown): StatusValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;
  if (typeof b.status !== 'string' || !b.status) {
    return { ok: false, reason: 'status_required' };
  }
  if (!isWritingStatus(b.status)) {
    return { ok: false, reason: 'status_invalid' };
  }
  return { ok: true, input: { status: b.status } };
}

export interface ValidatedCiteInput {
  artefactSpaceUri: string;
  passageId: string | null;
  positionInDraft: number;
  surroundingHash: string;
  citationFormat: CitationFormat | null;
}

export type CiteValidation =
  | { ok: true; input: ValidatedCiteInput }
  | { ok: false; reason:
      | 'body_required'
      | 'artefact_uri_required'
      | 'position_invalid'
      | 'surrounding_hash_required'
      | 'citation_format_invalid'
      | 'passage_id_invalid' };

export function validateCiteInput(body: unknown): CiteValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;
  const uri = typeof b.artefactSpaceUri === 'string' ? b.artefactSpaceUri.trim() : '';
  if (!uri) return { ok: false, reason: 'artefact_uri_required' };

  let passageId: string | null = null;
  if (b.passageId !== undefined && b.passageId !== null) {
    if (typeof b.passageId !== 'string') {
      return { ok: false, reason: 'passage_id_invalid' };
    }
    const trimmed = b.passageId.trim();
    passageId = trimmed === '' ? null : trimmed;
  }

  const rawPos = b.positionInDraft;
  if (typeof rawPos !== 'number' || !Number.isFinite(rawPos) || rawPos < 0) {
    return { ok: false, reason: 'position_invalid' };
  }
  const positionInDraft = Math.floor(rawPos);

  if (typeof b.surroundingHash !== 'string' || !b.surroundingHash.trim()) {
    return { ok: false, reason: 'surrounding_hash_required' };
  }
  const surroundingHash = b.surroundingHash.trim();

  let citationFormat: CitationFormat | null = null;
  if (b.citationFormat !== undefined && b.citationFormat !== null && b.citationFormat !== '') {
    if (!isCitationFormat(b.citationFormat)) {
      return { ok: false, reason: 'citation_format_invalid' };
    }
    citationFormat = b.citationFormat;
  }

  return {
    ok: true,
    input: { artefactSpaceUri: uri, passageId, positionInDraft, surroundingHash, citationFormat },
  };
}

export interface ValidatedCitePickerInput {
  cursorContext: string;
  limit: number;
}

export type CitePickerValidation =
  | { ok: true; input: ValidatedCitePickerInput }
  | { ok: false; reason: 'body_required' | 'cursor_context_required' | 'cursor_context_too_long' | 'limit_invalid' };

export function validateCitePickerInput(body: unknown): CitePickerValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;
  // Empty cursor context is allowed (the picker falls back to recent
  // artefacts), but a non-string field is not — that's a client bug.
  if (b.cursorContext !== undefined && b.cursorContext !== null && typeof b.cursorContext !== 'string') {
    return { ok: false, reason: 'cursor_context_required' };
  }
  const cursorContext = typeof b.cursorContext === 'string' ? b.cursorContext : '';
  if (cursorContext.length > MAX_CURSOR_CONTEXT_CHARS) {
    return { ok: false, reason: 'cursor_context_too_long' };
  }
  let limit = DEFAULT_CITE_PICKER_LIMIT;
  if (b.limit !== undefined) {
    const n = Number(b.limit);
    if (!Number.isFinite(n) || n < 1 || n > MAX_CITE_PICKER_LIMIT) {
      return { ok: false, reason: 'limit_invalid' };
    }
    limit = Math.floor(n);
  }
  return { ok: true, input: { cursorContext, limit } };
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export async function writingSpaceRoutes(server: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /api/writing-spaces
  // -------------------------------------------------------------------------
  server.post('/api/writing-spaces', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const validated = validateCreateInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      // TODO(child-block): mirror the role!=='child' guard once a
      // shared helper is established. For now: collective RLS prevents
      // cross-tenant access; the child-vs-adult distinction in the
      // current home collective isn't enforced here yet.
      const writingSpace = await createWritingSpace({
        ownerProfileId: profileId,
        title: validated.input.title,
        template: validated.input.template,
        workingSetId: validated.input.workingSetId,
      });
      return reply.code(201).send({ writingSpace });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to create writing space' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/writing-spaces
  // -------------------------------------------------------------------------
  server.get('/api/writing-spaces', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const writingSpaces = await listWritingSpaces();
      return reply.send({ writingSpaces });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to list writing spaces' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/writing-spaces/:id — full payload incl. citations
  // -------------------------------------------------------------------------
  server.get('/api/writing-spaces/:id', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      const writingSpace = await findWritingSpaceWithCitations(id);
      if (!writingSpace) return reply.code(404).send({ error: 'writing space not found' });
      return reply.send({ writingSpace });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to load writing space' });
    }
  });

  // -------------------------------------------------------------------------
  // PUT /api/writing-spaces/:id — save a new version
  // -------------------------------------------------------------------------
  server.put('/api/writing-spaces/:id', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      const validated = validateSaveInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      // Pre-check existence so we can return 404 cleanly instead of a
      // generic 500 from saveWritingSpaceVersion's throw.
      const existing = await findWritingSpace(id);
      if (!existing) return reply.code(404).send({ error: 'writing space not found' });

      const writingSpace = await saveWritingSpaceVersion({
        writingSpaceId: id,
        bodyMarkdown: validated.input.bodyMarkdown,
        changesSummary: validated.input.changesSummary,
        savedByProfileId: profileId,
      });
      return reply.send({ writingSpace });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to save writing space' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/writing-spaces/:id/versions
  // -------------------------------------------------------------------------
  server.get('/api/writing-spaces/:id/versions', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      const q = (request.query as { limit?: string | number } | undefined) ?? {};
      let limit = DEFAULT_VERSIONS_LIMIT;
      if (q.limit !== undefined) {
        const n = Number(q.limit);
        if (!Number.isFinite(n) || n < 1 || n > MAX_VERSIONS_LIMIT) {
          return reply.code(400).send({ error: 'invalid limit', reason: 'limit_invalid' });
        }
        limit = Math.floor(n);
      }
      const existing = await findWritingSpace(id);
      if (!existing) return reply.code(404).send({ error: 'writing space not found' });
      const versions = await listVersions(id, limit);
      return reply.send({ versions });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to list versions' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/writing-spaces/:id/versions/:n
  // -------------------------------------------------------------------------
  server.get('/api/writing-spaces/:id/versions/:n', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id, n } = request.params as { id: string; n: string };
      const versionNumber = Number(n);
      if (!Number.isFinite(versionNumber) || versionNumber < 1) {
        return reply.code(400).send({ error: 'invalid version number' });
      }
      const existing = await findWritingSpace(id);
      if (!existing) return reply.code(404).send({ error: 'writing space not found' });
      const version = await findVersion(id, Math.floor(versionNumber));
      if (!version) return reply.code(404).send({ error: 'version not found' });
      return reply.send({ version });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to load version' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/writing-spaces/:id/status — transition status
  //
  // On publish, the data layer also writes artefact_uses rows for every
  // citation. Idempotent — re-publish is safe.
  // -------------------------------------------------------------------------
  server.post('/api/writing-spaces/:id/status', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      const validated = validateStatusInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      const existing = await findWritingSpace(id);
      if (!existing) return reply.code(404).send({ error: 'writing space not found' });
      try {
        const writingSpace = await transitionStatus(id, validated.input.status);
        return reply.send({ writingSpace });
      } catch (err: any) {
        if (err?.code === 'INVALID_TRANSITION') {
          return reply.code(422).send({
            error: 'invalid status transition',
            reason: err.reason ?? 'transition_not_allowed',
            from: existing.status,
            to: validated.input.status,
          });
        }
        throw err;
      }
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to transition status' });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/writing-spaces/:id — cascade via FKs
  // -------------------------------------------------------------------------
  server.delete('/api/writing-spaces/:id', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      const ok = await deleteWritingSpace(id);
      if (!ok) return reply.code(404).send({ error: 'writing space not found' });
      return reply.code(204).send();
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to delete writing space' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/writing-spaces/:id/citations
  // -------------------------------------------------------------------------
  server.post('/api/writing-spaces/:id/citations', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      const validated = validateCiteInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      const existing = await findWritingSpace(id);
      if (!existing) return reply.code(404).send({ error: 'writing space not found' });
      const citation = await insertCitation({
        writingSpaceId: id,
        artefactSpaceUri: validated.input.artefactSpaceUri,
        passageId: validated.input.passageId,
        positionInDraft: validated.input.positionInDraft,
        surroundingHash: validated.input.surroundingHash,
        citationFormat: validated.input.citationFormat,
      });
      return reply.code(201).send({ citation });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to insert citation' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/writing-spaces/:id/citations
  // -------------------------------------------------------------------------
  server.get('/api/writing-spaces/:id/citations', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      const existing = await findWritingSpace(id);
      if (!existing) return reply.code(404).send({ error: 'writing space not found' });
      const citations = await listCitations(id);
      return reply.send({ citations });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to list citations' });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/writing-spaces/:id/citations/:citeId
  // -------------------------------------------------------------------------
  server.delete('/api/writing-spaces/:id/citations/:citeId', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id, citeId } = request.params as { id: string; citeId: string };
      const existing = await findWritingSpace(id);
      if (!existing) return reply.code(404).send({ error: 'writing space not found' });
      const ok = await deleteCitation(id, citeId);
      if (!ok) return reply.code(404).send({ error: 'citation not found' });
      return reply.code(204).send();
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to delete citation' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/writing-spaces/:id/cite-picker — deterministic ranker (W3)
  //
  // W4 will replace the body of this handler with an LLM rank step;
  // shape is locked in here so the PWA doesn't have to change when
  // the swap lands.
  // -------------------------------------------------------------------------
  server.post('/api/writing-spaces/:id/cite-picker', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      const validated = validateCitePickerInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      const existing = await findWritingSpace(id);
      if (!existing) return reply.code(404).send({ error: 'writing space not found' });
      const candidates = await runCitePickerDeterministic({
        writingSpaceId: id,
        cursorContext: validated.input.cursorContext,
        limit: validated.input.limit,
      });
      return reply.send({ candidates });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'cite-picker failed' });
    }
  });
}
