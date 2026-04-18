/**
 * Story 2.3 — pure-logic tests for the default care-standards catalogue.
 * Seeder behaviour against Postgres is exercised by manual QA per
 * the story DoD.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_STANDARDS } from './defaults';

describe('DEFAULT_STANDARDS', () => {
  it('covers the cadences the story spec calls out', () => {
    const descriptions = DEFAULT_STANDARDS.map(s => s.description);
    expect(descriptions).toContain('Dental check-up');
    expect(descriptions).toContain('Car MOT');
    expect(descriptions).toContain('Boiler service');
    expect(descriptions).toContain('Intentional evening together');
  });

  it('uses positive frequency days', () => {
    for (const s of DEFAULT_STANDARDS) {
      expect(s.frequencyDays).toBeGreaterThan(0);
    }
  });

  it('only emits valid scopes', () => {
    const valid = new Set(['each_adult', 'each_child', 'each_person', 'household', 'couple']);
    for (const s of DEFAULT_STANDARDS) {
      expect(valid.has(s.scope)).toBe(true);
    }
  });

  it('every standard has a domain', () => {
    for (const s of DEFAULT_STANDARDS) {
      expect(s.domain).toBeTruthy();
      expect(typeof s.domain).toBe('string');
    }
  });

  it('descriptions are unique within the default set', () => {
    const seen = new Set<string>();
    for (const s of DEFAULT_STANDARDS) {
      // domain+description is the partial-unique key — but for the canonical
      // defaults they are unique by description alone, which is what the
      // mobile UI groups by.
      expect(seen.has(s.description)).toBe(false);
      seen.add(s.description);
    }
  });

  it('the couple-scoped relationship cadence exists', () => {
    const couple = DEFAULT_STANDARDS.filter(s => s.scope === 'couple');
    expect(couple.length).toBeGreaterThan(0);
    expect(couple.some(s => s.domain === 'relationships')).toBe(true);
  });

  it('the per-adult self-care standard exists', () => {
    const selfCare = DEFAULT_STANDARDS.find(
      s => s.domain === 'personal_space' && s.scope === 'each_adult',
    );
    expect(selfCare).toBeDefined();
    expect(selfCare?.frequencyDays).toBeLessThanOrEqual(7);
  });
});
