/**
 * Story 3.2 — active-workspace resolver tests.
 *
 * The full requireCollective preHandler is integration-tested via the
 * RLS isolation suite (DATABASE_URL-gated). What we cover here is the
 * pure resolver — given a set of memberships and an optional header
 * value, which workspace becomes active? That logic determines every
 * downstream RLS scope, so it gets its own tight unit coverage.
 */

import { describe, it, expect } from 'vitest';
import { resolveActiveWorkspace } from './auth';

interface FakeMembership {
  collective_id: string;
  collective_type: string;
  collective_status: string;
  pending_deletion_at: Date | null;
  membership_created_at: Date;
}

function makeMembership(overrides: Partial<FakeMembership> & { collective_id: string }): FakeMembership {
  return {
    collective_type: 'household',
    collective_status: 'active',
    pending_deletion_at: null,
    membership_created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('resolveActiveWorkspace', () => {
  it('returns no_workspace when memberships are empty', () => {
    const r = resolveActiveWorkspace([], null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_workspace');
  });

  it('returns no_workspace even when a header is set, if memberships are empty', () => {
    // A client that has a stale active-workspace id but no actual
    // memberships still gets the "you have no workspace" answer —
    // the header is meaningless without a membership it points at.
    const r = resolveActiveWorkspace([], 'orphan-id');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_workspace');
  });

  describe('explicit header', () => {
    it('picks the membership matching the header', () => {
      const a = makeMembership({ collective_id: 'home', membership_created_at: new Date('2026-01-01T00:00:00Z') });
      const b = makeMembership({ collective_id: 'venture', membership_created_at: new Date('2026-03-01T00:00:00Z') });
      const r = resolveActiveWorkspace([a, b], 'venture');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.collective_id).toBe('venture');
      expect(r.source).toBe('header');
    });

    it('returns not_a_member with the requested id when the header points nowhere', () => {
      const a = makeMembership({ collective_id: 'home' });
      const r = resolveActiveWorkspace([a], 'unknown-workspace-id');
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('not_a_member');
      expect(r.requestedId).toBe('unknown-workspace-id');
    });

    it('trims whitespace before matching', () => {
      const a = makeMembership({ collective_id: 'home' });
      const r = resolveActiveWorkspace([a], '  home  ');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.collective_id).toBe('home');
      expect(r.source).toBe('header');
    });

    it('treats whitespace-only header as absent (falls back to default)', () => {
      const a = makeMembership({ collective_id: 'home' });
      const r = resolveActiveWorkspace([a], '   ');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.source).toBe('first');
    });

    it('header wins over personal-first preference', () => {
      // Verifies the spec's "Never infer the active workspace implicitly
      // from anything else" — when a header is present, it's the answer.
      // Personal is the default ONLY in the absence of the header.
      const personal = makeMembership({ collective_id: 'personal-1', collective_type: 'personal' });
      const venture = makeMembership({ collective_id: 'venture-1', collective_type: 'work' });
      const r = resolveActiveWorkspace([personal, venture], 'venture-1');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.collective_id).toBe('venture-1');
      expect(r.source).toBe('header');
    });
  });

  describe('default resolution (no header)', () => {
    it('returns the only membership when there is just one', () => {
      const a = makeMembership({ collective_id: 'home' });
      const r = resolveActiveWorkspace([a], null);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.collective_id).toBe('home');
      expect(r.source).toBe('first');
    });

    it("picks the caller's personal workspace when one exists", () => {
      // Story 3.3 will make this branch fire for every caller; today
      // most users have only household memberships and fall through
      // to 'first'.
      const household = makeMembership({
        collective_id: 'household-1',
        collective_type: 'household',
        membership_created_at: new Date('2026-01-01T00:00:00Z'),
      });
      const personal = makeMembership({
        collective_id: 'personal-1',
        collective_type: 'personal',
        membership_created_at: new Date('2026-04-01T00:00:00Z'),
      });
      const r = resolveActiveWorkspace([household, personal], null);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.collective_id).toBe('personal-1');
      expect(r.source).toBe('personal');
    });

    it('prefers personal over creation order', () => {
      // Even if personal is newer than the household, personal wins
      // when no header is set.
      const household = makeMembership({
        collective_id: 'household-1',
        collective_type: 'household',
        membership_created_at: new Date('2026-01-01T00:00:00Z'),
      });
      const personal = makeMembership({
        collective_id: 'personal-late',
        collective_type: 'personal',
        membership_created_at: new Date('2026-06-01T00:00:00Z'),
      });
      const venture = makeMembership({
        collective_id: 'venture-mid',
        collective_type: 'work',
        membership_created_at: new Date('2026-03-01T00:00:00Z'),
      });
      const r = resolveActiveWorkspace([household, venture, personal], null);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.collective_id).toBe('personal-late');
      expect(r.source).toBe('personal');
    });

    it('falls through to first-by-membership-created-at when no personal exists', () => {
      // The input is ORDER BY membership_created_at ASC (the SQL ordering
      // requirement is documented on loadActiveMemberships). This
      // function trusts the caller to pass them ordered.
      const a = makeMembership({
        collective_id: 'home',
        collective_type: 'household',
        membership_created_at: new Date('2026-01-01T00:00:00Z'),
      });
      const b = makeMembership({
        collective_id: 'venture',
        collective_type: 'work',
        membership_created_at: new Date('2026-03-01T00:00:00Z'),
      });
      const r = resolveActiveWorkspace([a, b], null);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.collective_id).toBe('home');
      expect(r.source).toBe('first');
    });

    it('returns first-personal when multiple personals exist (would be a corrupt state, but pick deterministically)', () => {
      // Story 3.3 guarantees ONE personal per profile. If something
      // racy ever creates two, we don't want to crash — pick the
      // first by created_at order (input ordering is ASC).
      const p1 = makeMembership({
        collective_id: 'p1',
        collective_type: 'personal',
        membership_created_at: new Date('2026-01-01T00:00:00Z'),
      });
      const p2 = makeMembership({
        collective_id: 'p2',
        collective_type: 'personal',
        membership_created_at: new Date('2026-02-01T00:00:00Z'),
      });
      const r = resolveActiveWorkspace([p1, p2], null);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.collective_id).toBe('p1');
    });
  });

  describe('lifecycle status passthrough', () => {
    it('does not filter out inactive/deleted memberships at this layer', () => {
      // The resolver's job is "which membership are we operating on";
      // the caller (requireCollective) is responsible for translating
      // collective.status != 'active' into the right HTTP response.
      // We pass the lifecycle data through verbatim.
      const inactive = makeMembership({
        collective_id: 'sleeping',
        collective_status: 'inactive',
      });
      const r = resolveActiveWorkspace([inactive], null);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.collective_status).toBe('inactive');
    });

    it('passes pending_deletion_at through verbatim', () => {
      const deletion = new Date('2026-12-01T00:00:00Z');
      const m = makeMembership({
        collective_id: 'leaving',
        pending_deletion_at: deletion,
      });
      const r = resolveActiveWorkspace([m], null);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.membership.pending_deletion_at).toEqual(deletion);
    });
  });
});
