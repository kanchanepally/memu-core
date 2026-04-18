import { describe, it, expect } from 'vitest';
import {
  allowedNextStatuses,
  canTransition,
  computeGraceUntil,
  isLeaveFinalisable,
  validateSpaceUrl,
  validateWebid,
  MembershipError,
  LEAVE_POLICIES,
  type MemberStatus,
} from './membership';

describe('canTransition', () => {
  it('allows invited → active (accept)', () => {
    expect(canTransition('invited', 'active')).toBe(true);
  });

  it('allows invited → left (admin removes invite)', () => {
    expect(canTransition('invited', 'left')).toBe(true);
  });

  it('allows active → leaving (initiate leave)', () => {
    expect(canTransition('active', 'leaving')).toBe(true);
  });

  it('allows active → left (admin force-removes)', () => {
    expect(canTransition('active', 'left')).toBe(true);
  });

  it('allows leaving → active (cancel within grace)', () => {
    expect(canTransition('leaving', 'active')).toBe(true);
  });

  it('allows leaving → left (finalise after grace)', () => {
    expect(canTransition('leaving', 'left')).toBe(true);
  });

  it('treats left as terminal', () => {
    expect(allowedNextStatuses('left')).toEqual([]);
    for (const t of ['invited', 'active', 'leaving', 'left'] as MemberStatus[]) {
      expect(canTransition('left', t)).toBe(false);
    }
  });

  it('rejects illegal jumps (invited → leaving, active → invited)', () => {
    expect(canTransition('invited', 'leaving')).toBe(false);
    expect(canTransition('active', 'invited')).toBe(false);
    expect(canTransition('leaving', 'invited')).toBe(false);
  });
});

describe('validateWebid', () => {
  it('accepts an https URL with #me fragment', () => {
    const r = validateWebid('https://family.test/people/sam#me');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalised).toBe('https://family.test/people/sam#me');
  });

  it('accepts an https URL without a fragment', () => {
    const r = validateWebid('https://family.test/people/sam');
    expect(r.ok).toBe(true);
  });

  it('rejects http (must be https)', () => {
    const r = validateWebid('http://family.test/people/sam#me');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('webid_must_be_https');
  });

  it('rejects garbage strings', () => {
    const r = validateWebid('not a url');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('webid_not_a_url');
  });
});

describe('validateSpaceUrl', () => {
  it('strips fragment but preserves the rest', () => {
    const r = validateSpaceUrl('https://pod.test/spaces/person/sam#section');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalised).toBe('https://pod.test/spaces/person/sam');
  });

  it('preserves trailing slash (containers)', () => {
    const r = validateSpaceUrl('https://pod.test/spaces/sam/');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalised).toBe('https://pod.test/spaces/sam/');
  });

  it('rejects http', () => {
    const r = validateSpaceUrl('http://pod.test/spaces/x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('space_url_must_be_https');
  });
});

describe('computeGraceUntil', () => {
  it('adds N days in milliseconds', () => {
    const now = new Date('2026-04-18T00:00:00.000Z');
    const result = computeGraceUntil(now, 30);
    expect(result.toISOString()).toBe('2026-05-18T00:00:00.000Z');
  });

  it('accepts 0 (no grace)', () => {
    const now = new Date('2026-04-18T12:00:00.000Z');
    expect(computeGraceUntil(now, 0).toISOString()).toBe(now.toISOString());
  });

  it('rejects negative grace days', () => {
    expect(() => computeGraceUntil(new Date(), -1)).toThrow(MembershipError);
  });

  it('rejects fractional grace days', () => {
    expect(() => computeGraceUntil(new Date(), 1.5)).toThrow(MembershipError);
  });
});

describe('isLeaveFinalisable', () => {
  const past = new Date('2026-04-01T00:00:00.000Z');
  const future = new Date('2027-01-01T00:00:00.000Z');
  const now = new Date('2026-04-18T00:00:00.000Z');

  it('true when status=leaving and grace_until is in the past', () => {
    expect(isLeaveFinalisable({ status: 'leaving', leaveGraceUntil: past }, now)).toBe(true);
  });

  it('false when status=leaving but grace_until is in the future', () => {
    expect(isLeaveFinalisable({ status: 'leaving', leaveGraceUntil: future }, now)).toBe(false);
  });

  it('false when status is not leaving even with expired grace', () => {
    expect(isLeaveFinalisable({ status: 'active', leaveGraceUntil: past }, now)).toBe(false);
    expect(isLeaveFinalisable({ status: 'invited', leaveGraceUntil: past }, now)).toBe(false);
    expect(isLeaveFinalisable({ status: 'left', leaveGraceUntil: past }, now)).toBe(false);
  });

  it('false when leave_grace_until is null', () => {
    expect(isLeaveFinalisable({ status: 'leaving', leaveGraceUntil: null }, now)).toBe(false);
  });
});

describe('LEAVE_POLICIES catalogue', () => {
  it('matches the CHECK constraint in migration 014', () => {
    expect([...LEAVE_POLICIES].sort()).toEqual(['anonymise', 'remove', 'retain_attributed']);
  });
});
