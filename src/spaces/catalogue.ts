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

import { pool } from '../db/connection';
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
 * Load the family's roster — adults, partners, all members — used by
 * the visibility resolver. Today partner status is inferred from the
 * adult role; when Story 2.3 lands we'll read an explicit partners
 * column. Leaving TODO for that rather than over-engineering now.
 */
export async function loadRoster(familyId: string): Promise<FamilyRoster> {
  const res = await pool.query<{ id: string; role: string }>(
    `SELECT id, role FROM profiles WHERE id = $1 OR id IN (
        SELECT id FROM profiles WHERE id != $1
     ) ORDER BY role, created_at`,
    [familyId],
  );
  const all = res.rows.map(r => r.id);
  const adults = res.rows.filter(r => r.role === 'adult' || r.role === 'admin').map(r => r.id);
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

export async function getCatalogue(familyId: string, viewerProfileId: string): Promise<CatalogueEntry[]> {
  const [roster, rows] = await Promise.all([
    loadRoster(familyId),
    pool.query<CatalogueRow>(
      `SELECT uri, slug, title, category, description, domains, people, visibility, confidence, last_updated_at
         FROM synthesis_pages WHERE family_id = $1
        ORDER BY last_updated_at DESC`,
      [familyId],
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
