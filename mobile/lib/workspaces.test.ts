import { describe, it, expect } from 'vitest';
import {
  findHomeWorkspaceId,
  isChildRole,
  isCreatableWorkspaceType,
  validateWorkspaceCreateInput,
  workspaceCreateErrorMessage,
  workspaceRoleLabel,
  workspaceSwitchedToastMessage,
  workspaceTypeLabel,
} from './workspaces';
import { type Workspace } from './workspaces';

function ws(partial: Partial<Workspace> & { id: string; type: Workspace['type'] }): Workspace {
  return {
    id: partial.id,
    name: partial.name ?? 'Test',
    type: partial.type,
    parentCollectiveId: partial.parentCollectiveId ?? null,
    status: partial.status ?? 'active',
    role: partial.role ?? 'owner',
  };
}

describe('workspaceCreateErrorMessage', () => {
  it('maps every backend reason to a stable user-facing string', () => {
    expect(workspaceCreateErrorMessage('name_required')).toBe('Give your workspace a name.');
    expect(workspaceCreateErrorMessage('type_required')).toBe('Pick a workspace type.');
    expect(workspaceCreateErrorMessage('type_invalid')).toBe('Workspace type is invalid.');
    expect(workspaceCreateErrorMessage('household_reserved')).toContain('Household workspaces are created automatically');
  });

  it('falls through unknown reasons rather than crashing', () => {
    expect(workspaceCreateErrorMessage('unexpected_new_reason')).toBe('unexpected_new_reason');
    expect(workspaceCreateErrorMessage(null)).toBe('Could not create workspace.');
    expect(workspaceCreateErrorMessage(undefined)).toBe('Could not create workspace.');
    expect(workspaceCreateErrorMessage('')).toBe('Could not create workspace.');
  });
});

describe('validateWorkspaceCreateInput', () => {
  it('rejects empty / whitespace name with name_required', () => {
    expect(validateWorkspaceCreateInput({ name: '', type: 'personal' })).toEqual({ ok: false, reason: 'name_required' });
    expect(validateWorkspaceCreateInput({ name: '   ', type: 'personal' })).toEqual({ ok: false, reason: 'name_required' });
  });

  it('rejects missing type with type_required', () => {
    expect(validateWorkspaceCreateInput({ name: 'Side project', type: '' })).toEqual({ ok: false, reason: 'type_required' });
  });

  it('rejects household with the dedicated reserved reason', () => {
    expect(validateWorkspaceCreateInput({ name: 'Home', type: 'household' })).toEqual({ ok: false, reason: 'household_reserved' });
  });

  it('rejects unknown types with type_invalid', () => {
    expect(validateWorkspaceCreateInput({ name: 'Bookclub', type: 'cult' })).toEqual({ ok: false, reason: 'type_invalid' });
  });

  it('accepts each creatable type and trims + clamps the name', () => {
    const ok = validateWorkspaceCreateInput({ name: '  Side project  ', type: 'project' });
    expect(ok).toEqual({ ok: true, name: 'Side project', type: 'project' });

    const long = validateWorkspaceCreateInput({ name: 'a'.repeat(200), type: 'work' });
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.name.length).toBe(120);

    for (const t of ['personal', 'family', 'work', 'project', 'research', 'community'] as const) {
      const res = validateWorkspaceCreateInput({ name: 'x', type: t });
      expect(res.ok).toBe(true);
    }
  });
});

describe('isCreatableWorkspaceType', () => {
  it('returns true for all creatable types and false for household + garbage', () => {
    expect(isCreatableWorkspaceType('personal')).toBe(true);
    expect(isCreatableWorkspaceType('community')).toBe(true);
    expect(isCreatableWorkspaceType('household')).toBe(false);
    expect(isCreatableWorkspaceType('something-else')).toBe(false);
    expect(isCreatableWorkspaceType('')).toBe(false);
  });
});

describe('isChildRole', () => {
  it('is true only for the literal child role', () => {
    expect(isChildRole('child')).toBe(true);
    expect(isChildRole('adult')).toBe(false);
    expect(isChildRole('owner')).toBe(false);
    expect(isChildRole('admin')).toBe(false);
    expect(isChildRole(null)).toBe(false);
    expect(isChildRole(undefined)).toBe(false);
  });
});

describe('findHomeWorkspaceId', () => {
  it('returns null on empty list', () => {
    expect(findHomeWorkspaceId([])).toBeNull();
  });

  it('picks the household-type workspace even if it is not first', () => {
    const list: Workspace[] = [
      ws({ id: 'a', type: 'personal' }),
      ws({ id: 'b', type: 'household' }),
      ws({ id: 'c', type: 'work' }),
    ];
    expect(findHomeWorkspaceId(list)).toBe('b');
  });

  it('falls back to the first workspace when no household exists', () => {
    const list: Workspace[] = [
      ws({ id: 'a', type: 'personal' }),
      ws({ id: 'b', type: 'work' }),
    ];
    expect(findHomeWorkspaceId(list)).toBe('a');
  });

  it('returns the only workspace when there is one', () => {
    expect(findHomeWorkspaceId([ws({ id: 'solo', type: 'household' })])).toBe('solo');
  });
});

describe('workspaceTypeLabel + workspaceRoleLabel', () => {
  it('renders known values capitalised and passes through unknowns', () => {
    expect(workspaceTypeLabel('personal')).toBe('Personal');
    expect(workspaceTypeLabel('community')).toBe('Community');
    expect(workspaceTypeLabel('household')).toBe('Household');
    expect(workspaceTypeLabel('exotic')).toBe('exotic');

    expect(workspaceRoleLabel('owner')).toBe('Owner');
    expect(workspaceRoleLabel('child')).toBe('Child');
    expect(workspaceRoleLabel('weird')).toBe('weird');
  });
});

describe('workspaceSwitchedToastMessage', () => {
  it('names the workspace and the scope-limit caveat', () => {
    const msg = workspaceSwitchedToastMessage('Side Project');
    expect(msg).toContain('Switched to Side Project.');
    expect(msg).toContain('Today, Chat and Lists');
    expect(msg).toContain('coming');
  });
});
