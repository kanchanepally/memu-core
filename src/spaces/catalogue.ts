/**
 * Story 2.1 — the visibility-filtered Spaces catalogue.
 *
 * The catalogue is the progressive-disclosure surface: at session start
 * the orchestrator loads just `{uri, name, category, description,
 * domains}` for every Space the current viewer is allowed to see, and
 * hands that to the LLM. Full bodies are only loaded when a query
 * addresses a specific Space. This keeps the prompt small while making
 * the whole of the family's compiled understanding reachable.
 *
 * Visibility is enforced HERE, not in the renderer — a query made by a
 * child never sees adults_only content, a query made by Rach never
 * sees Hareesh's private Spaces.
 */

import { db } from '../db/tenant';
import type { Space, SpaceCategory, SpaceDomain, FamilyRoster, Visibility } from './model';
import { canSee } from './model';

export interface CatalogueEntry {
  uri: string;
  name: string;
  category: SpaceCategory;
  description: string;
  domains: SpaceDomain[];
  slug: string;
  confidence: number;
  lastUpdated: Date;
}

interface CatalogueRow {
  uri: string;
  slug: string;
  title: string;
  category: SpaceCategory;
  description: string;
  domains: string[];
  people: string[];
  visibility: string;
  confidence: string;
  last_updated_at: Date;
}

/**
 * Load the active Collective's roster — adults, partners, all members —
 * used by the visibility resolver.
 *
 * Multi-Collective Membership spec, Story 2.1: roster comes from
 * collective_memberships (the relationship table) rather than
 * profiles.role. The RLS context scopes to the active Collective; we
 * filter to active status only (invited/left members are not part
 * of the visibility roster).
 *
 * The role-to-bucket mapping is:
 *   adults   = owner | admin | adult
 *              (owner and admin are adult-level by definition;
 *               the legacy code mapped only admin+adult, but
 *               post-spec the owner role is also adult-level)
 *   children = child
 *   member, viewer → in `all` only — generic members are not adults
 *              by definition; they participate in family visibility
 *              but not adults_only / partners_only spaces.
 *
 * Partner status is still inferred as "first two adults" — same
 * heuristic as before; an explicit partners flag is a separate slice.
 *
 * `familyId` is kept on the signature for source-compatibility with
 * pre-Story-2.1 callers; the value is no longer used because RLS
 * does the scoping. To be revisited when multi-Collective switching
 * (Story 3.2) makes "scope to a specific Collective explicitly"
 * useful again.
 */
export async function loadRoster(_familyId: string): Promise<FamilyRoster> {
  const res = await db.query<{ profile_id: string; role: string }>(
    `SELECT profile_id, role FROM collective_memberships WHERE status = 'active' ORDER BY created_at`,
  );
  const all = res.rows.map(r => r.profile_id);
  const adults = res.rows
    .filter(r => r.role === 'owner' || r.role === 'admin' || r.role === 'adult')
    .map(r => r.profile_id);
  const partners = adults.slice(0, 2);
  return { all, adults, partners };
}

function parseVisibility(stored: string): Visibility {
  if (stored.startsWith('[')) {
    try {
      return JSON.parse(stored) as string[];
    } catch {
      return 'family';
    }
  }
  return stored as Visibility;
}

export async function getCatalogue(
  familyId: string,
  viewerProfileId: string,
  projectId?: string | null,
): Promise<CatalogueEntry[]> {
  // Phase 4 of Build Spec 1 — optional project filter. NULL/undefined =
  // full collective catalogue (project-tagged AND collective-level
  // Spaces both visible). A string narrows to just that project's
  // Spaces. RLS already restricts to the active collective, so a
  // cross-collective project_id would return zero rows (which is the
  // correct behaviour for a malformed request).
  const projectFilter = (typeof projectId === 'string' && projectId.length > 0)
    ? projectId
    : null;

  const [roster, rows] = await Promise.all([
    loadRoster(familyId),
    db.query<CatalogueRow>(
      `SELECT uri, slug, title, category, description, domains, people, visibility, confidence, last_updated_at
         FROM synthesis_pages
        WHERE family_id = $1
          AND ($2::text IS NULL OR project_id = $2)
        ORDER BY last_updated_at DESC`,
      [familyId, projectFilter],
    ),
  ]);

  const visible: CatalogueEntry[] = [];
  for (const row of rows.rows) {
    const visibility = parseVisibility(row.visibility);
    if (!canSee(viewerProfileId, { visibility, people: row.people }, roster)) continue;
    visible.push({
      uri: row.uri,
      slug: row.slug,
      name: row.title,
      category: row.category,
      description: row.description,
      domains: row.domains as SpaceDomain[],
      confidence: Number(row.confidence),
      lastUpdated: row.last_updated_at,
    });
  }
  return visible;
}

/**
 * A compact prompt-ready rendering of the catalogue — one line per
 * Space, suitable to drop into a skill template as context. Keeps
 * tokens lean; the LLM gets more detail only when it asks.
 */
export function renderCatalogueForPrompt(entries: CatalogueEntry[]): string {
  if (entries.length === 0) return '(no compiled Spaces yet)';
  return entries
    .map(e => `- [${e.category}] ${e.name} (${e.slug}) — ${e.description || '(no description)'}`)
    .join('\n');
}

export function matchBySlug(entries: CatalogueEntry[], text: string): CatalogueEntry[] {
  const lower = text.toLowerCase();
  const matches: CatalogueEntry[] = [];
  for (const entry of entries) {
    if (lower.includes(entry.slug.replace(/-/g, ' ')) || lower.includes(entry.name.toLowerCase())) {
      matches.push(entry);
    }
  }
  return matches;
}

/**
 * Filter by category + visibility for the caller's current viewer.
 * Helper for any code path that wants "all people Spaces Rach can see."
 */
export function filterByCategory(entries: CatalogueEntry[], category: SpaceCategory): CatalogueEntry[] {
  return entries.filter(e => e.category === category);
}

/**
 * Wikilink helper: given `[[swimming]]` anywhere in a prompt, return
 * the catalogue entries whose slug matches the link target.
 */
export function resolveWikilinks(entries: CatalogueEntry[], text: string): CatalogueEntry[] {
  const matches = text.matchAll(/\[\[([^\]]+)\]\]/g);
  const slugs = new Set<string>();
  for (const m of matches) slugs.add(m[1].toLowerCase().trim());
  if (slugs.size === 0) return [];
  return entries.filter(e => slugs.has(e.slug) || slugs.has(e.name.toLowerCase()));
}

export type { Space };
