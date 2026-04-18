/**
 * Story 3.3a — Solid HTTP read surface for Spaces.
 *
 * Routes:
 *   GET  /spaces/:category/:slug         → markdown body | Turtle | JSON-LD
 *   HEAD /spaces/:category/:slug         → headers only
 *   GET  /spaces/:category/:slug?ext=acp → ACP Turtle resource
 *
 * Auth: Solid-OIDC bearer token (JWT signed by our provider). The token's
 * webid claim identifies the caller; the caller must appear in the
 * Space's allowed-readers set (derived from the visibility field) or the
 * request 403s. Default-deny.
 *
 * What this is NOT:
 *   - Not for write methods (PUT/PATCH/DELETE) — Story 3.3b.
 *   - Not for the per-person Pod root (<base>/spaces/<webid_slug>/) —
 *     that's also Story 3.3b along with typeIndex.
 *   - Not for cross-issuer tokens — Story 3.3c handles external Solid IdPs.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  negotiateSpaceContentType,
  serializeSpaceTurtle,
  serializeSpaceJsonLd,
  serializeAcp,
  serializeContainer,
  serializeTypeIndex,
  defaultTypeIndexEntries,
  buildAcpLookup,
  buildSpaceHttpUrl,
  deriveAllowedReaders,
  type ContainerEntry,
} from './solid';
import type { Space, SpaceCategory } from './model';
import { SPACE_CATEGORIES } from './model';
import { findSpaceBySlug, listSpaces, upsertSpace, deleteSpace } from './store';
import { loadRoster } from './catalogue';
import { extractBearerToken, verifyBearer, verifyDpopProof, BearerVerificationError } from '../oidc/bearer';
import { resolveWebIdBaseUrl } from '../webid/webid';
import { pool } from '../db/connection';

type AnyFastify = any;

const SOLID_LINK_HEADER = (acpUrl: string) => `<${acpUrl}>; rel="acl"`;

interface RouteParams {
  category: string;
  slug: string;
}

interface RouteQuery {
  ext?: string;
}

function isKnownCategory(value: string): value is SpaceCategory {
  return (SPACE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The single-family deployment convention: family_id is the primary
 * admin's profile_id. We resolve it once per request from the verified
 * caller — every profile in a single-family deployment shares the same
 * family_id. When real multi-tenancy lands this becomes a profile lookup.
 */
async function resolveFamilyIdForCaller(callerProfileId: string): Promise<string> {
  // Conservative: in single-family mode, take the lowest-created admin
  // (the original primary). Falls back to the caller themselves if no
  // admin row exists yet (fresh install edge case).
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM profiles
      WHERE role IN ('admin', 'adult')
      ORDER BY created_at ASC
      LIMIT 1`,
  );
  return res.rows[0]?.id ?? callerProfileId;
}

async function loadProfileLookupRows(): Promise<Array<{ id: string; webid_slug: string | null }>> {
  const res = await pool.query<{ id: string; webid_slug: string | null }>(
    `SELECT id, webid_slug FROM profiles`,
  );
  return res.rows;
}

async function loadProfileByWebIdSlug(slug: string): Promise<{ id: string; role: string } | null> {
  const res = await pool.query<{ id: string; role: string }>(
    `SELECT id, role FROM profiles WHERE webid_slug = $1 LIMIT 1`,
    [slug],
  );
  return res.rows[0] ?? null;
}

function baseFromRequest(request: FastifyRequest): string {
  // Strip path + query so we end up with just `<scheme>://<host>`. The
  // request URL always starts with `/`, so `split('/')[0]` of the path
  // segment is empty — we just want to anchor on protocol + hostname.
  return `${request.protocol}://${request.hostname}`;
}

/**
 * Verify the bearer and return the caller, or send the right error
 * response and return null. The route handler then returns early.
 */
async function authenticateOrReject(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ profileId: string; webid: string } | null> {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    reply.code(401);
    reply.header('WWW-Authenticate', 'Bearer realm="memu", error="invalid_request"');
    reply.type('text/plain');
    reply.send('Authentication required');
    return null;
  }
  try {
    const verified = await verifyBearer(token);

    // DPoP-bound tokens (RFC 9449) carry a cnf.jkt thumbprint. When that is
    // present we MUST verify the accompanying DPoP proof header binds the
    // request method+URI to the holder of the matching key. A token with
    // cnf.jkt sent without a valid DPoP proof is a stolen token.
    if (verified.cnfJkt) {
      const dpopHeader = request.headers['dpop'];
      const proof = Array.isArray(dpopHeader) ? dpopHeader[0] : dpopHeader;
      if (!proof || typeof proof !== 'string') {
        reply.code(401);
        reply.header('WWW-Authenticate', 'DPoP realm="memu", error="invalid_dpop_proof"');
        reply.type('text/plain');
        reply.send('DPoP proof required for this access token');
        return null;
      }
      const htu = `${resolveWebIdBaseUrl()}${request.url.split('?')[0]}`;
      try {
        await verifyDpopProof(proof, {
          htm: request.method,
          htu,
          accessToken: token,
          expectedJkt: verified.cnfJkt,
        });
      } catch (err) {
        if (err instanceof BearerVerificationError) {
          request.log.warn({ reason: err.reason }, 'DPoP proof rejected');
        } else {
          request.log.error({ err }, 'DPoP verification crashed');
        }
        reply.code(401);
        reply.header('WWW-Authenticate', 'DPoP realm="memu", error="invalid_dpop_proof"');
        reply.type('text/plain');
        reply.send('Invalid DPoP proof');
        return null;
      }
    }

    return { profileId: verified.profileId, webid: verified.webid };
  } catch (err) {
    if (err instanceof BearerVerificationError) {
      request.log.warn({ reason: err.reason }, 'Solid bearer rejected');
    } else {
      request.log.error({ err }, 'Solid bearer verification crashed');
    }
    reply.code(401);
    reply.header('WWW-Authenticate', 'Bearer realm="memu", error="invalid_token"');
    reply.type('text/plain');
    reply.send('Invalid access token');
    return null;
  }
}

/**
 * Read the raw text body off a Solid PUT/POST/PATCH. Fastify's default
 * JSON parser doesn't handle text/markdown or text/turtle, so we register
 * a passthrough parser that hands us the bytes as a string.
 */
function registerTextBodyParsers(server: AnyFastify): void {
  for (const ct of ['text/markdown', 'text/turtle', 'text/plain', 'application/n3']) {
    try {
      server.addContentTypeParser(ct, { parseAs: 'string' }, (_req: unknown, body: string, done: (err: Error | null, val?: string) => void) => {
        done(null, body);
      });
    } catch {
      // already registered (route registered twice in tests etc.) — fine
    }
  }
}

interface AuthorizedWriter {
  caller: { profileId: string; webid: string };
  role: string;
}

/**
 * Verify the bearer AND the caller's profile role. Writes are blocked
 * for children and for unknown profiles. Returns null if a response was
 * already sent.
 */
async function authorizeWrite(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthorizedWriter | null> {
  const caller = await authenticateOrReject(request, reply);
  if (!caller) return null;
  const res = await pool.query<{ role: string }>(
    `SELECT role FROM profiles WHERE id = $1 LIMIT 1`,
    [caller.profileId],
  );
  const role = res.rows[0]?.role ?? 'unknown';
  if (role === 'child') {
    reply.code(403).type('text/plain').send('Children cannot write Spaces');
    return null;
  }
  if (role !== 'admin' && role !== 'adult') {
    reply.code(403).type('text/plain').send('Caller has no role with write access');
    return null;
  }
  return { caller, role };
}

export function registerSolidSpaceRoutes(server: AnyFastify): void {
  registerTextBodyParsers(server);

  server.get(
    '/spaces/:category/:slug',
    async (request: FastifyRequest<{ Params: RouteParams; Querystring: RouteQuery }>, reply: FastifyReply) => {
      const { category, slug } = request.params;
      if (!isKnownCategory(category)) {
        // Forward to per-person Pod root handling (Story 3.3b). For now,
        // 404 — the only second-segment values we serve are categories.
        return reply.code(404).type('text/plain').send(`Unknown Space category: ${category}`);
      }

      const caller = await authenticateOrReject(request, reply);
      if (!caller) return;

      const familyId = await resolveFamilyIdForCaller(caller.profileId);
      const space = await findSpaceBySlug(familyId, category, slug);
      if (!space) {
        return reply.code(404).type('text/plain').send(`No Space at ${category}/${slug}`);
      }

      const roster = await loadRoster(familyId);
      const lookupRows = await loadProfileLookupRows();
      const acpLookup = buildAcpLookup(lookupRows);
      const allowedReaders = deriveAllowedReaders(space, roster, acpLookup);

      // ?ext=acp returns the ACP resource itself. The ACP resource is
      // public-by-design within the Solid model — clients must be able
      // to fetch it to learn whether to bother with the body. We still
      // require a valid bearer to discourage casual probing.
      if (request.query.ext === 'acp') {
        const acp = serializeAcp(category, slug, allowedReaders);
        reply.type('text/turtle; charset=utf-8');
        return acp;
      }

      // Visibility check. The ACP is the published contract, but we
      // enforce it in code too — must match.
      if (!allowedReaders.includes(caller.webid)) {
        return reply.code(403).type('text/plain').send('Not authorised to read this Space');
      }

      const acpUrl = `${request.protocol}://${request.hostname}${request.url.split('?')[0]}?ext=acp`;
      reply.header('Link', SOLID_LINK_HEADER(acpUrl));

      const contentType = negotiateSpaceContentType(request.headers.accept);
      reply.header('Content-Type', `${contentType}; charset=utf-8`);
      reply.header('Last-Modified', new Date(space.lastUpdated).toUTCString());
      reply.header('Vary', 'Accept');

      if (contentType === 'application/ld+json') {
        return serializeSpaceJsonLd(space);
      }
      if (contentType === 'text/turtle') {
        return serializeSpaceTurtle(space);
      }
      return space.bodyMarkdown;
    },
  );

  server.head(
    '/spaces/:category/:slug',
    async (request: FastifyRequest<{ Params: RouteParams; Querystring: RouteQuery }>, reply: FastifyReply) => {
      const { category, slug } = request.params;
      if (!isKnownCategory(category)) {
        return reply.code(404).send('');
      }
      const caller = await authenticateOrReject(request, reply);
      if (!caller) return;

      const familyId = await resolveFamilyIdForCaller(caller.profileId);
      const space = await findSpaceBySlug(familyId, category, slug);
      if (!space) return reply.code(404).send('');

      const roster = await loadRoster(familyId);
      const lookupRows = await loadProfileLookupRows();
      const acpLookup = buildAcpLookup(lookupRows);
      const allowedReaders = deriveAllowedReaders(space, roster, acpLookup);
      if (!allowedReaders.includes(caller.webid)) return reply.code(403).send('');

      const acpUrl = `${request.protocol}://${request.hostname}${request.url.split('?')[0]}?ext=acp`;
      reply.header('Link', SOLID_LINK_HEADER(acpUrl));

      const contentType = negotiateSpaceContentType(request.headers.accept);
      reply.header('Content-Type', `${contentType}; charset=utf-8`);
      reply.header('Last-Modified', new Date(space.lastUpdated).toUTCString());
      reply.header('Vary', 'Accept');
      return reply.send('');
    },
  );

  // -------------------------------------------------------------------------
  // PUT /spaces/:category/:slug — create or replace a Space body.
  //
  // Accepts text/markdown (default) as the new body. The slug is taken
  // straight from the URL — Solid editors typically choose their own slugs
  // and we honour that. If the Space exists, the caller must already be in
  // its allowed-readers (you cannot edit a Space you can't see). If it's
  // a new Space, default visibility is 'family' (so the rest of the
  // household can see what you wrote) and the title defaults to the slug.
  //
  // What this is NOT:
  //   - DPoP proof verification of method+url+body (3.3b/c follow-up).
  //   - PATCH (N3 patches / SPARQL UPDATE) — clients that need partial
  //     updates can re-PUT the whole body for now.
  // -------------------------------------------------------------------------
  server.put(
    '/spaces/:category/:slug',
    async (request: FastifyRequest<{ Params: RouteParams; Body: unknown }>, reply: FastifyReply) => {
      const { category, slug } = request.params;
      if (!isKnownCategory(category)) {
        return reply.code(404).type('text/plain').send(`Unknown Space category: ${category}`);
      }
      const writer = await authorizeWrite(request, reply);
      if (!writer) return;

      const familyId = await resolveFamilyIdForCaller(writer.caller.profileId);

      // If the Space already exists, enforce the existing visibility — the
      // caller has to be in the allowed-readers set or they get 403.
      const existing = await findSpaceBySlug(familyId, category, slug);
      if (existing) {
        const roster = await loadRoster(familyId);
        const lookupRows = await loadProfileLookupRows();
        const acpLookup = buildAcpLookup(lookupRows);
        const allowedReaders = deriveAllowedReaders(existing, roster, acpLookup);
        if (!allowedReaders.includes(writer.caller.webid)) {
          return reply.code(403).type('text/plain').send('Not authorised to write this Space');
        }
      }

      const body = typeof request.body === 'string' ? request.body : '';
      // The mobile app PUTs JSON occasionally during development; fall
      // back to JSON-stringifying the body so we don't silently swallow
      // it. Real Solid clients always send text/markdown.
      const bodyMarkdown = body.length > 0
        ? body
        : (request.body == null ? '' : JSON.stringify(request.body));

      const space = await upsertSpace({
        familyId,
        category,
        slug,
        name: existing?.name ?? slug,
        bodyMarkdown,
        description: existing?.description,
        domains: existing?.domains,
        people: existing?.people,
        visibility: existing?.visibility,
        confidence: existing?.confidence,
        sourceReferences: existing?.sourceReferences,
        tags: existing?.tags,
        actorProfileId: writer.caller.profileId,
      });

      const acpUrl = `${baseFromRequest(request)}${request.url.split('?')[0]}?ext=acp`;
      reply.header('Link', SOLID_LINK_HEADER(acpUrl));
      reply.header('Location', buildSpaceHttpUrl(category, slug, baseFromRequest(request)));
      reply.code(existing ? 204 : 201);
      reply.type('text/plain');
      return reply.send(existing ? '' : `Created ${space.uri}`);
    },
  );

  server.delete(
    '/spaces/:category/:slug',
    async (request: FastifyRequest<{ Params: RouteParams }>, reply: FastifyReply) => {
      const { category, slug } = request.params;
      if (!isKnownCategory(category)) {
        return reply.code(404).type('text/plain').send(`Unknown Space category: ${category}`);
      }
      const writer = await authorizeWrite(request, reply);
      if (!writer) return;

      const familyId = await resolveFamilyIdForCaller(writer.caller.profileId);
      const existing = await findSpaceBySlug(familyId, category, slug);
      if (!existing) {
        // 404 not 204 — the spec says DELETE on a missing resource is a
        // 404, and we want to surface that to clients that may have stale
        // listings.
        return reply.code(404).type('text/plain').send(`No Space at ${category}/${slug}`);
      }

      const roster = await loadRoster(familyId);
      const lookupRows = await loadProfileLookupRows();
      const acpLookup = buildAcpLookup(lookupRows);
      const allowedReaders = deriveAllowedReaders(existing, roster, acpLookup);
      if (!allowedReaders.includes(writer.caller.webid)) {
        return reply.code(403).type('text/plain').send('Not authorised to delete this Space');
      }

      await deleteSpace(familyId, category, slug, writer.caller.profileId);
      reply.code(204);
      return reply.send('');
    },
  );

  // -------------------------------------------------------------------------
  // GET /spaces/:segment/ — LDP container.
  //
  // The trailing slash distinguishes this from /spaces/:category/:slug
  // (3-segment). Two flavours of segment:
  //   - A known SPACE_CATEGORIES value (`person`, `routine`, ...) →
  //     per-category container listing every Space of that category the
  //     caller can see.
  //   - Anything else → treated as a webid_slug. Returns the per-person
  //     container: every Space where that profile is in `space.people`,
  //     filtered by what the caller can see.
  // -------------------------------------------------------------------------
  server.get(
    '/spaces/:segment/',
    async (request: FastifyRequest<{ Params: { segment: string } }>, reply: FastifyReply) => {
      const { segment } = request.params;
      const caller = await authenticateOrReject(request, reply);
      if (!caller) return;
      const familyId = await resolveFamilyIdForCaller(caller.profileId);
      const roster = await loadRoster(familyId);
      const lookupRows = await loadProfileLookupRows();
      const acpLookup = buildAcpLookup(lookupRows);
      const base = baseFromRequest(request);
      const containerUrl = `${base}${request.url.split('?')[0]}`;

      const all = await listSpaces(familyId);
      let filtered: Space[];
      if (isKnownCategory(segment)) {
        filtered = all.filter(s => s.category === segment);
      } else {
        const subject = await loadProfileByWebIdSlug(segment);
        if (!subject) {
          return reply.code(404).type('text/plain').send(`No Pod root for /${segment}/`);
        }
        filtered = all.filter(s => s.people.includes(subject.id));
      }

      // Default-deny visibility: only include Spaces the caller can see.
      const visible = filtered.filter(s => {
        const allowed = deriveAllowedReaders(s, roster, acpLookup);
        return allowed.includes(caller.webid);
      });

      const entries: ContainerEntry[] = visible.map(s => ({
        url: buildSpaceHttpUrl(s.category, s.slug, base),
        title: s.name,
      }));

      reply.type('text/turtle; charset=utf-8');
      reply.header('Vary', 'Accept');
      return serializeContainer(containerUrl, entries);
    },
  );

  // -------------------------------------------------------------------------
  // GET /typeIndex — published map of "what kinds of things live here."
  //
  // Public-by-design within the Solid model: discovery requires it. We
  // still gate on a valid bearer to discourage casual probing. The URL
  // is referenced from each WebID profile via solid:publicTypeIndex
  // (added to webid.ts in a follow-up).
  // -------------------------------------------------------------------------
  server.get(
    '/typeIndex',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const caller = await authenticateOrReject(request, reply);
      if (!caller) return;
      const base = baseFromRequest(request);
      const url = `${base}/typeIndex`;
      reply.type('text/turtle; charset=utf-8');
      return serializeTypeIndex(url, defaultTypeIndexEntries(base));
    },
  );

  server.log.info('Solid Space routes live at /spaces/:category/:slug, /spaces/:segment/, /typeIndex');
}
