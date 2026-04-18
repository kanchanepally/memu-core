/**
 * Story 2.3 — care standards service.
 *
 * Reads, writes, and seeds rows in the care_standards table. The
 * reflection engine (reflection.ts, extended in Story 2.3) calls
 * `evaluateStandards()` to update status columns and emit
 * `care_standard_lapsed` stream cards.
 */

import { pool } from '../db/connection';
import { DEFAULT_STANDARDS, type DefaultStandard, type StandardScope } from './defaults';
import type { SpaceDomain } from '../spaces/model';

export interface CareStandard {
  id: string;
  familyId: string;
  domain: SpaceDomain;
  description: string;
  frequencyDays: number;
  appliesTo: string[];
  lastCompleted: Date | null;
  nextDue: Date | null;
  status: 'on_track' | 'approaching' | 'overdue';
  enabled: boolean;
  custom: boolean;
}

interface CareStandardRow {
  id: string;
  family_id: string;
  domain: string;
  description: string;
  frequency_days: number;
  applies_to: string[];
  last_completed: Date | null;
  next_due: Date | null;
  status: 'on_track' | 'approaching' | 'overdue';
  enabled: boolean;
  custom: boolean;
}

function rowToStandard(r: CareStandardRow): CareStandard {
  return {
    id: r.id,
    familyId: r.family_id,
    domain: r.domain as SpaceDomain,
    description: r.description,
    frequencyDays: r.frequency_days,
    appliesTo: r.applies_to,
    lastCompleted: r.last_completed,
    nextDue: r.next_due,
    status: r.status,
    enabled: r.enabled,
    custom: r.custom,
  };
}

async function loadRosterIds(familyId: string): Promise<{
  adults: string[];
  children: string[];
  all: string[];
}> {
  const res = await pool.query<{ id: string; role: string }>(
    `SELECT id, role FROM profiles`,
  );
  // Today: single-family deployment, family_id = primary adult profile.
  // When the proper families table lands we filter by family_id here.
  const all = res.rows.map(r => r.id);
  const adults = res.rows.filter(r => r.role === 'adult' || r.role === 'admin').map(r => r.id);
  const children = res.rows.filter(r => r.role === 'child').map(r => r.id);
  return { adults, children, all };
}

function appliesToFor(scope: StandardScope, roster: { adults: string[]; children: string[]; all: string[] }): string[][] {
  switch (scope) {
    case 'each_adult':
      return roster.adults.map(a => [a]);
    case 'each_child':
      return roster.children.map(c => [c]);
    case 'each_person':
      return roster.all.map(p => [p]);
    case 'household':
      return [[]];
    case 'couple':
      return [roster.adults.slice(0, 2)];
    default:
      return [[]];
  }
}

/**
 * Seed the default care standards for a family. Idempotent — the unique
 * index on (family_id, domain, description) WHERE custom=FALSE prevents
 * duplicates. Re-seeds only add standards that don't yet exist (e.g. a
 * new child joined the family).
 */
export async function seedDefaultStandards(familyId: string, defaults: DefaultStandard[] = DEFAULT_STANDARDS): Promise<number> {
  const roster = await loadRosterIds(familyId);
  let inserted = 0;
  for (const standard of defaults) {
    const groups = appliesToFor(standard.scope, roster);
    for (const appliesTo of groups) {
      // For each_person / each_adult / each_child we already have one
      // row per person, but we store it flat (one row, applies_to=[id])
      // so a family with two adults gets two dental rows keyed to each.
      // The uniqueness index treats the description as the key, so we
      // suffix with the person id to avoid collisions.
      const description = standard.scope === 'each_person' || standard.scope === 'each_adult' || standard.scope === 'each_child'
        ? `${standard.description} (${appliesTo[0] ?? 'family'})`
        : standard.description;
      const res = await pool.query(
        `INSERT INTO care_standards (family_id, domain, description, frequency_days, applies_to, custom, next_due)
         VALUES ($1, $2, $3, $4, $5, FALSE, NOW() + ($4 || ' days')::interval)
         ON CONFLICT (family_id, domain, description) WHERE custom = FALSE DO NOTHING
         RETURNING id`,
        [familyId, standard.domain, description, standard.frequencyDays, appliesTo],
      );
      if (res.rowCount && res.rowCount > 0) inserted++;
    }
  }
  return inserted;
}

export async function listStandards(familyId: string, enabledOnly = false): Promise<CareStandard[]> {
  const sql = enabledOnly
    ? `SELECT * FROM care_standards WHERE family_id = $1 AND enabled = TRUE ORDER BY domain, description`
    : `SELECT * FROM care_standards WHERE family_id = $1 ORDER BY domain, description`;
  const res = await pool.query<CareStandardRow>(sql, [familyId]);
  return res.rows.map(rowToStandard);
}

export async function setStandardEnabled(id: string, enabled: boolean): Promise<void> {
  await pool.query(
    `UPDATE care_standards SET enabled = $2, updated_at = NOW() WHERE id = $1`,
    [id, enabled],
  );
}

export async function createCustomStandard(args: {
  familyId: string;
  domain: SpaceDomain;
  description: string;
  frequencyDays: number;
  appliesTo?: string[];
}): Promise<CareStandard> {
  const res = await pool.query<CareStandardRow>(
    `INSERT INTO care_standards (family_id, domain, description, frequency_days, applies_to, custom, next_due)
     VALUES ($1, $2, $3, $4, $5, TRUE, NOW() + ($4 || ' days')::interval)
     RETURNING *`,
    [args.familyId, args.domain, args.description, args.frequencyDays, args.appliesTo ?? []],
  );
  return rowToStandard(res.rows[0]);
}

export async function deleteCustomStandard(id: string): Promise<void> {
  await pool.query(
    `DELETE FROM care_standards WHERE id = $1 AND custom = TRUE`,
    [id],
  );
}

/**
 * Mark a standard as completed — sets last_completed = now() and pushes
 * next_due forward by frequency_days. Used by the completion detection
 * hook and by the user manually ticking things off.
 */
export async function markCompleted(id: string, when: Date = new Date()): Promise<void> {
  await pool.query(
    `UPDATE care_standards
        SET last_completed = $2,
            next_due = $2 + (frequency_days || ' days')::interval,
            status = 'on_track',
            updated_at = NOW()
      WHERE id = $1`,
    [id, when],
  );
}

/**
 * Recompute statuses for every enabled standard in a family. Returns
 * the current shape after the update so callers can use it without a
 * second query. Approaching = within 30 days of next_due; Overdue =
 * past next_due.
 */
export async function evaluateStandards(familyId: string): Promise<CareStandard[]> {
  await pool.query(
    `UPDATE care_standards
        SET status = CASE
          WHEN next_due IS NULL THEN 'on_track'
          WHEN next_due < NOW() THEN 'overdue'
          WHEN next_due < NOW() + INTERVAL '30 days' THEN 'approaching'
          ELSE 'on_track'
        END,
        updated_at = NOW()
      WHERE family_id = $1 AND enabled = TRUE`,
    [familyId],
  );
  return listStandards(familyId, true);
}

export function describeAppliesTo(standard: CareStandard, nameByProfileId: Map<string, string>): string {
  if (standard.appliesTo.length === 0) return 'household';
  return standard.appliesTo.map(id => nameByProfileId.get(id) ?? id).join(', ');
}
