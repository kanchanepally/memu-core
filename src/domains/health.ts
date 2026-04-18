/**
 * Story 2.4 — domain health computation.
 *
 * For each of the 13 life domains, compute a green/amber/red status
 * based on the family's care standards and recent reflection findings.
 * Written by the daily reflection pass; read by the briefing skill
 * and /api/domains/status.
 *
 * Rules (from backlog 2.4):
 *   green — no overdue standards, no recent contradictions
 *   amber — at least one approaching standard, or a stale fact, or a
 *           moderately overdue commitment
 *   red   — at least one overdue care standard, OR multiple amber
 *           conditions, OR a contradiction unresolved > 7 days
 */

import { pool } from '../db/connection';
import { SPACE_DOMAINS, type SpaceDomain } from '../spaces/model';

export type DomainHealth = 'green' | 'amber' | 'red';

export interface DomainState {
  domain: SpaceDomain;
  health: DomainHealth;
  lastActivity: Date | null;
  openItems: number;
  overdueStandards: number;
  approachingStandards: number;
  notes: string | null;
  updatedAt: Date;
}

interface StandardCounts {
  overdue: number;
  approaching: number;
  worstOverdueLabel: string | null;
  nextApproachingLabel: string | null;
}

async function countStandardsByDomain(familyId: string): Promise<Map<SpaceDomain, StandardCounts>> {
  const res = await pool.query<{
    domain: string;
    status: 'on_track' | 'approaching' | 'overdue';
    description: string;
    next_due: Date | null;
  }>(
    `SELECT domain, status, description, next_due
       FROM care_standards
      WHERE family_id = $1 AND enabled = TRUE`,
    [familyId],
  );

  const map = new Map<SpaceDomain, StandardCounts>();
  for (const row of res.rows) {
    const key = row.domain as SpaceDomain;
    const current = map.get(key) ?? {
      overdue: 0,
      approaching: 0,
      worstOverdueLabel: null,
      nextApproachingLabel: null,
    };
    if (row.status === 'overdue') {
      current.overdue++;
      // Keep the earliest-due overdue as the "worst" for the note.
      if (!current.worstOverdueLabel && row.next_due) {
        current.worstOverdueLabel = describeOverdue(row.description, row.next_due);
      } else if (!current.worstOverdueLabel) {
        current.worstOverdueLabel = `${row.description} overdue`;
      }
    } else if (row.status === 'approaching') {
      current.approaching++;
      if (!current.nextApproachingLabel && row.next_due) {
        current.nextApproachingLabel = describeApproaching(row.description, row.next_due);
      }
    }
    map.set(key, current);
  }
  return map;
}

function describeOverdue(description: string, dueDate: Date): string {
  const days = Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return `${description} overdue`;
  const unit = days >= 14 ? `${Math.floor(days / 7)} weeks` : `${days} days`;
  return `${description} overdue by ${unit}`;
}

function describeApproaching(description: string, dueDate: Date): string {
  const days = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return `${description} due now`;
  return `${description} in ${days} day${days === 1 ? '' : 's'}`;
}

async function countRecentFindingsByDomain(familyId: string): Promise<Map<SpaceDomain, { contradictions: number; staleFacts: number; unfinished: number }>> {
  // Reflection findings ↔ stream_cards ↔ synthesis_pages (domains[])
  // We join through the card body's linked space URIs is complex; instead
  // we approximate by scanning reflection_findings joined to stream_cards,
  // and bucketing by ANY domain that appears in a matching Space.
  const res = await pool.query<{
    kind: string;
    first_seen_at: Date;
    body: string;
  }>(
    `SELECT rf.kind, rf.first_seen_at, sc.body
       FROM reflection_findings rf
       JOIN stream_cards sc ON sc.id = rf.stream_card_id
      WHERE rf.family_id = $1
        AND sc.status IS DISTINCT FROM 'dismissed'
        AND rf.first_seen_at > NOW() - INTERVAL '14 days'`,
    [familyId],
  );

  // Pull all spaces for the family to map URI → domains[].
  const spaceRes = await pool.query<{ uri: string; domains: string[] }>(
    `SELECT uri, domains FROM synthesis_pages WHERE family_id = $1 AND uri IS NOT NULL`,
    [familyId],
  );
  const domainByUri = new Map<string, string[]>();
  for (const row of spaceRes.rows) {
    domainByUri.set(row.uri, row.domains ?? []);
  }

  const out = new Map<SpaceDomain, { contradictions: number; staleFacts: number; unfinished: number }>();
  for (const row of res.rows) {
    const touched = new Set<SpaceDomain>();
    for (const [uri, domains] of domainByUri) {
      if (row.body && row.body.includes(uri)) {
        for (const d of domains) touched.add(d as SpaceDomain);
      }
    }
    for (const d of touched) {
      const cur = out.get(d) ?? { contradictions: 0, staleFacts: 0, unfinished: 0 };
      if (row.kind === 'contradiction') cur.contradictions++;
      else if (row.kind === 'stale_fact') cur.staleFacts++;
      else if (row.kind === 'unfinished_business') cur.unfinished++;
      out.set(d, cur);
    }
  }
  return out;
}

async function lastActivityByDomain(familyId: string): Promise<Map<SpaceDomain, Date>> {
  const res = await pool.query<{ domain: string; last_updated_at: Date }>(
    `SELECT UNNEST(domains) AS domain, MAX(last_updated_at) AS last_updated_at
       FROM synthesis_pages
      WHERE family_id = $1
      GROUP BY domain`,
    [familyId],
  );
  const map = new Map<SpaceDomain, Date>();
  for (const row of res.rows) {
    map.set(row.domain as SpaceDomain, row.last_updated_at);
  }
  return map;
}

function gradeHealth(
  standards: StandardCounts | undefined,
  findings: { contradictions: number; staleFacts: number; unfinished: number } | undefined,
): DomainHealth {
  const overdue = standards?.overdue ?? 0;
  const approaching = standards?.approaching ?? 0;
  const contradictions = findings?.contradictions ?? 0;
  const staleFacts = findings?.staleFacts ?? 0;
  const unfinished = findings?.unfinished ?? 0;

  if (overdue > 0) return 'red';
  if (contradictions > 0) return 'red';

  let amberSignals = 0;
  if (approaching > 0) amberSignals++;
  if (staleFacts > 0) amberSignals++;
  if (unfinished > 0) amberSignals++;

  if (amberSignals >= 2) return 'red';
  if (amberSignals >= 1) return 'amber';
  return 'green';
}

function formatNotes(
  standards: StandardCounts | undefined,
  findings: { contradictions: number; staleFacts: number; unfinished: number } | undefined,
): string | null {
  const parts: string[] = [];
  if (standards?.worstOverdueLabel) parts.push(standards.worstOverdueLabel);
  else if (standards?.nextApproachingLabel) parts.push(standards.nextApproachingLabel);

  if (findings?.contradictions) parts.push(`${findings.contradictions} unresolved contradiction${findings.contradictions === 1 ? '' : 's'}`);
  if (findings?.staleFacts) parts.push(`${findings.staleFacts} stale fact${findings.staleFacts === 1 ? '' : 's'}`);
  if (findings?.unfinished) parts.push(`${findings.unfinished} unfinished item${findings.unfinished === 1 ? '' : 's'}`);

  if (parts.length === 0) return null;
  return parts.join('; ');
}

/**
 * Recompute every domain's health for a family and upsert the results
 * into domain_states. Returns the freshly computed states so callers
 * (the reflection daily pass, the briefing assembly) can use them
 * without a second query.
 */
export async function computeDomainStates(familyId: string): Promise<DomainState[]> {
  const [standardCounts, recentFindings, lastActivity] = await Promise.all([
    countStandardsByDomain(familyId),
    countRecentFindingsByDomain(familyId),
    lastActivityByDomain(familyId),
  ]);

  const out: DomainState[] = [];
  const now = new Date();
  for (const domain of SPACE_DOMAINS) {
    const standards = standardCounts.get(domain);
    const findings = recentFindings.get(domain);
    const health = gradeHealth(standards, findings);
    const notes = formatNotes(standards, findings);
    const state: DomainState = {
      domain,
      health,
      lastActivity: lastActivity.get(domain) ?? null,
      openItems: (findings?.contradictions ?? 0) + (findings?.staleFacts ?? 0) + (findings?.unfinished ?? 0),
      overdueStandards: standards?.overdue ?? 0,
      approachingStandards: standards?.approaching ?? 0,
      notes,
      updatedAt: now,
    };
    out.push(state);

    await pool.query(
      `INSERT INTO domain_states
         (family_id, domain, health, last_activity, open_items, overdue_standards, approaching_standards, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (family_id, domain) DO UPDATE
         SET health = EXCLUDED.health,
             last_activity = EXCLUDED.last_activity,
             open_items = EXCLUDED.open_items,
             overdue_standards = EXCLUDED.overdue_standards,
             approaching_standards = EXCLUDED.approaching_standards,
             notes = EXCLUDED.notes,
             updated_at = NOW()`,
      [
        familyId,
        domain,
        state.health,
        state.lastActivity,
        state.openItems,
        state.overdueStandards,
        state.approachingStandards,
        state.notes,
      ],
    );
  }
  return out;
}

export async function listDomainStates(familyId: string): Promise<DomainState[]> {
  const res = await pool.query<{
    domain: string;
    health: DomainHealth;
    last_activity: Date | null;
    open_items: number;
    overdue_standards: number;
    approaching_standards: number;
    notes: string | null;
    updated_at: Date;
  }>(
    `SELECT domain, health, last_activity, open_items, overdue_standards,
            approaching_standards, notes, updated_at
       FROM domain_states
      WHERE family_id = $1
      ORDER BY
        CASE health WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END,
        domain`,
    [familyId],
  );
  return res.rows.map(r => ({
    domain: r.domain as SpaceDomain,
    health: r.health,
    lastActivity: r.last_activity,
    openItems: r.open_items,
    overdueStandards: r.overdue_standards,
    approachingStandards: r.approaching_standards,
    notes: r.notes,
    updatedAt: r.updated_at,
  }));
}

export function renderDomainHealthHeader(states: DomainState[]): string {
  const green = states.filter(s => s.health === 'green').map(s => capitalise(s.domain));
  const amber = states.filter(s => s.health === 'amber');
  const red = states.filter(s => s.health === 'red');

  const lines: string[] = ["Today's domains:"];
  if (green.length > 0) {
    lines.push(`✓ ${green.join(', ')}`);
  }
  for (const s of amber) {
    lines.push(`⚠ ${capitalise(s.domain)}${s.notes ? ' — ' + s.notes : ''}`);
  }
  for (const s of red) {
    lines.push(`✕ ${capitalise(s.domain)}${s.notes ? ' — ' + s.notes : ''}`);
  }
  return lines.join('\n');
}

function capitalise(domain: string): string {
  return domain
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
