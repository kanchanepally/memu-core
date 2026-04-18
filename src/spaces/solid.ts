/**
 * Story 3.3a — Solid HTTP representation of a Space.
 *
 * A Space already has a stable URI in the `memu://` scheme. The Solid
 * surface adds a parallel HTTPS URL — `<base>/spaces/<category>/<slug>` —
 * that any Solid client can resolve. This file owns the translation from
 * the in-memory Space record to:
 *
 *   - text/markdown (the body, exactly as stored — what humans + Obsidian see)
 *   - text/turtle   (RDF using foaf, schema.org, and a memu: vocab)
 *   - application/ld+json (the same statements, in JSON-LD)
 *
 * And the ACP (Access Control Policy) resource that gates it. The ACP
 * lists the WebIDs allowed to read, derived from the Space's `visibility`
 * field via the same resolveVisibility() the orchestrator uses internally.
 * That mirroring is intentional — there must be exactly one source of
 * truth for who can see what.
 *
 * Default-deny: a Space with empty allowed-set serves an ACP with no
 * agents and no public access. The route layer must check the ACP
 * (or equivalently, canSee()) before serving the body.
 */

import { resolveVisibility, type Space, type FamilyRoster, type SpaceCategory } from './model';
import { resolveWebIdBaseUrl, buildWebId } from '../webid/webid';

export const MEMU_VOCAB = 'https://memu.digital/vocab#';

export type SpaceContentType = 'text/markdown' | 'text/turtle' | 'application/ld+json';

/**
 * Solid clients send `Accept` headers like `text/turtle, application/ld+json;q=0.5`.
 * We honour an explicit text/turtle or application/ld+json over the markdown
 * default — markdown is the friendly format for browsers and humans, RDF is
 * what real Solid clients want.
 */
export function negotiateSpaceContentType(acceptHeader: string | undefined): SpaceContentType {
  if (!acceptHeader) return 'text/markdown';
  const lower = acceptHeader.toLowerCase();
  if (lower.includes('application/ld+json')) return 'application/ld+json';
  if (lower.includes('text/turtle')) return 'text/turtle';
  if (lower.includes('text/n3')) return 'text/turtle';
  if (lower.includes('text/markdown')) return 'text/markdown';
  if (lower.includes('text/plain')) return 'text/markdown';
  // Wildcard or unknown — markdown. Browsers asking for text/html land here
  // and get something readable, which is the right default for "I clicked
  // a Space URL in my browser."
  return 'text/markdown';
}

/**
 * Build the public HTTPS URL for a Space.
 * <base>/spaces/<category>/<slug>
 *
 * This does not collide with the per-person Pod root pointer
 * (<base>/spaces/<webid_slug>/) because category is a fixed enum
 * (person | routine | household | commitment | document) which is
 * unlikely to clash with a person slug. The route layer disambiguates
 * by trying the category match first.
 */
export function buildSpaceHttpUrl(category: SpaceCategory, slug: string, base?: string): string {
  const b = base ?? resolveWebIdBaseUrl();
  return `${b}/spaces/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`;
}

export function buildSpaceAcpUrl(category: SpaceCategory, slug: string, base?: string): string {
  return `${buildSpaceHttpUrl(category, slug, base)}?ext=acp`;
}

function turtleEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Map a SpaceCategory to an RDF type. We use schema.org where the mapping
 * is natural and a memu: term where the concept doesn't have a clean
 * upstream equivalent. Adding to this map should be a deliberate choice.
 */
function rdfTypeForCategory(category: SpaceCategory): string {
  switch (category) {
    case 'person':     return 'http://schema.org/Person';
    case 'routine':    return `${MEMU_VOCAB}Routine`;
    case 'household':  return 'http://schema.org/Place';
    case 'commitment': return `${MEMU_VOCAB}Commitment`;
    case 'document':   return `${MEMU_VOCAB}Document`;
  }
}

/**
 * Turtle representation of a Space. Captures the structural fields
 * (name, description, category, domains) plus a memu:bodyMarkdown
 * literal carrying the human-readable body.
 */
export function serializeSpaceTurtle(space: Space, base?: string): string {
  const url = buildSpaceHttpUrl(space.category, space.slug, base);
  const acpUrl = buildSpaceAcpUrl(space.category, space.slug, base);
  const rdfType = rdfTypeForCategory(space.category);

  const lines: string[] = [];
  lines.push('@prefix foaf: <http://xmlns.com/foaf/0.1/> .');
  lines.push('@prefix schema: <http://schema.org/> .');
  lines.push('@prefix memu: <https://memu.digital/vocab#> .');
  lines.push('@prefix dcterms: <http://purl.org/dc/terms/> .');
  lines.push('');
  lines.push(`<${url}>`);
  lines.push(`    a <${rdfType}> ;`);
  lines.push(`    schema:name "${turtleEscape(space.name)}" ;`);
  if (space.description) {
    lines.push(`    schema:description "${turtleEscape(space.description)}" ;`);
  }
  lines.push(`    memu:uri "${turtleEscape(space.uri)}" ;`);
  lines.push(`    memu:category "${turtleEscape(space.category)}" ;`);
  lines.push(`    memu:slug "${turtleEscape(space.slug)}" ;`);
  for (const domain of space.domains) {
    lines.push(`    memu:domain "${turtleEscape(domain)}" ;`);
  }
  for (const tag of space.tags) {
    lines.push(`    memu:tag "${turtleEscape(tag)}" ;`);
  }
  lines.push(`    memu:confidence "${space.confidence}"^^<http://www.w3.org/2001/XMLSchema#decimal> ;`);
  lines.push(`    dcterms:modified "${space.lastUpdated.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;`);
  lines.push(`    memu:acpResource <${acpUrl}> ;`);
  lines.push(`    memu:bodyMarkdown "${turtleEscape(space.bodyMarkdown)}" .`);
  lines.push('');
  return lines.join('\n');
}

/**
 * JSON-LD representation. Same statements as the Turtle, expressed as
 * a single graph object with explicit IRIs so consumers that don't
 * resolve the @context still get readable data.
 */
export function serializeSpaceJsonLd(space: Space, base?: string): object {
  const url = buildSpaceHttpUrl(space.category, space.slug, base);
  const acpUrl = buildSpaceAcpUrl(space.category, space.slug, base);

  const node: Record<string, unknown> = {
    '@id': url,
    '@type': rdfTypeForCategory(space.category),
    'http://schema.org/name': space.name,
    [`${MEMU_VOCAB}uri`]: space.uri,
    [`${MEMU_VOCAB}category`]: space.category,
    [`${MEMU_VOCAB}slug`]: space.slug,
    [`${MEMU_VOCAB}confidence`]: { '@value': String(space.confidence), '@type': 'http://www.w3.org/2001/XMLSchema#decimal' },
    'http://purl.org/dc/terms/modified': { '@value': space.lastUpdated.toISOString(), '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
    [`${MEMU_VOCAB}acpResource`]: { '@id': acpUrl },
    [`${MEMU_VOCAB}bodyMarkdown`]: space.bodyMarkdown,
  };
  if (space.description) {
    node['http://schema.org/description'] = space.description;
  }
  if (space.domains.length > 0) {
    node[`${MEMU_VOCAB}domain`] = space.domains;
  }
  if (space.tags.length > 0) {
    node[`${MEMU_VOCAB}tag`] = space.tags;
  }
  return {
    '@context': {
      foaf: 'http://xmlns.com/foaf/0.1/',
      schema: 'http://schema.org/',
      memu: MEMU_VOCAB,
      dcterms: 'http://purl.org/dc/terms/',
    },
    '@graph': [node],
  };
}

// ---------------------------------------------------------------------------
// ACP — Access Control Policy
// ---------------------------------------------------------------------------

export interface AcpProfileLookup {
  /** Resolve a Memu profile id → that profile's WebID URL. */
  webIdForProfileId(profileId: string): string | null;
}

/**
 * Build a profile-id → WebID lookup from a list of profile rows. The
 * route layer typically already has these on hand (it loads the roster
 * for visibility resolution), so it can pass them through here without
 * a second DB round-trip.
 */
export function buildAcpLookup(rows: Array<{ id: string; webid_slug: string | null }>): AcpProfileLookup {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.webid_slug) continue;
    map.set(r.id, buildWebId(r.webid_slug));
  }
  return {
    webIdForProfileId: (id: string) => map.get(id) ?? null,
  };
}

/**
 * Derive the list of allowed reader WebIDs for a Space. Resolves the
 * visibility enum (or explicit URI list) into concrete profile ids,
 * then maps each id to its WebID via the lookup. Profile ids without
 * a webid_slug are dropped (they don't yet have a Solid identity to
 * gate against). The intent here is "fail closed" — better to refuse
 * a legitimate caller than to over-share.
 *
 * If `visibility` is already an explicit WebID list (URI form), pass
 * those through verbatim. That path supports cross-household sharing
 * (Story 3.4).
 */
export function deriveAllowedReaders(
  space: Pick<Space, 'visibility' | 'people'>,
  roster: FamilyRoster,
  lookup: AcpProfileLookup,
): string[] {
  const resolved = resolveVisibility(space.visibility, space.people, roster);
  const out: string[] = [];
  for (const subject of resolved) {
    if (/^https?:\/\//i.test(subject)) {
      out.push(subject);
      continue;
    }
    const webid = lookup.webIdForProfileId(subject);
    if (webid) out.push(webid);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LDP Containers — Pod root (`/spaces/<webid_slug>/`) and per-category
// (`/spaces/<category>/`). Solid clients walk into containers to discover
// resources; without these, our published Spaces are only reachable if a
// caller already knows the slug.
// ---------------------------------------------------------------------------

export interface ContainerEntry {
  /** Absolute URL of the contained resource. */
  url: string;
  /** Human-friendly title (rendered as schema:name). Optional but useful. */
  title?: string;
}

export function serializeContainer(
  containerUrl: string,
  entries: ContainerEntry[],
  opts: { acpUrl?: string } = {},
): string {
  const lines: string[] = [];
  lines.push('@prefix ldp:    <http://www.w3.org/ns/ldp#> .');
  lines.push('@prefix schema: <http://schema.org/> .');
  lines.push('');
  lines.push(`<${containerUrl}>`);
  lines.push('    a ldp:Container, ldp:BasicContainer ;');
  if (opts.acpUrl) {
    lines.push(`    <https://memu.digital/vocab#acpResource> <${opts.acpUrl}> ;`);
  }
  if (entries.length === 0) {
    // Container with no contents — terminate cleanly. A Pod browser
    // landing here will see "empty container" rather than an error.
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('    ldp:contains');
  const contains = entries.map((e, i) => {
    const sep = i === entries.length - 1 ? ' ;' : ',';
    return `        <${e.url}>${sep}`;
  });
  lines.push(...contains);
  // After ldp:contains we still need the closing dot. The last named
  // entry currently ends in ';' to allow more triples — flip it.
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .');

  // Title hints for entries — emitted as separate subject blocks so the
  // container itself stays a clean LDP shape.
  for (const e of entries) {
    if (!e.title) continue;
    lines.push('');
    lines.push(`<${e.url}>`);
    lines.push(`    schema:name "${turtleEscape(e.title)}" .`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// typeIndex — a published map of "what kinds of things live in this Pod
// and where to find them." Solid apps read this to discover that, for
// example, all schema:Person resources live under /spaces/person/.
// ---------------------------------------------------------------------------

export interface TypeIndexEntry {
  /** Local fragment id (without the `#`). */
  id: string;
  /** RDF class IRI this registration is for. */
  forClass: string;
  /** Container URL where instances of `forClass` are listed. */
  instanceContainer: string;
}

export function serializeTypeIndex(typeIndexUrl: string, entries: TypeIndexEntry[]): string {
  const lines: string[] = [];
  lines.push('@prefix solid: <http://www.w3.org/ns/solid/terms#> .');
  lines.push('@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .');
  lines.push('');
  lines.push(`<${typeIndexUrl}>`);
  lines.push('    a solid:TypeIndex, solid:ListedDocument .');
  lines.push('');
  for (const e of entries) {
    lines.push(`<${typeIndexUrl}#${e.id}>`);
    lines.push('    a solid:TypeRegistration ;');
    lines.push(`    solid:forClass <${e.forClass}> ;`);
    lines.push(`    solid:instanceContainer <${e.instanceContainer}> .`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The standard typeIndex entries for a Memu deployment — one
 * registration per category, each pointing at its container. Stable
 * across deployments at the same base URL.
 */
export function defaultTypeIndexEntries(base: string): TypeIndexEntry[] {
  const cats: Array<{ id: string; cat: SpaceCategory }> = [
    { id: 'person',     cat: 'person' },
    { id: 'routine',    cat: 'routine' },
    { id: 'household',  cat: 'household' },
    { id: 'commitment', cat: 'commitment' },
    { id: 'document',   cat: 'document' },
  ];
  return cats.map(({ id, cat }) => ({
    id,
    forClass: rdfTypeForCategory(cat),
    instanceContainer: `${base}/spaces/${cat}/`,
  }));
}

/**
 * Serialize an ACP resource for a Space. We intentionally use the
 * standard `acp:` and `acl:` vocabularies so a Solid client can validate
 * authorisation independently — Memu enforces internally too, but the
 * ACP resource is the published contract.
 *
 * Default-deny: empty allowed list → no acp:Matcher agents → no read
 * access. We do NOT emit acl:agentClass foaf:Agent (i.e., public).
 */
export function serializeAcp(
  category: SpaceCategory,
  slug: string,
  allowedReaderWebIds: string[],
  base?: string,
): string {
  const url = buildSpaceHttpUrl(category, slug, base);
  const lines: string[] = [];
  lines.push('@prefix acp:  <http://www.w3.org/ns/solid/acp#> .');
  lines.push('@prefix acl:  <http://www.w3.org/ns/auth/acl#> .');
  lines.push('@prefix memu: <https://memu.digital/vocab#> .');
  lines.push('');
  lines.push(`<${url}#acp>`);
  lines.push('    a acp:AccessControlResource ;');
  lines.push(`    acp:resource <${url}> ;`);
  if (allowedReaderWebIds.length === 0) {
    lines.push('    memu:note "No agents are authorised to read this resource." .');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('    acp:accessControl <#readPolicy> .');
  lines.push('');
  lines.push('<#readPolicy>');
  lines.push('    a acp:AccessControl ;');
  lines.push('    acp:apply <#readMatcher> ;');
  lines.push('    acp:allow acl:Read .');
  lines.push('');
  lines.push('<#readMatcher>');
  lines.push('    a acp:Matcher ;');
  for (const webid of allowedReaderWebIds) {
    lines.push(`    acp:agent <${webid}> ;`);
  }
  // Replace the trailing ; on the last agent line with a .
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .');
  lines.push('');
  return lines.join('\n');
}
