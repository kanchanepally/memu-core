/**
 * BS3 Phase W6 — Writing Space export API.
 *
 * Bridges the pure renderer pipeline (src/export/writing/) to HTTP:
 *
 *   GET  /api/writing-spaces/:id/export?target=substack
 *     → PREVIEW: render and return content (base64-encoded for binary
 *       targets, raw string for text). Does NOT log to
 *       writing_space_exports. The preview is reversible — the user
 *       sees the output and decides whether to commit.
 *
 *   POST /api/writing-spaces/:id/export?target=substack
 *     → COMMIT: same render, ALSO inserts a writing_space_exports row
 *       with content_hash (SHA-256 hex of the exported bytes). Returns
 *       the same shape plus { exportId, contentHash } so the UI can
 *       reference the commit later.
 *
 * The loader's job here is to assemble the RenderContext:
 *   - Load the writing_space row (404 if absent in active workspace)
 *   - Load citations rows (ordered by position_in_draft)
 *   - For each citation, load the cited artefact via
 *     findSpaceByUri; null = tombstone (renderer handles gracefully)
 *   - Synthesise author / year / url hints from each artefact's
 *     description + source_references (lightweight heuristics)
 *   - Load the owner profile's display_name as authorHint for the
 *     Writing Space itself
 *
 * Renderers are pure — given the same RenderContext, byte-identical
 * output. That's what makes preview-then-commit honest.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../db/tenant';
import { findSpaceByUri } from '../spaces/store';
import {
  findWritingSpace,
  listCitations,
} from '../spaces/writingSpaceStore';
import {
  renderExport,
  isExportTarget,
  type ExportTarget,
  type ExportResult,
  type RenderContext,
  type CitedArtefact,
  type CitationWithArtefact,
} from '../export/writing';
import type { CitationRow } from '../spaces/writingSpaceStore';

interface AuthedRequest extends FastifyRequest {
  profileId?: string;
  familyId?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers — synthesising hints + serialising the response
// ---------------------------------------------------------------------------

const YEAR_RE = /\b(19|20)\d{2}\b/;
const URL_RE = /\bhttps?:\/\/[^\s<>"]+/;

/**
 * Pull a 4-digit year (19xx / 20xx) out of any string. Returns the
 * first match. No year → undefined.
 */
export function extractYearHint(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(YEAR_RE);
  return m ? m[0] : undefined;
}

/**
 * Pull the first http(s) URL out of a string. No URL → undefined.
 */
export function extractUrlHint(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(URL_RE);
  return m ? m[0] : undefined;
}

/**
 * Find a URL in a Space's source_references[]. Looks for entries like
 * `document:/path/...`, `url:https://...`, or bare URLs. Falls back
 * to the first URL we can find in the descriptive metadata.
 */
export function extractAuthorHint(
  description: string | null | undefined,
  sourceReferences: readonly string[] | undefined,
): string | undefined {
  // Common patterns: "by X" / "X (2023)" / "X et al"
  if (description) {
    const by = description.match(/\bby\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,3})/);
    if (by) return by[1];
    const parens = description.match(/^([A-Z][a-zA-Z'-]+)\s*\(/);
    if (parens) return parens[1];
  }
  // source_references — pull from filename pattern
  if (sourceReferences) {
    for (const ref of sourceReferences) {
      if (typeof ref !== 'string') continue;
      const docPath = ref.match(/^document:.*\/([^/]+)$/);
      if (docPath) {
        // Use filename stem (without extension) — naive but better than nothing
        const stem = docPath[1].replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]+/g, ' ');
        if (stem) return stem.split(/\s+/).slice(0, 3).join(' ');
      }
    }
  }
  return undefined;
}

/**
 * Build a CitedArtefact from a synthesis_pages row, populating the
 * hint fields the renderers want. Returns null if the source row is
 * null (the caller surfaces this as a tombstone in the citation).
 */
export function toCitedArtefact(
  spaceRow: {
    uri: string;
    title?: string | null;
    category?: string | null;
    description?: string | null;
    bodyMarkdown?: string | null;
    sourceReferences?: readonly string[] | null;
  } | null,
): CitedArtefact | null {
  if (!spaceRow) return null;
  const description = spaceRow.description ?? '';
  const sourceReferences = spaceRow.sourceReferences ?? [];
  return {
    uri: spaceRow.uri,
    title: spaceRow.title ?? 'Untitled',
    category: spaceRow.category ?? 'document',
    description,
    bodyMarkdown: spaceRow.bodyMarkdown ?? '',
    authorHint: extractAuthorHint(description, sourceReferences),
    yearHint: extractYearHint(description) ?? extractYearHint(spaceRow.bodyMarkdown ?? ''),
    urlHint: extractUrlHint(sourceReferences.join(' ')) ?? extractUrlHint(description),
  };
}

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/x-tex'];

/**
 * Decide whether to ship the export response inline as a string or as
 * base64-encoded bytes. Tests use the buffer encoding so we keep it
 * deterministic. Markdown / plaintext targets always go inline.
 */
export function encodeContentForResponse(result: ExportResult): { encoding: 'utf8' | 'base64'; content: string } {
  const isText = TEXT_MIME_PREFIXES.some(p => result.mimeType.startsWith(p));
  if (isText) {
    const s = typeof result.content === 'string' ? result.content : result.content.toString('utf8');
    return { encoding: 'utf8', content: s };
  }
  const buf = typeof result.content === 'string' ? Buffer.from(result.content, 'utf8') : result.content;
  return { encoding: 'base64', content: buf.toString('base64') };
}

function sha256OfContent(content: string | Buffer): string {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// DB-touching loader
// ---------------------------------------------------------------------------

async function loadCitedArtefacts(
  citations: readonly CitationRow[],
): Promise<CitationWithArtefact[]> {
  // Dedup URIs so we don't hit synthesis_pages once per citation when
  // the same artefact is cited multiple times.
  const uniqueUris = Array.from(new Set(citations.map(c => c.artefactSpaceUri)));
  const cache = new Map<string, CitedArtefact | null>();
  for (const uri of uniqueUris) {
    const row = await findSpaceByUri(uri);
    cache.set(uri, toCitedArtefact(row));
  }
  return citations.map(c => ({
    id: c.id,
    artefactSpaceUri: c.artefactSpaceUri,
    passageId: c.passageId,
    positionInDraft: c.positionInDraft,
    surroundingHash: c.surroundingHash,
    citationFormat: c.citationFormat,
    artefact: cache.get(c.artefactSpaceUri) ?? null,
  }));
}

async function loadOwnerDisplayName(ownerProfileId: string): Promise<string | undefined> {
  try {
    const res = await db.queryAsBootstrap<{ display_name: string | null }>(
      `SELECT display_name FROM profiles WHERE id = $1 LIMIT 1`,
      [ownerProfileId],
    );
    return res.rows[0]?.display_name ?? undefined;
  } catch {
    return undefined;
  }
}

async function loadWorkspaceName(collectiveId: string): Promise<string | undefined> {
  try {
    const res = await db.queryAsBootstrap<{ name: string | null }>(
      `SELECT name FROM collectives WHERE id = $1 LIMIT 1`,
      [collectiveId],
    );
    return res.rows[0]?.name ?? undefined;
  } catch {
    return undefined;
  }
}

async function buildRenderContext(writingSpaceId: string): Promise<RenderContext | null> {
  const ws = await findWritingSpace(writingSpaceId);
  if (!ws) return null;
  const citations = await listCitations(writingSpaceId);
  const citationsWithArtefact = await loadCitedArtefacts(citations);
  const [authorHint, workspaceName] = await Promise.all([
    loadOwnerDisplayName(ws.ownerProfileId),
    loadWorkspaceName(ws.collectiveId),
  ]);
  return {
    writingSpaceId: ws.id,
    title: ws.title,
    template: ws.template,
    bodyMarkdown: ws.bodyMarkdown,
    citations: citationsWithArtefact,
    authorHint,
    workspaceName,
    updatedAt: ws.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Pure validators
// ---------------------------------------------------------------------------

export interface ValidatedExportQuery {
  target: ExportTarget;
}
export type ExportQueryValidation =
  | { ok: true; value: ValidatedExportQuery }
  | { ok: false; reason: 'target_required' | 'target_invalid' };

export function validateExportQuery(query: unknown): ExportQueryValidation {
  const q = (query ?? {}) as Record<string, unknown>;
  const rawTarget = typeof q.target === 'string' ? q.target.trim().toLowerCase() : '';
  if (!rawTarget) return { ok: false, reason: 'target_required' };
  if (!isExportTarget(rawTarget)) return { ok: false, reason: 'target_invalid' };
  return { ok: true, value: { target: rawTarget } };
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export async function writingSpaceExportRoutes(server: FastifyInstance) {
  // GET — preview. Renders and returns content; does NOT log.
  server.get('/api/writing-spaces/:id/export', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        return reply.code(400).send({ error: 'writing space id required' });
      }
      const validated = validateExportQuery(request.query);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid target', reason: validated.reason });
      }
      const context = await buildRenderContext(id);
      if (!context) return reply.code(404).send({ error: 'writing space not found' });

      const result = renderExport(validated.value.target, context);
      const { encoding, content } = encodeContentForResponse(result);
      return reply.send({
        target: validated.value.target,
        encoding,
        content,
        mimeType: result.mimeType,
        filename: result.filename,
        driftedCitationIds: result.driftedCitationIds,
        committed: false,
      });
    } catch (err) {
      server.log.error(err);
      const message = err instanceof Error ? err.message : 'unknown error';
      return reply.code(500).send({ error: 'export preview failed', detail: message });
    }
  });

  // POST — commit. Renders + writes writing_space_exports + returns id.
  server.post('/api/writing-spaces/:id/export', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        return reply.code(400).send({ error: 'writing space id required' });
      }
      const validated = validateExportQuery(request.query);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid target', reason: validated.reason });
      }
      const context = await buildRenderContext(id);
      if (!context) return reply.code(404).send({ error: 'writing space not found' });

      const ws = await findWritingSpace(id);
      if (!ws) return reply.code(404).send({ error: 'writing space not found' });

      const result = renderExport(validated.value.target, context);
      const { encoding, content } = encodeContentForResponse(result);
      const contentHash = sha256OfContent(result.content);

      const insertRes = await db.query<{ id: string }>(
        `INSERT INTO writing_space_exports
           (writing_space_id, target, exported_by_profile_id, content_hash, version_number)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [id, validated.value.target, profileId, contentHash, ws.currentVersion],
      );

      return reply.code(201).send({
        target: validated.value.target,
        encoding,
        content,
        mimeType: result.mimeType,
        filename: result.filename,
        driftedCitationIds: result.driftedCitationIds,
        committed: true,
        exportId: insertRes.rows[0]?.id,
        contentHash,
        versionNumber: ws.currentVersion,
      });
    } catch (err) {
      server.log.error(err);
      const message = err instanceof Error ? err.message : 'unknown error';
      return reply.code(500).send({ error: 'export commit failed', detail: message });
    }
  });

  // List recent exports for a Writing Space (audit log surface).
  server.get('/api/writing-spaces/:id/exports', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        return reply.code(400).send({ error: 'writing space id required' });
      }
      const res = await db.query<{
        id: string;
        target: string;
        exported_by_profile_id: string;
        content_hash: string;
        version_number: number;
        exported_at: Date;
      }>(
        `SELECT id, target, exported_by_profile_id, content_hash, version_number, exported_at
           FROM writing_space_exports
          WHERE writing_space_id = $1
          ORDER BY exported_at DESC
          LIMIT 50`,
        [id],
      );
      const exports = res.rows.map(r => ({
        id: r.id,
        target: r.target,
        exportedByProfileId: r.exported_by_profile_id,
        contentHash: r.content_hash,
        versionNumber: r.version_number,
        exportedAt: r.exported_at instanceof Date ? r.exported_at.toISOString() : new Date(r.exported_at).toISOString(),
      }));
      return reply.send({ writingSpaceId: id, exports });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to list exports' });
    }
  });
}
