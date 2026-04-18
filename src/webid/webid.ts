/**
 * Story 1.6 — WebID document generation.
 *
 * Each Memu profile has a stable WebID. The WebID resolves to an RDF
 * profile document containing (at minimum) foaf:name, solid:oidcIssuer,
 * and a storage pointer. This is the shape a Solid-compliant Pod provider
 * exposes, so Memu family members can authenticate to any Solid client
 * using their WebID.
 *
 * URL shape, keyed off MEMU_WEBID_BASE_URL:
 *   WebID:      <base>/people/<slug>#me
 *   Profile doc: <base>/people/<slug>
 *   Storage:    <base>/spaces/<slug>/    (materialised in Story 3.3)
 *
 * Tier 2 (self-hosted): base is the Tailscale hostname or family domain.
 * Tier 1 (cloud SaaS):  base is https://<family_slug>.memu.digital.
 */

export interface WebIdProfile {
  /** Profiles table id. Stable internal identifier, never exposed in the WebID. */
  id: string;
  /** Human-readable, unique slug used in WebID URL paths. */
  slug: string;
  /** Display name for foaf:name. Public field. */
  displayName: string;
  /** 'adult' | 'admin' | 'child'. Used to gate what richer data returns to authenticated callers. */
  role: string;
  /** Email. Only included for authenticated callers who are the subject themselves. */
  email?: string | null;
}

export interface SerializeOptions {
  /**
   * If true, include richer data (email, extended metadata). Callers pass
   * true only after verifying the requester is authorised (typically the
   * subject themselves via Solid-OIDC).
   */
  includePrivate?: boolean;
  /**
   * Override the base URL. Used by tests and by request-time resolution
   * when the incoming Host header differs from the env default.
   */
  baseUrlOverride?: string;
}

/**
 * Resolve the base URL for WebIDs. Precedence:
 *   1. MEMU_WEBID_BASE_URL env var (explicit operator config)
 *   2. PUBLIC_BASE_URL env var (shared with other services)
 *   3. http://localhost:<PORT>  (dev fallback)
 *
 * Trailing slashes are stripped so callers can always concatenate.
 */
export function resolveWebIdBaseUrl(): string {
  const explicit = process.env.MEMU_WEBID_BASE_URL || process.env.PUBLIC_BASE_URL;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/+$/, '');
  }
  const port = process.env.PORT || '3100';
  return `http://localhost:${port}`;
}

/**
 * Build the WebID URI (with #me fragment) for a profile slug.
 * The WebID identifies the *person*; the enclosing URL (without the
 * fragment) identifies the *document that describes the person*.
 */
export function buildWebId(slug: string, base?: string): string {
  const b = base ?? resolveWebIdBaseUrl();
  return `${b}/people/${encodeURIComponent(slug)}#me`;
}

export function buildProfileDocUrl(slug: string, base?: string): string {
  const b = base ?? resolveWebIdBaseUrl();
  return `${b}/people/${encodeURIComponent(slug)}`;
}

/**
 * Storage pointer. Phase 3 (Story 3.3) actually serves content at this
 * URL. For now it's a forward-compatible promise: Solid clients that
 * follow the pointer get a 404 with a well-formed error until Phase 3
 * lands, which is the same behaviour as a legitimate Pod with an
 * unpopulated storage root.
 */
export function buildStorageUri(slug: string, base?: string): string {
  const b = base ?? resolveWebIdBaseUrl();
  return `${b}/spaces/${encodeURIComponent(slug)}/`;
}

export function buildOidcIssuer(base?: string): string {
  return base ?? resolveWebIdBaseUrl();
}

/**
 * Public typeIndex URL. Story 3.3b serves this resource — clients walk
 * to it from the profile doc to discover what kinds of things this Pod
 * publishes (one TypeRegistration per Space category).
 */
export function buildPublicTypeIndexUrl(base?: string): string {
  const b = base ?? resolveWebIdBaseUrl();
  return `${b}/typeIndex`;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Escape a string literal for Turtle. Handles the three characters that
 * can break a double-quoted literal: backslash, double quote, newline.
 */
function turtleEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Emit a valid Turtle profile document. Minimal by design — downstream
 * Solid apps care about three things: the subject (foaf:Person), the
 * OIDC issuer, and the storage pointer. Everything else is bonus.
 */
export function serializeTurtle(profile: WebIdProfile, opts: SerializeOptions = {}): string {
  const base = opts.baseUrlOverride ?? resolveWebIdBaseUrl();
  const docUrl = buildProfileDocUrl(profile.slug, base);
  const storage = buildStorageUri(profile.slug, base);
  const issuer = buildOidcIssuer(base);
  const typeIndex = buildPublicTypeIndexUrl(base);

  const lines: string[] = [];
  lines.push('@prefix foaf: <http://xmlns.com/foaf/0.1/> .');
  lines.push('@prefix solid: <http://www.w3.org/ns/solid/terms#> .');
  lines.push('@prefix pim: <http://www.w3.org/ns/pim/space#> .');
  lines.push(`@prefix : <${docUrl}#> .`);
  lines.push('');
  lines.push('<>');
  lines.push('    a foaf:PersonalProfileDocument ;');
  lines.push('    foaf:primaryTopic :me .');
  lines.push('');
  lines.push(':me');
  lines.push('    a foaf:Person ;');
  lines.push(`    foaf:name "${turtleEscape(profile.displayName)}" ;`);
  lines.push(`    solid:oidcIssuer <${issuer}> ;`);
  // Emit both pim:storage (wider Solid convention) and solid:storage
  // (named in the Story 1.6 acceptance criteria) so both classes of
  // client can discover it.
  lines.push(`    pim:storage <${storage}> ;`);
  lines.push(`    solid:storage <${storage}> ;`);
  lines.push(`    solid:publicTypeIndex <${typeIndex}> ;`);
  if (opts.includePrivate && profile.email) {
    lines.push(`    foaf:mbox <mailto:${profile.email}> ;`);
  }
  // Close the :me description.
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .');
  lines.push('');
  return lines.join('\n');
}

/**
 * Emit a JSON-LD equivalent. Solid clients that prefer application/ld+json
 * get the same underlying statements. We deliberately include both the
 * compact @context form and explicit property IRIs so downstream parsers
 * that don't load the context still get readable data.
 */
export function serializeJsonLd(profile: WebIdProfile, opts: SerializeOptions = {}): object {
  const base = opts.baseUrlOverride ?? resolveWebIdBaseUrl();
  const docUrl = buildProfileDocUrl(profile.slug, base);
  const webid = buildWebId(profile.slug, base);
  const storage = buildStorageUri(profile.slug, base);
  const issuer = buildOidcIssuer(base);
  const typeIndex = buildPublicTypeIndexUrl(base);

  const me: Record<string, unknown> = {
    '@id': webid,
    '@type': 'http://xmlns.com/foaf/0.1/Person',
    'http://xmlns.com/foaf/0.1/name': profile.displayName,
    'http://www.w3.org/ns/solid/terms#oidcIssuer': { '@id': issuer },
    'http://www.w3.org/ns/pim/space#storage': { '@id': storage },
    'http://www.w3.org/ns/solid/terms#storage': { '@id': storage },
    'http://www.w3.org/ns/solid/terms#publicTypeIndex': { '@id': typeIndex },
  };
  if (opts.includePrivate && profile.email) {
    me['http://xmlns.com/foaf/0.1/mbox'] = { '@id': `mailto:${profile.email}` };
  }

  return {
    '@context': {
      foaf: 'http://xmlns.com/foaf/0.1/',
      solid: 'http://www.w3.org/ns/solid/terms#',
      pim: 'http://www.w3.org/ns/pim/space#',
    },
    '@graph': [
      {
        '@id': docUrl,
        '@type': 'http://xmlns.com/foaf/0.1/PersonalProfileDocument',
        'http://xmlns.com/foaf/0.1/primaryTopic': { '@id': webid },
      },
      me,
    ],
  };
}

/**
 * Content negotiation helper. Picks the best serialisation for the caller.
 * Defaults to Turtle — the canonical Solid format — if the Accept header
 * doesn't express a clear preference.
 */
export type WebIdContentType = 'text/turtle' | 'application/ld+json';

export function negotiateContentType(acceptHeader: string | undefined): WebIdContentType {
  if (!acceptHeader) return 'text/turtle';
  const lower = acceptHeader.toLowerCase();
  // JSON-LD wins only when the client asks for it explicitly. If they
  // ask for JSON generically we still serve Turtle, because bare
  // `Accept: application/json` usually means "I can parse JSON" not
  // "I know what JSON-LD is."
  if (lower.includes('application/ld+json')) return 'application/ld+json';
  if (lower.includes('text/turtle')) return 'text/turtle';
  if (lower.includes('text/n3')) return 'text/turtle';
  // Wildcard or unknown: Turtle.
  return 'text/turtle';
}
