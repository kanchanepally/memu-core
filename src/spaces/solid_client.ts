/**
 * Story 3.3c — Solid client.
 *
 * The mirror image of solid_routes.ts. Where the route file lets external
 * Solid clients READ Memu Spaces, this file lets Memu read Spaces from
 * external Solid Pods (other Memu deployments, PodSpaces, NSS, etc.) and
 * fold them into local synthesis.
 *
 * Use cases:
 *   - Tier-2 wizard discovers a family member already has a Pod elsewhere
 *     and wants to keep it as the source of truth for their personal Spaces.
 *     Memu fetches and caches; never overwrites.
 *   - Cross-household sharing (Story 3.4): one household publishes a
 *     Space; another household's Memu fetches it via WebID-based ACP.
 *
 * What this is NOT:
 *   - A general RDF/Turtle parser. We parse JSON-LD natively (it's just
 *     JSON) and markdown via gray-matter (already a dep). Turtle parsing
 *     requires n3 or rdflib; deferred to a follow-up so we don't ship a
 *     half-correct parser.
 *   - A write client. Memu does not PUT to external Pods yet — that's a
 *     separate decision (do we mirror local Spaces outward, or only ever
 *     read?).
 */

import matter from 'gray-matter';
import { Parser as N3Parser } from 'n3';
import { MEMU_VOCAB } from './solid';
import type { Space, SpaceCategory, SpaceDomain, Visibility } from './model';
import { SPACE_CATEGORIES } from './model';

export interface FetchOptions {
  /** Solid-OIDC bearer token. Optional — public Spaces fetch without one. */
  accessToken?: string;
  /**
   * Inject the fetch implementation. Defaults to globalThis.fetch.
   * Used by tests; production callers should not pass this.
   */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms. Defaults to 10s. */
  timeoutMs?: number;
  /** Conditional GET — sent as If-None-Match. Server should reply 304 on match. */
  ifNoneMatch?: string | null;
  /** Conditional GET — sent as If-Modified-Since. */
  ifModifiedSince?: string | null;
}

/** Cache hints captured from the most recent successful fetch. */
export interface FetchCacheHints {
  etag: string | null;
  lastModified: string | null;
}

/**
 * Result of a conditional fetch — either a fresh Space (with new cache hints)
 * or a 304 Not Modified marker (caller keeps the previously cached body).
 */
export type FetchResult =
  | { kind: 'fresh'; space: ExternalSpace; cacheHints: FetchCacheHints }
  | { kind: 'not_modified'; cacheHints: FetchCacheHints };

export class SolidClientError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
    this.name = 'SolidClientError';
  }
}

/**
 * Partial Space — what an external fetch can produce. The local fields
 * (familyId, id) are populated by the caller after the fetch lands; an
 * external Pod doesn't know our internal IDs and shouldn't.
 */
export type ExternalSpace = Omit<Space, 'familyId' | 'id'> & {
  /** Source URL the Space was fetched from — useful for re-fetch / dedup. */
  sourceUrl: string;
};

const ACCEPT_HEADER = 'application/ld+json, text/markdown;q=0.7, text/turtle;q=0.5';

export async function fetchExternalSpace(url: string, opts: FetchOptions = {}): Promise<ExternalSpace> {
  const result = await fetchExternalSpaceConditional(url, opts);
  if (result.kind === 'not_modified') {
    throw new SolidClientError('not_modified', `Pod returned 304 for ${url} but no cached body provided`);
  }
  return result.space;
}

/**
 * Conditional fetch — used by external_sync to avoid re-downloading bodies
 * the cache already has. Returns 'fresh' (new body + cache hints) or
 * 'not_modified' (304, caller keeps cached body, hints may have rotated).
 */
export async function fetchExternalSpaceConditional(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new SolidClientError('no_fetch', 'No fetch implementation available');
  }
  const headers: Record<string, string> = { Accept: ACCEPT_HEADER };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
  if (opts.ifNoneMatch) headers['If-None-Match'] = opts.ifNoneMatch;
  if (opts.ifModifiedSince) headers['If-Modified-Since'] = opts.ifModifiedSince;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: controller.signal });
  } catch (err) {
    throw new SolidClientError('fetch_failed', `Fetch failed for ${url}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  const cacheHints: FetchCacheHints = {
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };

  if (res.status === 304) {
    return { kind: 'not_modified', cacheHints };
  }
  if (res.status === 401 || res.status === 403) {
    throw new SolidClientError('unauthorized', `Pod refused access (${res.status}) for ${url}`);
  }
  if (!res.ok) {
    throw new SolidClientError('http_error', `Pod returned ${res.status} for ${url}`);
  }

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim();
  const body = await res.text();

  let space: ExternalSpace;
  if (contentType === 'application/ld+json' || contentType === 'application/json') {
    space = parseSpaceFromJsonLd(body, url);
  } else if (contentType === 'text/markdown' || contentType === 'text/plain' || contentType === '') {
    space = parseSpaceFromMarkdown(body, url);
  } else if (contentType === 'text/turtle' || contentType === 'application/n3' || contentType === 'text/n3') {
    space = parseSpaceFromTurtle(body, url);
  } else {
    throw new SolidClientError('unknown_content_type', `Unsupported content type "${contentType}" from ${url}`);
  }
  return { kind: 'fresh', space, cacheHints };
}

// ---------------------------------------------------------------------------
// Parsers — accept the formats serializeSpaceJsonLd / spaces/store render.
// They are NOT general RDF parsers; they reconstruct a Space from the exact
// shapes Memu (or another Memu) emits.
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '@value' in (value as object)) {
    const v = (value as Record<string, unknown>)['@value'];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => asString(v)).filter((v): v is string => v !== null);
  }
  const single = asString(value);
  return single ? [single] : [];
}

function coerceCategory(value: string | null): SpaceCategory {
  if (value && (SPACE_CATEGORIES as readonly string[]).includes(value)) {
    return value as SpaceCategory;
  }
  // Fall back to 'document' — the most generic category. The caller can
  // re-categorise after fetch if it has more context.
  return 'document';
}

function coerceVisibility(value: unknown): Visibility {
  // We don't currently round-trip visibility through JSON-LD output (the
  // serialiser hides it inside the ACP, not on the Space). External Pods
  // following our shape won't surface it either. Default to private — the
  // safest assumption for a fetched-from-elsewhere Space.
  if (Array.isArray(value)) {
    const arr = asStringArray(value);
    if (arr.length > 0) return arr;
  }
  if (typeof value === 'string') return value as Visibility;
  return 'private';
}

export function parseSpaceFromJsonLd(jsonText: string, sourceUrl: string): ExternalSpace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new SolidClientError('invalid_json', `JSON-LD parse failed for ${sourceUrl}: ${(err as Error).message}`);
  }
  const root = parsed as Record<string, unknown>;
  const graph = Array.isArray(root['@graph']) ? root['@graph'] as Array<Record<string, unknown>> : null;
  if (!graph || graph.length === 0) {
    throw new SolidClientError('empty_graph', `JSON-LD has no @graph at ${sourceUrl}`);
  }
  // Take the first node — our serialiser emits exactly one Space per graph.
  const node = graph[0];

  const name = asString(node['http://schema.org/name']) ?? 'Untitled';
  const description = asString(node['http://schema.org/description']) ?? '';
  const uri = asString(node[`${MEMU_VOCAB}uri`]) ?? sourceUrl;
  const category = coerceCategory(asString(node[`${MEMU_VOCAB}category`]));
  const slug = asString(node[`${MEMU_VOCAB}slug`]) ?? sourceUrl.split('/').pop() ?? 'untitled';
  const domains = asStringArray(node[`${MEMU_VOCAB}domain`]) as SpaceDomain[];
  const tags = asStringArray(node[`${MEMU_VOCAB}tag`]);
  const confidenceRaw = asString(node[`${MEMU_VOCAB}confidence`]);
  const confidence = confidenceRaw !== null ? Number(confidenceRaw) : 0.5;
  const modifiedRaw = asString(node['http://purl.org/dc/terms/modified']);
  const lastUpdated = modifiedRaw ? new Date(modifiedRaw) : new Date();
  const bodyMarkdown = asString(node[`${MEMU_VOCAB}bodyMarkdown`]) ?? '';

  return {
    sourceUrl,
    uri,
    category,
    slug,
    name,
    description,
    domains,
    people: [],
    visibility: coerceVisibility(undefined),
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    sourceReferences: [sourceUrl],
    tags,
    bodyMarkdown,
    lastUpdated,
  };
}

export function parseSpaceFromTurtle(ttl: string, sourceUrl: string): ExternalSpace {
  const parser = new N3Parser();
  let quads: Array<{ subject: { value: string }; predicate: { value: string }; object: { value: string; termType: string } }>;
  try {
    quads = parser.parse(ttl) as typeof quads;
  } catch (err) {
    throw new SolidClientError('invalid_turtle', `Turtle parse failed for ${sourceUrl}: ${(err as Error).message}`);
  }
  if (quads.length === 0) {
    throw new SolidClientError('empty_graph', `Turtle has no triples at ${sourceUrl}`);
  }

  // Pick the subject that carries memu:slug or memu:category — that's our
  // Space node. Falls back to the first subject if none is marked.
  const SLUG = `${MEMU_VOCAB}slug`;
  const CATEGORY = `${MEMU_VOCAB}category`;
  const URI = `${MEMU_VOCAB}uri`;
  const DOMAIN = `${MEMU_VOCAB}domain`;
  const TAG = `${MEMU_VOCAB}tag`;
  const CONFIDENCE = `${MEMU_VOCAB}confidence`;
  const BODY = `${MEMU_VOCAB}bodyMarkdown`;
  const NAME = 'http://schema.org/name';
  const DESCRIPTION = 'http://schema.org/description';
  const MODIFIED = 'http://purl.org/dc/terms/modified';

  const bySubject = new Map<string, Map<string, string[]>>();
  for (const q of quads) {
    let subj = bySubject.get(q.subject.value);
    if (!subj) {
      subj = new Map();
      bySubject.set(q.subject.value, subj);
    }
    const arr = subj.get(q.predicate.value) ?? [];
    arr.push(q.object.value);
    subj.set(q.predicate.value, arr);
  }

  let chosen: Map<string, string[]> | null = null;
  for (const preds of bySubject.values()) {
    if (preds.has(SLUG) || preds.has(CATEGORY)) {
      chosen = preds;
      break;
    }
  }
  if (!chosen) chosen = bySubject.values().next().value ?? null;
  if (!chosen) {
    throw new SolidClientError('empty_graph', `Turtle has no subject at ${sourceUrl}`);
  }

  const first = (key: string): string | null => chosen!.get(key)?.[0] ?? null;
  const all = (key: string): string[] => chosen!.get(key) ?? [];

  const slugFromUrl = sourceUrl.split('/').pop() ?? 'untitled';
  const confidenceRaw = first(CONFIDENCE);
  const confidence = confidenceRaw !== null ? Number(confidenceRaw) : 0.5;
  const modifiedRaw = first(MODIFIED);
  const lastUpdated = modifiedRaw ? new Date(modifiedRaw) : new Date();

  return {
    sourceUrl,
    uri: first(URI) ?? sourceUrl,
    category: coerceCategory(first(CATEGORY)),
    slug: first(SLUG) ?? slugFromUrl,
    name: first(NAME) ?? 'Untitled',
    description: first(DESCRIPTION) ?? '',
    domains: all(DOMAIN) as SpaceDomain[],
    people: [],
    visibility: coerceVisibility(undefined),
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    sourceReferences: [sourceUrl],
    tags: all(TAG),
    bodyMarkdown: first(BODY) ?? '',
    lastUpdated,
  };
}

export function parseSpaceFromMarkdown(text: string, sourceUrl: string): ExternalSpace {
  const parsed = matter(text);
  const fm = parsed.data as Record<string, unknown>;
  const slugFromUrl = sourceUrl.split('/').pop() ?? 'untitled';

  const category = coerceCategory(typeof fm.category === 'string' ? fm.category : null);
  const slug = typeof fm.slug === 'string' ? fm.slug : slugFromUrl;
  const lastUpdated = typeof fm.last_updated === 'string'
    ? new Date(fm.last_updated)
    : (fm.last_updated instanceof Date ? fm.last_updated : new Date());

  return {
    sourceUrl,
    uri: typeof fm.id === 'string' ? fm.id : sourceUrl,
    category,
    slug,
    name: typeof fm.name === 'string' ? fm.name : slug,
    description: typeof fm.description === 'string' ? fm.description : '',
    domains: Array.isArray(fm.domains) ? (fm.domains as SpaceDomain[]) : [],
    people: Array.isArray(fm.people) ? (fm.people as string[]) : [],
    visibility: coerceVisibility(fm.visibility),
    confidence: typeof fm.confidence === 'number' ? fm.confidence : 0.5,
    sourceReferences: Array.isArray(fm.source_references) ? (fm.source_references as string[]) : [sourceUrl],
    tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
    bodyMarkdown: parsed.content.trim(),
    lastUpdated,
  };
}
