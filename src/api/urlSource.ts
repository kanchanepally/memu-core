/**
 * POST /api/source/url — paste-a-link source ingestion.
 *
 * Mirrors /api/document but takes a URL instead of a base64 file. Path:
 *
 *   { url, caption? }
 *      ↓ validateUrl + SSRF guard
 *      ↓ fetch(15s, follow 5 redirects, text/html only)
 *      ↓ sanitise + extract main content
 *      ↓ htmlToMarkdown + frontmatter
 *      ↓ processDocumentIngestion (text/plain)
 *
 * Response shape matches /api/document's success body so the workbench
 * UI can render either ingestion source uniformly. Failures map to:
 *   400 — input/validation (url_required, invalid_url, etc.)
 *   403 — child profile blocked (same posture as /api/document)
 *   422 — fetch / extract / ingest failure (network, not_html, etc.)
 *   500 — unexpected
 *
 * Auth is the same as /api/document — request.profileId + request.profile
 * are populated by the global pre-handler chain in index.ts; this plugin
 * just consumes them. The Twin anonymisation runs inside
 * processDocumentIngestion (the dispatched document_ingestion skill is
 * requires_twin: true), so this layer never sees real names from the
 * fetched body.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ingestUrlAsSource, type UrlIngestionInput } from '../intelligence/urlIngestion';

interface AuthedRequest extends FastifyRequest {
  profileId?: string;
  familyId?: string;
  profile?: { role?: string };
}

// ---------------------------------------------------------------------------
// Pure validator
// ---------------------------------------------------------------------------

export interface UrlSourceBody {
  url: string;
  caption?: string;
}

export type UrlSourceBodyValidation =
  | { ok: true; body: UrlSourceBody }
  | { ok: false; reason: 'body_required' | 'url_required' | 'caption_too_long' };

const MAX_CAPTION_CHARS = 500;

export function validateUrlSourceBody(raw: unknown): UrlSourceBodyValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'body_required' };
  const b = raw as Record<string, unknown>;
  const url = typeof b.url === 'string' ? b.url.trim() : '';
  if (!url) return { ok: false, reason: 'url_required' };
  let caption: string | undefined;
  if (b.caption !== undefined && b.caption !== null) {
    if (typeof b.caption !== 'string') return { ok: false, reason: 'caption_too_long' };
    const trimmed = b.caption.trim();
    if (trimmed.length > MAX_CAPTION_CHARS) return { ok: false, reason: 'caption_too_long' };
    if (trimmed.length > 0) caption = trimmed;
  }
  return { ok: true, body: { url, caption } };
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export async function urlSourceRoutes(server: FastifyInstance) {
  server.post('/api/source/url', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) {
        return reply.code(401).send({ error: 'not authenticated' });
      }
      // Same child-block posture as /api/document — children cannot ingest
      // sources in v1 (Article 20 export, source review, and the
      // research-workspace pivot all gate on adult profiles).
      if (request.profile?.role === 'child') {
        return reply.code(403).send({ error: 'children cannot ingest URL sources' });
      }

      const validated = validateUrlSourceBody(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid body', reason: validated.reason });
      }

      const input: UrlIngestionInput = {
        url: validated.body.url,
        callerProfileId: profileId,
        // documentIngestion keys storage + Space on profileId (familyId
        // === profileId in the current single-tenant pre-multi-collective
        // shape — same convention as the /api/document handler).
        callerFamilyId: profileId,
        caption: validated.body.caption,
      };

      const outcome = await ingestUrlAsSource(input);
      if (!outcome.ok) {
        const failure = outcome.failure;
        if ('stage' in failure && failure.stage === 'validate') {
          return reply.code(400).send({ error: 'invalid url', reason: failure.reason });
        }
        if ('stage' in failure && failure.stage === 'fetch') {
          return reply.code(422).send({
            error: 'fetch failed',
            reason: failure.reason,
            detail: failure.detail,
          });
        }
        if ('stage' in failure && failure.stage === 'extract') {
          return reply.code(422).send({ error: 'no content extracted', reason: failure.reason });
        }
        if ('stage' in failure && failure.stage === 'ingest') {
          return reply.code(422).send({
            error: failure.result.error,
            stage: failure.result.stage,
          });
        }
        // Defensive: an unknown failure shape — surface as 500 so it
        // doesn't silently return 200.
        return reply.code(500).send({ error: 'url ingestion failed (unknown shape)' });
      }

      const result = outcome.result;
      return reply.send({
        ok: true,
        spaceUri: result.spaceUri,
        spaceTitle: result.spaceTitle,
        docType: result.docType,
        charCount: result.charCount,
        truncated: result.truncated,
        streamCardCount: result.streamCardCount,
        followupText: result.followupText,
        finalUrl: outcome.finalUrl,
      });
    } catch (err) {
      server.log.error(err);
      const message = err instanceof Error ? err.message : 'unknown error';
      return reply.code(500).send({ error: 'URL source ingestion failed', detail: message });
    }
  });
}
