import { describe, it, expect } from 'vitest';
import {
  isWorkspaceType,
  slugifyProjectName,
  validateProjectCreate,
  validateWorkspaceCreate,
  WORKSPACE_TYPES,
} from './workspaces';

describe('isWorkspaceType', () => {
  it('accepts every value in WORKSPACE_TYPES', () => {
    for (const t of WORKSPACE_TYPES) {
      expect(isWorkspaceType(t)).toBe(true);
    }
  });

  it('rejects garbage', () => {
    expect(isWorkspaceType('')).toBe(false);
    expect(isWorkspaceType('something_else')).toBe(false);
    expect(isWorkspaceType(42 as unknown as string)).toBe(false);
    expect(isWorkspaceType(undefined as unknown as string)).toBe(false);
  });

  it('locks the canonical enum to migration 039 + ADR-002', () => {
    // Regression guard — if anyone adds a workspace type to the enum
    // here without also adding it to migration 039's CHECK, this test
    // becomes the visible disagreement signal.
    expect([...WORKSPACE_TYPES]).toEqual([
      'household', 'personal', 'family', 'work', 'project', 'research', 'community',
    ]);
  });
});

describe('slugifyProjectName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyProjectName('Raised Bed Project')).toBe('raised-bed-project');
  });

  it('collapses non-alphanumeric runs', () => {
    expect(slugifyProjectName('Memu  v3 — final!!!')).toBe('memu-v3-final');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugifyProjectName('--leading and trailing--')).toBe('leading-and-trailing');
  });

  it('clamps at 64 chars', () => {
    const long = 'a'.repeat(120);
    expect(slugifyProjectName(long).length).toBeLessThanOrEqual(64);
  });
});

describe('validateProjectCreate', () => {
  it('happy path with derived slug', () => {
    const v = validateProjectCreate({ name: 'Raised Bed Project' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.name).toBe('Raised Bed Project');
    expect(v.slug).toBe('raised-bed-project');
    expect(v.description).toBe('');
  });

  it('explicit slug overrides derived', () => {
    const v = validateProjectCreate({ name: 'My Project', slug: 'custom-slug' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.slug).toBe('custom-slug');
  });

  it('lowercases explicit slug', () => {
    const v = validateProjectCreate({ name: 'X', slug: 'My-Slug' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.slug).toBe('my-slug');
  });

  it('rejects empty name', () => {
    expect(validateProjectCreate({ name: '' }).ok).toBe(false);
    expect(validateProjectCreate({ name: '   ' }).ok).toBe(false);
    expect(validateProjectCreate({}).ok).toBe(false);
    expect(validateProjectCreate(null).ok).toBe(false);
  });

  it('rejects invalid slug shape', () => {
    expect(validateProjectCreate({ name: 'X', slug: 'Bad Slug With Spaces' }).ok).toBe(false);
    expect(validateProjectCreate({ name: 'X', slug: '-leading-hyphen' }).ok).toBe(false);
    expect(validateProjectCreate({ name: 'X', slug: 'trailing-hyphen-' }).ok).toBe(false);
    expect(validateProjectCreate({ name: 'X', slug: '!@#$' }).ok).toBe(false);
  });

  it('trims description', () => {
    const v = validateProjectCreate({ name: 'X', description: '  some text  ' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.description).toBe('some text');
  });
});

describe('validateWorkspaceCreate (Story 3.1)', () => {
  it('happy path with required fields', () => {
    const v = validateWorkspaceCreate({ name: 'Sourdough Research', type: 'research' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.name).toBe('Sourdough Research');
    expect(v.type).toBe('research');
    expect(v.parentCollectiveId).toBeNull();
  });

  it('accepts optional parentCollectiveId', () => {
    const v = validateWorkspaceCreate({
      name: 'Kitchen Project',
      type: 'project',
      parentCollectiveId: 'collective-uuid-here',
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parentCollectiveId).toBe('collective-uuid-here');
  });

  it('coerces empty/whitespace parentCollectiveId to null', () => {
    const v = validateWorkspaceCreate({
      name: 'X',
      type: 'personal',
      parentCollectiveId: '   ',
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parentCollectiveId).toBeNull();
  });

  it('clamps name at 120 chars', () => {
    const long = 'a'.repeat(200);
    const v = validateWorkspaceCreate({ name: long, type: 'personal' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.name.length).toBe(120);
  });

  it('rejects empty/missing name', () => {
    expect(validateWorkspaceCreate({ name: '', type: 'personal' }).ok).toBe(false);
    expect(validateWorkspaceCreate({ name: '   ', type: 'personal' }).ok).toBe(false);
    expect(validateWorkspaceCreate({ type: 'personal' }).ok).toBe(false);
    expect(validateWorkspaceCreate(null).ok).toBe(false);
    expect(validateWorkspaceCreate(undefined).ok).toBe(false);
    expect(validateWorkspaceCreate('not an object').ok).toBe(false);
  });

  it('rejects missing/empty type', () => {
    const a = validateWorkspaceCreate({ name: 'X' });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('type_required');
    const b = validateWorkspaceCreate({ name: 'X', type: '' });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe('type_required');
  });

  it('rejects invalid type with explicit reason', () => {
    const v = validateWorkspaceCreate({ name: 'X', type: 'something_else' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('type_invalid');
  });

  it('rejects household as reserved', () => {
    // Household Collectives are auth-time roots created by
    // registerPrimaryCollectiveAndProfile. Story 3.1 explicitly
    // does not let users mint additional households via the API
    // — see file docblock + validator comment.
    const v = validateWorkspaceCreate({ name: 'X', type: 'household' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('household_reserved');
  });

  it('accepts every non-household WORKSPACE_TYPE', () => {
    for (const t of WORKSPACE_TYPES) {
      if (t === 'household') continue;
      const v = validateWorkspaceCreate({ name: 'X', type: t });
      expect(v.ok).toBe(true);
    }
  });
});
