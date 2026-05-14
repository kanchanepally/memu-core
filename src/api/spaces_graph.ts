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
import { extractWikilinkTargets } from '../spaces/wikilinks';

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

export type GraphEdgeType = 'wikilink' | 'shared_person' | 'shared_tag' | 'shared_domain' | 'parent_child';

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

/**
 * Build the wikilink-resolution index once per derivation. Spec-aligned:
 * `[[slug]]` matches by slug, `[[Title]]` matches by title (case-folded).
 * Same rule as `resolveWikilinks` in src/spaces/catalogue.ts so the
 * canvas and the prompt-side resolution stay coherent.
 */
function buildWikilinkIndex(spaces: GraphSpace[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const s of spaces) {
    const slugKey = s.slug.toLowerCase().trim();
    if (!index.has(slugKey)) index.set(slugKey, s.id);
    const titleKey = s.title.toLowerCase().trim();
    if (titleKey && !index.has(titleKey)) index.set(titleKey, s.id);
  }
  return index;
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

  const wikilinkIndex = buildWikilinkIndex(spaces);
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

  for (const s of spaces) {
    const targets = extractWikilinkTargets(s.bodyMarkdown);
    for (const t of targets) {
      const targetId = wikilinkIndex.get(t);
      if (targetId && targetId !== s.id) upsert(s.id, targetId, 'wikilink');
    }
  }

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

export async function loadGraphForViewer(
  familyId: string,
  viewerProfileId: string,
  facet: GraphFacet,
  visibility: GraphVisibility,
  opts: LoadGraphOptions = {},
): Promise<GraphResult> {
  const [roster, rows] = await Promise.all([
    loadRoster(familyId),
    db.query<GraphRow>(
      `SELECT id, uri, slug, title, category, description, domains, people, tags,
              visibility, confidence, body_markdown, last_updated_at, parent_space_uri
         FROM synthesis_pages WHERE family_id = $1
        ORDER BY last_updated_at DESC`,
      [familyId],
    ),
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

  return deriveGraph(filtered, { facet });
}
