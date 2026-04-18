/**
 * Story 2.1 — Space data model.
 *
 * A Space is a compiled page of understanding. Every Space has a stable
 * URI that never changes even if the Space is renamed, split, or moved.
 * The slug is for filesystem ergonomics only; cross-references between
 * Spaces go through the URI.
 *
 * Identifiers: memu://<family_id>/<category>/<uuid>
 * This format is WebID-compatible (Story 1.6) — when a family opts into
 * externally-resolvable identifiers (Tier 1 or Solid Pod portability),
 * memu:// resolves to an HTTPS URL on the family's issuer base.
 */

export const SPACE_CATEGORIES = ['person', 'routine', 'household', 'commitment', 'document'] as const;
export type SpaceCategory = typeof SPACE_CATEGORIES[number];

export const SPACE_DOMAINS = [
  'nourishment', 'shelter', 'health', 'education', 'finance', 'safety',
  'transport', 'caregiving', 'relationships', 'rituals',
  'personal_space', 'friendships', 'transitions',
] as const;
export type SpaceDomain = typeof SPACE_DOMAINS[number];

export const VISIBILITY_ENUM = ['family', 'individual', 'adults_only', 'partners_only', 'private'] as const;
export type VisibilityEnum = typeof VISIBILITY_ENUM[number];

export type Visibility = VisibilityEnum | string[];

export interface Space {
  uri: string;
  id: string;
  familyId: string;
  category: SpaceCategory;
  slug: string;
  name: string;
  description: string;
  domains: SpaceDomain[];
  people: string[];
  visibility: Visibility;
  confidence: number;
  sourceReferences: string[];
  tags: string[];
  bodyMarkdown: string;
  lastUpdated: Date;
}

export function buildSpaceUri(familyId: string, category: SpaceCategory, uuid: string): string {
  return `memu://${familyId}/${category}/${uuid}`;
}

export function parseSpaceUri(uri: string): { familyId: string; category: SpaceCategory; uuid: string } | null {
  const match = /^memu:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!match) return null;
  const [, familyId, rawCategory, uuid] = match;
  if (!SPACE_CATEGORIES.includes(rawCategory as SpaceCategory)) return null;
  return { familyId, category: rawCategory as SpaceCategory, uuid };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

/**
 * Resolve the `visibility` field (enum sugar OR explicit URI list) to
 * the concrete set of profile ids / external WebIDs that should see
 * this Space. Enum lookup requires the caller to pass the family's
 * roster so we can expand `family`, `adults_only`, etc.
 */
export interface FamilyRoster {
  all: string[];
  adults: string[];
  partners: string[];
}

export function resolveVisibility(visibility: Visibility, people: string[], roster: FamilyRoster): string[] {
  if (Array.isArray(visibility)) return [...visibility];
  switch (visibility) {
    case 'family':
      return [...roster.all];
    case 'adults_only':
      return [...roster.adults];
    case 'partners_only':
      return [...roster.partners];
    case 'individual':
      return [...people];
    case 'private':
      return people.length > 0 ? [people[0]] : [];
    default:
      return [];
  }
}

export function canSee(viewer: string, space: Pick<Space, 'visibility' | 'people'>, roster: FamilyRoster): boolean {
  const allowed = resolveVisibility(space.visibility, space.people, roster);
  return allowed.includes(viewer);
}
