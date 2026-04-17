/**
 * Story 1.6 — WebID server routes.
 *
 * Serves the Solid-compatible profile document for every Memu profile.
 * Anonymous callers get the public fields (name, oidcIssuer, storage).
 * Authenticated callers who are the subject themselves get richer data
 * (email). Authentication here is the same Bearer-token API-key scheme
 * used elsewhere in memu-core — we deliberately don't require Solid-OIDC
 * to read a *public* profile document, because that would create a
 * circular dependency (clients need the profile document to discover
 * where to auth).
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

// Fastify generics fight with the concrete pino-typed instance in index.ts;
// the API surface we touch (get/head/log) is stable across both shapes, so
// we accept `any` here and rely on the route handlers' own typing.
type AnyFastify = any;
import { pool } from '../db/connection';
import { getProfileByApiKey } from '../auth';
import {
  serializeTurtle,
  serializeJsonLd,
  negotiateContentType,
  resolveWebIdBaseUrl,
  type WebIdProfile,
} from './webid';

interface ProfileRow {
  id: string;
  display_name: string;
  webid_slug: string | null;
  role: string;
  email: string | null;
  updated_at: Date | null;
}

async function loadProfileBySlug(slug: string): Promise<ProfileRow | null> {
  const res = await pool.query<ProfileRow>(
    `SELECT id, display_name, webid_slug, role, email, updated_at
       FROM profiles
      WHERE webid_slug = $1
      LIMIT 1`,
    [slug],
  );
  return res.rows[0] ?? null;
}

async function loadProfileById(id: string): Promise<ProfileRow | null> {
  const res = await pool.query<ProfileRow>(
    `SELECT id, display_name, webid_slug, role, email, updated_at
       FROM profiles
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  return res.rows[0] ?? null;
}

function toWebIdProfile(row: ProfileRow): WebIdProfile {
  return {
    id: row.id,
    slug: row.webid_slug ?? row.id,
    displayName: row.display_name,
    role: row.role,
    email: row.email,
  };
}

/**
 * Decide whether to include private fields. The caller is authorised
 * iff they provided a valid Bearer API key that matches the subject.
 * We don't throw on mismatches — anonymous reads are a first-class use
 * case for WebID.
 */
async function callerIsSubject(request: FastifyRequest, subjectId: string): Promise<boolean> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  const key = header.slice(7);
  const profile = await getProfileByApiKey(key);
  return !!profile && profile.id === subjectId;
}

function applyLastModified(reply: FastifyReply, row: ProfileRow): void {
  if (row.updated_at) {
    reply.header('Last-Modified', new Date(row.updated_at).toUTCString());
  }
}

/**
 * Serve a single profile document. Content-negotiates between Turtle and
 * JSON-LD. Returns 404 (in Turtle or JSON, per Accept) if the slug is
 * unknown — Solid clients handle 404 on a WebID as "person doesn't exist
 * at this issuer" which is the right signal.
 */
function registerPeopleRoute(server: AnyFastify): void {
  server.get('/people/:slug', async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const row = await loadProfileBySlug(request.params.slug);
    if (!row) {
      reply.code(404).type('text/plain');
      return `# Unknown profile slug: ${request.params.slug}\n`;
    }

    const contentType = negotiateContentType(request.headers.accept);
    const includePrivate = await callerIsSubject(request, row.id);

    applyLastModified(reply, row);
    reply.header('Content-Type', `${contentType}; charset=utf-8`);
    // WebID profile documents are public by default. Allow CORS so
    // browser-based Solid clients can fetch them without a proxy.
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Accept');

    const profile = toWebIdProfile(row);
    if (contentType === 'application/ld+json') {
      return serializeJsonLd(profile, { includePrivate });
    }
    return serializeTurtle(profile, { includePrivate });
  });

  // HEAD is equivalent to GET without the body. Solid clients sometimes
  // HEAD before GET to check freshness.
  server.head('/people/:slug', async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const row = await loadProfileBySlug(request.params.slug);
    if (!row) {
      reply.code(404);
      return '';
    }
    const contentType = negotiateContentType(request.headers.accept);
    applyLastModified(reply, row);
    reply.header('Content-Type', `${contentType}; charset=utf-8`);
    reply.header('Access-Control-Allow-Origin', '*');
    return '';
  });
}

/**
 * `/api/profile/card` returns the authenticated user's WebID profile
 * document directly, with private fields included. Useful to the mobile
 * app Settings screen for showing the user their own canonical identity.
 */
function registerProfileCardRoute(server: AnyFastify): void {
  server.get('/api/profile/card', async (request: FastifyRequest, reply: FastifyReply) => {
    const profileId = (request as any).profileId as string | undefined;
    if (!profileId) {
      // Shouldn't happen — the global auth preHandler rejects first —
      // but fail closed.
      return reply.code(401).send({ error: 'Not authenticated' });
    }
    const row = await loadProfileById(profileId);
    if (!row) return reply.code(404).send({ error: 'Profile not found' });

    const contentType = negotiateContentType(request.headers.accept);
    applyLastModified(reply, row);
    reply.header('Content-Type', `${contentType}; charset=utf-8`);

    const profile = toWebIdProfile(row);
    if (contentType === 'application/ld+json') {
      return serializeJsonLd(profile, { includePrivate: true });
    }
    return serializeTurtle(profile, { includePrivate: true });
  });
}

export function registerWebIdRoutes(server: AnyFastify): void {
  registerPeopleRoute(server);
  registerProfileCardRoute(server);
  server.log.info(`WebID routes live; base URL = ${resolveWebIdBaseUrl()}`);
}
