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

// ---------------------------------------------------------------------------
// Category sets — Build Spec 2 Phase R1.
//
// The set of valid Space categories is no longer global. It's a function
// of the owning workspace's `type`:
//
//   family / personal / work / project / community / household → FAMILY_CATEGORIES
//   research                                                    → RESEARCH_CATEGORIES
//
// `document` deliberately overlaps both — researchers attach PDFs and bills
// the same way families do; the category is shared. Every other category
// belongs to exactly one set.
//
// SPACE_CATEGORIES is the UNION used by the database CHECK constraint
// (the schema can't be type-aware) and by parseSpaceUri (a memu:// URI's
// category segment may come from either set). The real "is this category
// valid for THIS workspace" rule lives in isCategoryAllowedForType
// below, applied in the Space write path. The CHECK is a typo guard;
// the function is the authority.
//
// Adding a category set: extend RESEARCH_CATEGORIES (or add a new const
// for a future set), add the new strings to SPACE_CATEGORIES, extend
// getCategorySetForType. Adding a workspace type that needs its own set:
// extend WORKSPACE_TYPES in src/api/workspaces.ts AND extend the switch
// in getCategorySetForType. Until a type earns its own set it falls back
// to FAMILY_CATEGORIES (spec §1.3 — no premature abstraction).
// ---------------------------------------------------------------------------

export const FAMILY_CATEGORIES = [
  'person', 'routine', 'household', 'commitment', 'document',
] as const;

export const RESEARCH_CATEGORIES = [
  'memo', 'theme', 'participant', 'source', 'document', 'question', 'quote',
] as const;

// Union of every category across every set. Deduped by Set to keep
// `document` from appearing twice. Order: family set first (preserves
// historic ordering for any consumer that iterates), then research-only
// additions appended.
export const SPACE_CATEGORIES = [
  ...FAMILY_CATEGORIES,
  ...RESEARCH_CATEGORIES.filter(c => !(FAMILY_CATEGORIES as readonly string[]).includes(c)),
] as const;

export type SpaceCategory = typeof SPACE_CATEGORIES[number];

/**
 * The category set permitted for a given workspace type. Research gets
 * the research set; every other type (today) falls back to family.
 *
 * Inputs from outside the type system (e.g. a string read from the DB)
 * land here too — we accept `string` so callers don't need to narrow
 * before calling. Unknown values get the family set, matching the
 * spec's "fall back to family" rule.
 */
export function getCategorySetForType(workspaceType: string): readonly SpaceCategory[] {
  return workspaceType === 'research' ? RESEARCH_CATEGORIES : FAMILY_CATEGORIES;
}

/**
 * True iff `category` is in the set permitted for `workspaceType`.
 * The Space write path's gate; the DB CHECK is a typo guard, this is
 * the rule.
 */
export function isCategoryAllowedForType(category: string, workspaceType: string): boolean {
  return (getCategorySetForType(workspaceType) as readonly string[]).includes(category);
}

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
  /**
   * Optional URI of another Space that this one lives under. Two-level
   * constraint: a parent's parent must itself be null. Enforced in
   * app code via validateParentRelationship in src/spaces/store.ts —
   * the schema permits N-level chains so the data model can flex
   * later without a migration.
   */
  parentSpaceUri?: string | null;
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
