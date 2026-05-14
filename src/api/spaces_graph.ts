/**
 * Spaces Canvas — graph derivation.
 *
 * The canvas is a different way of looking at the same compiled
 * understanding the Spaces tab already shows: instead of a list of
 * cards, a network where each Space is a node and the edges are the
 * relationships the family has accumulated through wikilinks and
 * shared people / tags / domains.
 *
 * Two parts:
 *   1. `deriveGraph` — pure function from a list of Spaces (already
 *      visibility-filtered for the viewer) to {nodes, edges}. Easy
 *      to test, no DB.
 *   2. `loadGraphForViewer` — DB-touching loader that mirrors the
 *      visibility model used by `getCatalogue` in src/spaces/catalogue.ts:
 *      load the family's Spaces, apply `canSee` per viewer, then
 *      derive.
 *
 * Edges are undirected and de-duplicated. Edge types and default
 * weights match the spec: wikilink 1.0, shared_person 0.5,
 * shared_tag 0.4, shared_domain 0.3 (off by default — only emitted
 * when the caller explicitly opts in via `includeDomain` or picks
 * `facet === 'domain'`).
 *
 * No real names enter or leave this module — it works on Space
 * shapes that already passed through the orchestrator's Twin layer
 * when the Spaces themselves were written. The graph is structural
 * only.
 */

import { db } from '../db/tenant';
import { canSee, resolveVisibility, type FamilyRoster, type SpaceCategory, type SpaceDomain, type Visibility } from '../spaces/model';
import { loadRoster } from '../spaces/catalogue';

export type GraphFacet = 'category' | 'domain' | 'person' | 'tag' | 'none';
export type GraphVisibility = 'mine' | 'shared' | 'all';

export interface GraphSpace {
  id: string;
  uri: string;
  slug: string;
  category: SpaceCategory;
  title: string;
  description: string;
  domains: SpaceDomain[];
  people: string[];
  tags: string[];
  visibility: Visibility;
  confidence: number;
  bodyMarkdown: string;
  lastUpdated: Date;
  parentSpaceUri?: string | null;
}

export interface GraphNode {
  id: string;
  uri: string;
  slug: string;
  category: SpaceCategory;
  title: string;
  description: string;
  domains: SpaceDomain[];
  people: string[];
  tags: string[];
  visibility: Visibility;
  confidence: number;
  wordcount: number;
  excerpt: string;
  lastUpdated: string;
  parentSpaceUri: string | null;
  childCount: number;
  /** Server-computed pixel size for direct binding in Cytoscape stylesheet. */
  nodeWidth: number;
  nodeHeight: number;
}

export type GraphEdgeType = 'wikilink' | 'manual' | 'proposed' | 'shared_person' | 'shared_tag' | 'shared_domain' | 'parent_child';

export interface GraphEdge {
  source: string;
  target: string;
  type: GraphEdgeType;
  weight: number;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const EDGE_WEIGHTS: Record<GraphEdgeType, number> = {
  parent_child: 2.0,
  wikilink: 1.0,
  manual: 1.0,        // user-affirmed connection — same weight as wikilink
  proposed: 0.7,      // semantic similarity (deferred sub-phase 6.5)
  shared_person: 0.5,
  shared_tag: 0.4,
  shared_domain: 0.3,
};

/**
 * Spec-compliant node sizing — log(charcount) * recencyFactor.
 *
 * "Thick" Spaces (richly-written, recently-touched) render larger so
 * the canvas tells you at a glance which Spaces have substance.
 * Computed server-side and shipped per node so the canvas binds
 * directly in the stylesheet without re-doing maths client-side.
 */
export function nodeSize(bodyMarkdown: string, lastUpdated: Date | string): { width: number; height: number } {
  const charCount = bodyMarkdown.length;
  const wordcountProxy = Math.log10(charCount + 10); // 0 .. ~3.5
  const richness = Math.min(1, wordcountProxy / 3.5); // 0..1

  const lastDate = lastUpdated instanceof Date ? lastUpdated : new Date(lastUpdated);
  const daysSinceUpdate = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
  const recencyFactor =
    daysSinceUpdate < 7 ? 1.0 :
    daysSinceUpdate < 30 ? 0.85 :
    daysSinceUpdate < 90 ? 0.7 : 0.55;

  const baseWidth = 100;
  const widthGrowth = 100;
  const baseHeight = 50;
  const heightGrowth = 40;

  const factor = (0.5 + 0.5 * richness) * recencyFactor;
  return {
    width: Math.round(baseWidth + widthGrowth * factor),
    height: Math.round(baseHeight + heightGrowth * factor),
  };
}

/**
 * 200 chars of plaintext for hover preview / search. Strips markdown
 * scaffolding (heading hashes, emphasis markers, list bullets, code
 * fences, tables) to keep the preview readable.
 */
export function buildExcerpt(body: string, max = 200): string {
  if (!body) return '';
  const stripped = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[#*_>`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max - 1).trimEnd() + '…';
}

export function countWords(body: string): number {
  if (!body) return 0;
  const matches = body.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function intersect<T>(a: T[], b: T[]): T[] {
  if (!a.length || !b.length) return [];
  const setB = new Set(b);
  const out: T[] = [];
  for (const x of a) if (setB.has(x)) out.push(x);
  return out;
}

export interface DeriveGraphOptions {
  facet?: GraphFacet;
  /** Off by default. Set true (or pass `facet === 'domain'`) to emit shared_domain edges. */
  includeDomain?: boolean;
}

export function deriveGraph(spaces: GraphSpace[], opts: DeriveGraphOptions = {}): GraphResult {
  const includeDomain = opts.includeDomain === true || opts.facet === 'domain';

  // Pre-compute child counts so each node's `childCount` is one-pass.
  const childCountByUri = new Map<string, number>();
  for (const s of spaces) {
    if (s.parentSpaceUri) {
      childCountByUri.set(s.parentSpaceUri, (childCountByUri.get(s.parentSpaceUri) ?? 0) + 1);
    }
  }
  const uriToId = new Map<string, string>();
  for (const s of spaces) uriToId.set(s.uri, s.id);

  const nodes: GraphNode[] = spaces.map(s => {
    const sz = nodeSize(s.bodyMarkdown, s.lastUpdated);
    return {
      id: s.id,
      uri: s.uri,
      slug: s.slug,
      category: s.category,
      title: s.title,
      description: s.description,
      domains: [...s.domains],
      people: [...s.people],
      tags: [...s.tags],
      visibility: Array.isArray(s.visibility) ? [...s.visibility] : s.visibility,
      confidence: s.confidence,
      wordcount: countWords(s.bodyMarkdown),
      excerpt: buildExcerpt(s.bodyMarkdown),
      lastUpdated: s.lastUpdated instanceof Date ? s.lastUpdated.toISOString() : new Date(s.lastUpdated).toISOString(),
      parentSpaceUri: s.parentSpaceUri ?? null,
      childCount: childCountByUri.get(s.uri) ?? 0,
      nodeWidth: sz.width,
      nodeHeight: sz.height,
    };
  });

  const edgesByKey = new Map<string, GraphEdge>();

  const upsert = (a: string, b: string, type: GraphEdgeType, weight = EDGE_WEIGHTS[type]) => {
    if (a === b) return;
    const key = `${type}::${pairKey(a, b)}`;
    const existing = edgesByKey.get(key);
    if (existing) {
      if (weight > existing.weight) existing.weight = weight;
      return;
    }
    const [source, target] = a < b ? [a, b] : [b, a];
    edgesByKey.set(key, { source, target, type, weight });
  };

  // Parent-child edges — strongest visual treatment per spec §4.5.
  // Stored undirected for layout symmetry but the relationship itself
  // is directed (child → parent). Direction is recoverable from each
  // node's parentSpaceUri, so the canvas can style appropriately.
  for (const s of spaces) {
    if (!s.parentSpaceUri) continue;
    const parentId = uriToId.get(s.parentSpaceUri);
    if (parentId) upsert(s.id, parentId, 'parent_child');
  }

  // Phase 6: wikilink edges are no longer derived here — they're
  // persisted in space_connections at upsertSpace time and merged
  // into the result by loadGraphForViewer. Manual + proposed edges
  // come from the same source. Shared-{person,tag,domain} edges
  // remain in-memory derived because the arrays ARE their source of
  // truth (per spec §9.3).

  for (let i = 0; i < spaces.length; i++) {
    const a = spaces[i];
    for (let j = i + 1; j < spaces.length; j++) {
      const b = spaces[j];
      if (intersect(a.people, b.people).length > 0) upsert(a.id, b.id, 'shared_person');
      if (intersect(a.tags, b.tags).length > 0) upsert(a.id, b.id, 'shared_tag');
      if (includeDomain && intersect(a.domains, b.domains).length > 0) {
        upsert(a.id, b.id, 'shared_domain');
      }
    }
  }

  return { nodes, edges: [...edgesByKey.values()] };
}

/**
 * Visibility filter applied after the per-Space `canSee` check.
 *
 *   - `all`    — every Space the viewer can see (default).
 *   - `mine`   — only Spaces where the viewer is in `people[]` OR the
 *                visibility resolves to a single-viewer set ('private',
 *                'individual', or an explicit list of length 1).
 *   - `shared` — only Spaces visible to multiple people (family,
 *                adults_only, partners_only, individual with multiple
 *                people, or an explicit list of length ≥ 2).
 */
export function applyVisibilityFilter(
  spaces: GraphSpace[],
  viewerProfileId: string,
  scope: GraphVisibility,
  roster: FamilyRoster,
): GraphSpace[] {
  if (scope === 'all') return spaces;
  return spaces.filter(s => {
    const allowed = resolveVisibility(s.visibility, s.people, roster);
    if (scope === 'mine') {
      const isPersonal = s.people.includes(viewerProfileId) || allowed.length === 1;
      return isPersonal && allowed.includes(viewerProfileId);
    }
    return allowed.length >= 2;
  });
}

interface GraphRow {
  id: string;
  uri: string;
  slug: string;
  title: string;
  category: SpaceCategory;
  description: string | null;
  domains: string[] | null;
  people: string[] | null;
  tags: string[] | null;
  visibility: string;
  confidence: string;
  body_markdown: string | null;
  last_updated_at: Date;
  parent_space_uri: string | null;
}

function parseStoredVisibility(raw: string): Visibility {
  if (raw && raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // fall through
    }
  }
  return raw as Visibility;
}

export interface LoadGraphOptions {
  /**
   * Optional Space URI. When set, the graph returns only that Space
   * and its direct children — focus/zoom mode (§4.6). When omitted,
   * the full visible graph is returned.
   */
  focusUri?: string;
}

interface PersistedConnectionRow {
  space_uri_a: string;
  space_uri_b: string;
  source_mechanism: 'wikilink' | 'manual' | 'proposed';
  confidence: string;
}

/**
 * Phase 6 — load persisted edges from space_connections for the active
 * collective. RLS scopes the SELECT. Status filter excludes user-
 * dismissed edges. The caller filters by visible Space URIs before
 * adding to the GraphResult.
 */
async function loadPersistedConnections(): Promise<PersistedConnectionRow[]> {
  const res = await db.query<PersistedConnectionRow>(
    `SELECT space_uri_a, space_uri_b, source_mechanism, confidence::text AS confidence
       FROM space_connections
      WHERE status = 'active'`,
  );
  return res.rows;
}

export async function loadGraphForViewer(
  familyId: string,
  viewerProfileId: string,
  facet: GraphFacet,
  visibility: GraphVisibility,
  opts: LoadGraphOptions = {},
): Promise<GraphResult> {
  const [roster, rows, persistedEdges] = await Promise.all([
    loadRoster(familyId),
    db.query<GraphRow>(
      `SELECT id, uri, slug, title, category, description, domains, people, tags,
              visibility, confidence, body_markdown, last_updated_at, parent_space_uri
         FROM synthesis_pages WHERE family_id = $1
        ORDER BY last_updated_at DESC`,
      [familyId],
    ),
    loadPersistedConnections(),
  ]);

  const spaces: GraphSpace[] = rows.rows
    .map(r => ({
      id: r.id,
      uri: r.uri,
      slug: r.slug,
      title: r.title || 'Untitled',
      category: r.category,
      description: r.description || '',
      domains: (r.domains || []) as SpaceDomain[],
      people: r.people || [],
      tags: r.tags || [],
      visibility: parseStoredVisibility(r.visibility),
      confidence: Number(r.confidence),
      bodyMarkdown: r.body_markdown || '',
      lastUpdated: r.last_updated_at,
      parentSpaceUri: r.parent_space_uri,
    }))
    .filter(s => canSee(viewerProfileId, { visibility: s.visibility, people: s.people }, roster));

  let filtered = applyVisibilityFilter(spaces, viewerProfileId, visibility, roster);

  // Focus mode (§4.6) — narrow to a container's children + the parent
  // itself. Applied after visibility filtering so a viewer cannot focus
  // a Space they cannot see.
  if (opts.focusUri) {
    const focusUri = opts.focusUri;
    const focusedRoot = filtered.find(s => s.uri === focusUri);
    if (focusedRoot) {
      filtered = filtered.filter(s => s.uri === focusUri || s.parentSpaceUri === focusUri);
    } else {
      // Focus target not visible to this viewer (or doesn't exist) —
      // return an empty graph rather than the full one to avoid the
      // canvas silently falling back to "show everything".
      filtered = [];
    }
  }

  const result = deriveGraph(filtered, { facet });

  // Phase 6: merge persisted edges (wikilink + manual + proposed) into
  // the derived ones. Filter by URI → id maps built from the visible
  // Spaces — any persisted edge whose endpoint is hidden from this
  // viewer drops silently.
  const uriToId = new Map<string, string>();
  for (const node of result.nodes) uriToId.set(node.uri, node.id);

  for (const edge of persistedEdges) {
    const idA = uriToId.get(edge.space_uri_a);
    const idB = uriToId.get(edge.space_uri_b);
    if (!idA || !idB || idA === idB) continue;
    // Canonical order: smaller id first (matches deriveGraph's pair
    // logic — keeps the wire format consistent).
    const [source, target] = idA < idB ? [idA, idB] : [idB, idA];
    const weight = Math.max(
      Number(edge.confidence) * EDGE_WEIGHTS[edge.source_mechanism],
      0,
    );
    result.edges.push({
      source,
      target,
      type: edge.source_mechanism,
      weight,
    });
  }

  return result;
}
