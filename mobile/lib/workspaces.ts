/**
 * Pure helpers for the Story 5.3 workspace switcher UI.
 *
 * Anything in this file is testable without a React Native runtime —
 * no AsyncStorage, no fetch, no expo imports. Side-effecting logic
 * lives in api.ts (network) and prefs.ts (storage). The screen
 * (mobile/app/workspaces.tsx) wires them together.
 */

// Local re-declaration of the small slice of types this module touches,
// duplicated here so the test suite can transform this file without
// pulling in api.ts (which transitively imports react-native via
// auth.ts and breaks vitest's ssrTransform). The canonical types live
// in api.ts; if WORKSPACE_TYPES grows there, update this list too.
//
// The screen (mobile/app/workspaces.tsx) imports the API types
// directly from './api' for end-to-end shape coherence; only this
// helpers file uses the local copy.

const CREATABLE_WORKSPACE_TYPE_LIST = [
  'personal',
  'family',
  'work',
  'project',
  'research',
  'community',
] as const;

type LocalWorkspaceType =
  | 'household'
  | 'personal'
  | 'family'
  | 'work'
  | 'project'
  | 'research'
  | 'community';

type LocalCreatableType = (typeof CREATABLE_WORKSPACE_TYPE_LIST)[number];

type LocalWorkspaceCreateReason =
  | 'name_required'
  | 'type_required'
  | 'type_invalid'
  | 'household_reserved';

interface LocalWorkspaceShape {
  id: string;
  name: string;
  type: LocalWorkspaceType;
  parentCollectiveId: string | null;
  status: string;
  role: string;
}

// Public type aliases — keep import surface stable for the screen.
export type Workspace = LocalWorkspaceShape;
export type WorkspaceType = LocalWorkspaceType;
export type WorkspaceCreateReason = LocalWorkspaceCreateReason;
export type WorkspaceRole = 'owner' | 'admin' | 'adult' | 'child';

/**
 * Inline error copy for the create-workspace sheet. Maps backend
 * reason codes from validateWorkspaceCreate (src/api/workspaces.ts)
 * onto user-facing strings. Anything unrecognised falls through to a
 * generic message so a backend reason-code addition doesn't crash the
 * UI silently.
 */
export function workspaceCreateErrorMessage(reason: string | undefined | null): string {
  switch (reason) {
    case 'name_required':
      return 'Give your workspace a name.';
    case 'type_required':
      return 'Pick a workspace type.';
    case 'type_invalid':
      return 'Workspace type is invalid.';
    case 'household_reserved':
      return "Household workspaces are created automatically — you can't make a new one by hand.";
    default:
      return reason || 'Could not create workspace.';
  }
}

/**
 * Validate the create-workspace form locally before hitting the API.
 * Same shape as the backend's validateWorkspaceCreate so the error
 * codes match. The backend re-validates — this is a fast-path so we
 * don't make a round-trip just to get told the name is empty.
 */
export function validateWorkspaceCreateInput(input: {
  name: string;
  type: string;
}): { ok: true; name: string; type: WorkspaceType } | { ok: false; reason: WorkspaceCreateReason } {
  const name = input.name.trim();
  if (!name) return { ok: false, reason: 'name_required' };
  if (!input.type) return { ok: false, reason: 'type_required' };
  if (!isCreatableWorkspaceType(input.type)) {
    if (input.type === 'household') return { ok: false, reason: 'household_reserved' };
    return { ok: false, reason: 'type_invalid' };
  }
  return { ok: true, name: name.slice(0, 120), type: input.type };
}

export function isCreatableWorkspaceType(s: string): s is LocalCreatableType {
  return (CREATABLE_WORKSPACE_TYPE_LIST as readonly string[]).includes(s);
}

/**
 * Adults manage workspaces; children don't. Mirrors the backstop on
 * profiles.role — the screen disables the "+" affordance when this
 * returns true. The backend will refuse anyway (children can't
 * mutate household state by convention), but blocking client-side
 * removes a dead-end interaction.
 */
export function isChildRole(role: WorkspaceRole | string | null | undefined): boolean {
  return role === 'child';
}

/**
 * Pick the user's "home" workspace from a list. The home is the
 * household-type Collective auto-created at registration — there's
 * exactly one in normal accounts. listWorkspaces orders by
 * created_at ASC, so household will normally be first; we still
 * filter by type explicitly so the indicator survives any future
 * ordering tweak. Returns the id, not the row, so callers can match
 * by `w.id === homeId` without aliasing concerns.
 */
export function findHomeWorkspaceId(workspaces: ReadonlyArray<Workspace>): string | null {
  if (workspaces.length === 0) return null;
  const household = workspaces.find(w => w.type === 'household');
  if (household) return household.id;
  // Fallback: caller has no household (edge case — pre-registration
  // shape, or admin manually scrubbed it). Treat the earliest in the
  // list as home so the indicator still anchors somewhere sensible.
  return workspaces[0]!.id;
}

/**
 * Human-readable label for a workspace type. The type enum is a
 * vocabulary; this is the user-facing rendering. Kept here (not
 * tokens.ts) so adding a new type only requires touching backend +
 * api.ts + this map.
 */
export function workspaceTypeLabel(type: WorkspaceType | string): string {
  switch (type) {
    case 'household':
      return 'Household';
    case 'personal':
      return 'Personal';
    case 'family':
      return 'Family';
    case 'work':
      return 'Work';
    case 'project':
      return 'Project';
    case 'research':
      return 'Research';
    case 'community':
      return 'Community';
    default:
      return String(type);
  }
}

/**
 * Human-readable label for a workspace role. Backend roles are
 * 'owner' / 'admin' / 'adult' / 'child' (see Story 1.3 / 2.1).
 */
export function workspaceRoleLabel(role: WorkspaceRole | string): string {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'admin':
      return 'Admin';
    case 'adult':
      return 'Adult';
    case 'child':
      return 'Child';
    default:
      return String(role);
  }
}

/**
 * Toast wording when the user taps "Switch to this workspace". The
 * spec asks for this verbatim — it intentionally names the gap
 * (Today / Chat / Lists don't follow yet, that's Story 3.2) rather
 * than overpromising. If the toast wording is ever shortened, do not
 * lose the "still drives" clause: the user needs to know what the
 * switch actually changes today.
 */
export function workspaceSwitchedToastMessage(workspaceName: string): string {
  return `Switched to ${workspaceName}. You can browse this workspace's projects from here — your main workspace still drives Today, Chat and Lists for now. Cross-workspace browsing for those is coming.`;
}
