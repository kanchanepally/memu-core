/**
 * Story 2.3 — default Minimum Standards of Care.
 *
 * A deliberately opinionated set. Families can disable anything they
 * don't care about and add their own custom standards, but the defaults
 * are what "good enough" family care looks like in the UK context we
 * build for. The descriptions are the text the mobile app shows; do
 * not include names, dates, or anything family-specific.
 *
 * `scope` determines who the standard applies to when seeded:
 *   - 'each_adult'  → one row per adult
 *   - 'each_child'  → one row per child
 *   - 'each_person' → one row per family member
 *   - 'household'   → one row, applies_to = []
 *   - 'couple'      → one row, applies_to = all adults (two max, typically)
 */

import type { SpaceDomain } from '../spaces/model';

export type StandardScope = 'each_adult' | 'each_child' | 'each_person' | 'household' | 'couple';

export interface DefaultStandard {
  domain: SpaceDomain;
  description: string;
  frequencyDays: number;
  scope: StandardScope;
}

export const DEFAULT_STANDARDS: DefaultStandard[] = [
  // Health — the cadences the NHS guidelines roughly assume.
  { domain: 'health', description: 'Dental check-up', frequencyDays: 180, scope: 'each_person' },
  { domain: 'health', description: 'Eye test', frequencyDays: 365, scope: 'each_person' },
  { domain: 'health', description: 'GP check-up', frequencyDays: 365, scope: 'each_adult' },
  { domain: 'health', description: 'Child immunisation review', frequencyDays: 365, scope: 'each_child' },

  // Shelter — household admin that gets forgotten.
  { domain: 'shelter', description: 'Boiler service', frequencyDays: 365, scope: 'household' },
  { domain: 'shelter', description: 'Smoke alarm test', frequencyDays: 90, scope: 'household' },

  // Safety — legally required for anything to keep happening.
  { domain: 'safety', description: 'Car MOT', frequencyDays: 365, scope: 'household' },
  { domain: 'safety', description: 'Car insurance renewal', frequencyDays: 365, scope: 'household' },
  { domain: 'safety', description: 'Home insurance renewal', frequencyDays: 365, scope: 'household' },

  // Finance — the admin that penalises you for forgetting.
  { domain: 'finance', description: 'Self-assessment tax return review', frequencyDays: 365, scope: 'each_adult' },
  { domain: 'finance', description: 'Passport validity check', frequencyDays: 180, scope: 'each_person' },

  // Education — child-facing cadence.
  { domain: 'education', description: 'Parent-teacher meeting attended', frequencyDays: 120, scope: 'each_child' },

  // Relationships — partner cadence, visible only to partners.
  { domain: 'relationships', description: 'Intentional evening together', frequencyDays: 30, scope: 'couple' },

  // Personal space — per-adult, visible only to that person.
  { domain: 'personal_space', description: 'Self-care activity (rest, hobby, movement)', frequencyDays: 7, scope: 'each_adult' },

  // Friendships — non-family contact cadence.
  { domain: 'friendships', description: 'Contact with a friend outside the family', frequencyDays: 30, scope: 'each_adult' },

  // Caregiving — the household-level contingency nobody plans for.
  { domain: 'caregiving', description: 'Childcare backup plan reviewed', frequencyDays: 90, scope: 'household' },
];
