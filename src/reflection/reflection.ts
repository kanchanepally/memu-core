/**
 * Story 2.2 — the reflection engine.
 *
 * Three cadences, one skill, shared idempotency:
 *
 *   - per_message: synchronous after a Space write. Cheap check for
 *     contradictions against the Space we just touched and its links.
 *   - daily: runs nightly at family_settings.reflection_daily_hour
 *     (default 03:15). Walks the whole catalogue.
 *   - weekly: runs Sundays at 23:00. Pattern detection across the week.
 *
 * Findings become stream_cards of type contradiction / stale_fact /
 * unfinished_business / pattern. We dedupe across runs via a SHA-256
 * over (kind, title, sorted space_uris) so the same finding two
 * nights running doesn't card twice.
 *
 * The whole engine respects family_settings.reflection_enabled — set
 * that to false and every cadence is a no-op.
 */

import crypto from 'crypto';
import { pool } from '../db/connection';
import { dispatch } from '../skills/router';
import { getCatalogue, renderCatalogueForPrompt, type CatalogueEntry } from '../spaces/catalogue';
import { findSpaceByUri } from '../spaces/store';
import type { Space } from '../spaces/model';
import { translateToReal } from '../twin/translator';
import { evaluateStandards, type CareStandard } from '../care/standards';
import { computeDomainStates } from '../domains/health';

export type Cadence = 'per_message' | 'daily' | 'weekly';

export type FindingKind = 'contradiction' | 'stale_fact' | 'unfinished_business' | 'pattern';

interface ReflectionFinding {
  kind: FindingKind;
  title: string;
  body: string;
  space_refs: string[];
  confidence: number;
}

const CARD_TYPE_BY_KIND: Record<FindingKind, string> = {
  contradiction: 'contradiction',
  stale_fact: 'stale_fact',
  unfinished_business: 'unfinished_business',
  pattern: 'pattern',
};

async function reflectionEnabled(familyId: string): Promise<boolean> {
  const res = await pool.query<{ reflection_enabled: boolean }>(
    `SELECT reflection_enabled FROM family_settings WHERE family_id = $1`,
    [familyId],
  );
  if (res.rows.length === 0) return true;
  return res.rows[0].reflection_enabled;
}

async function listFamilyIds(): Promise<string[]> {
  const res = await pool.query<{ family_id: string }>(
    `SELECT DISTINCT family_id FROM synthesis_pages`,
  );
  return res.rows.map(r => r.family_id);
}

/**
 * Gather anonymised recent activity for a family — the stream cards
 * and spaces_log entries from a rolling window matching the cadence.
 */
async function loadRecentActivity(familyId: string, cadence: Cadence): Promise<string> {
  const windows: Record<Cadence, string> = {
    per_message: "1 day",
    daily: "2 days",
    weekly: "8 days",
  };
  const window = windows[cadence];

  const cards = await pool.query(
    `SELECT card_type, title, body, created_at
       FROM stream_cards
      WHERE family_id = $1
        AND created_at > NOW() - INTERVAL '${window}'
      ORDER BY created_at DESC
      LIMIT 50`,
    [familyId],
  );
  const logs = await pool.query(
    `SELECT event, summary, created_at
       FROM spaces_log
      WHERE family_id = $1
        AND event != 'query_served'
        AND created_at > NOW() - INTERVAL '${window}'
      ORDER BY created_at DESC
      LIMIT 50`,
    [familyId],
  );

  const cardLines = cards.rows.map(
    r => `- ${r.created_at.toISOString()} [${r.card_type}] ${r.title}: ${r.body}`,
  );
  const logLines = logs.rows.map(
    r => `- ${r.created_at.toISOString()} [${r.event}] ${r.summary}`,
  );
  const combined = [...cardLines, ...logLines].join('\n');
  return combined || '(no recent activity)';
}

export function findingHash(kind: FindingKind, title: string, spaceRefs: string[]): string {
  const sorted = [...spaceRefs].sort().join('|');
  return crypto.createHash('sha256').update(`${kind}|${title}|${sorted}`).digest('hex');
}

// Findings below this threshold are dropped. Raised from 0.5 → 0.7 on
// 2026-04-25 after dogfooding showed too many low-confidence "patterns"
// landing as cards.
const REFLECTION_MIN_CONFIDENCE = 0.7;

async function persistFinding(
  familyId: string,
  cadence: Cadence,
  finding: ReflectionFinding,
): Promise<'new' | 'duplicate' | 'dropped'> {
  if (finding.confidence < REFLECTION_MIN_CONFIDENCE) {
    return 'dropped';
  }

  const hash = findingHash(finding.kind, finding.title, finding.space_refs);

  const existing = await pool.query(
    `SELECT stream_card_id FROM reflection_findings
      WHERE family_id = $1 AND finding_hash = $2`,
    [familyId, hash],
  );
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE reflection_findings SET last_seen_at = NOW()
        WHERE family_id = $1 AND finding_hash = $2`,
      [familyId, hash],
    );
    return 'duplicate';
  }

  const realTitle = await translateToReal(finding.title);
  const realBody = await translateToReal(formatFindingBody(finding));

  // Action set depends on kind. The old "Resolve → dismiss" was a UX
  // dead-end (clicking it just removed the card, didn't act). Stale facts
  // and unfinished business now offer "Update Space" (opens detail) or
  // "Not relevant" (dismiss). Patterns and contradictions are observation-
  // only — the right response is for the user to decide and act
  // elsewhere, so they get "Got it" + "Not relevant".
  const actions = finding.kind === 'stale_fact' || finding.kind === 'unfinished_business'
    ? finding.space_refs.length > 0
      ? [
          { label: 'Open Space', type: 'open_space', uri: finding.space_refs[0] },
          { label: 'Not relevant', type: 'dismiss' },
        ]
      : [
          { label: 'Got it', type: 'dismiss' },
          { label: 'Not relevant', type: 'dismiss' },
        ]
    : [
        { label: 'Got it', type: 'dismiss' },
        { label: 'Not relevant', type: 'dismiss' },
      ];

  const cardRes = await pool.query<{ id: string }>(
    `INSERT INTO stream_cards (family_id, card_type, title, body, source, actions)
     VALUES ($1, $2, $3, $4, 'proactive', $5)
     RETURNING id`,
    [
      familyId,
      CARD_TYPE_BY_KIND[finding.kind],
      realTitle,
      realBody,
      JSON.stringify(actions),
    ],
  );
  const cardId = cardRes.rows[0].id;

  await pool.query(
    `INSERT INTO reflection_findings (family_id, finding_hash, cadence, kind, stream_card_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [familyId, hash, cadence, finding.kind, cardId],
  );
  return 'new';
}

function formatFindingBody(finding: ReflectionFinding): string {
  const refs = finding.space_refs.length > 0
    ? `\n\nRelated: ${finding.space_refs.map(s => `[[${s}]]`).join(', ')}`
    : '';
  const confidenceNote = finding.confidence < 0.6 ? `\n\n(Memu isn't fully sure — worth a quick check.)` : '';
  return `${finding.body}${refs}${confidenceNote}`;
}

export function parseFindings(text: string): ReflectionFinding[] {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f: any) => f && f.kind && f.title && f.body)
      .map((f: any) => ({
        kind: f.kind,
        title: String(f.title),
        body: String(f.body),
        space_refs: Array.isArray(f.space_refs) ? f.space_refs.map((r: any) => String(r)) : [],
        confidence: typeof f.confidence === 'number' ? f.confidence : 0.5,
      }));
  } catch {
    return [];
  }
}

async function callReflection(args: {
  familyId: string;
  cadence: Cadence;
  catalogue: CatalogueEntry[];
  recentActivity: string;
}): Promise<ReflectionFinding[]> {
  const { text } = await dispatch({
    skill: 'reflection',
    templateVars: {
      cadence: args.cadence,
      spaces_catalogue: renderCatalogueForPrompt(args.catalogue),
      recent_activity: args.recentActivity,
      now_iso: new Date().toISOString(),
    },
    profileId: args.familyId,
    familyId: args.familyId,
    useBYOK: true,
  });
  return parseFindings(text);
}

export interface ReflectionResult {
  cadence: Cadence;
  familyId: string;
  findingsRaised: number;
  findingsDeduped: number;
  standardsChecked?: number;
  standardsLapsed?: number;
  domainsRecomputed?: number;
  skipped?: 'disabled';
}

/**
 * Story 2.3 — the fourth reflection pass. Recompute every enabled
 * standard's status and raise a care_standard_lapsed stream card for
 * anything that has just gone overdue. Idempotent via reflection_findings
 * like the other cadences.
 */
export async function runStandardsCheck(familyId: string): Promise<{ checked: number; lapsed: number }> {
  const standards = await evaluateStandards(familyId);
  let lapsed = 0;
  for (const standard of standards) {
    if (standard.status !== 'overdue') continue;
    const title = `${standard.description} is overdue`;
    const body = describeLapse(standard);
    const hash = findingHash('unfinished_business', title, [standard.id]);
    const existing = await pool.query(
      `SELECT 1 FROM reflection_findings WHERE family_id = $1 AND finding_hash = $2`,
      [familyId, hash],
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE reflection_findings SET last_seen_at = NOW() WHERE family_id = $1 AND finding_hash = $2`,
        [familyId, hash],
      );
      continue;
    }
    const cardRes = await pool.query<{ id: string }>(
      `INSERT INTO stream_cards (family_id, card_type, title, body, source, actions)
       VALUES ($1, 'care_standard_lapsed', $2, $3, 'proactive', $4)
       RETURNING id`,
      [
        familyId,
        title,
        body,
        JSON.stringify([
          { label: 'Mark done', type: 'standard_complete', standard_id: standard.id },
          { label: 'Snooze', type: 'dismiss' },
        ]),
      ],
    );
    await pool.query(
      `INSERT INTO reflection_findings (family_id, finding_hash, cadence, kind, stream_card_id)
       VALUES ($1, $2, 'daily', 'unfinished_business', $3)`,
      [familyId, hash, cardRes.rows[0].id],
    );
    lapsed++;
  }
  return { checked: standards.length, lapsed };
}

function describeLapse(standard: CareStandard): string {
  const dueNote = standard.nextDue
    ? `Due ${standard.nextDue.toISOString().slice(0, 10)}.`
    : `No date recorded — worth booking.`;
  return `${dueNote} Domain: ${standard.domain}.`;
}

export async function runReflection(cadence: Cadence, familyId: string): Promise<ReflectionResult> {
  if (!(await reflectionEnabled(familyId))) {
    return { cadence, familyId, findingsRaised: 0, findingsDeduped: 0, skipped: 'disabled' };
  }
  const catalogue = await getCatalogue(familyId, familyId);
  const recentActivity = await loadRecentActivity(familyId, cadence);
  const findings = await callReflection({ familyId, cadence, catalogue, recentActivity });

  let raised = 0;
  let deduped = 0;
  for (const finding of findings) {
    if (cadence !== 'weekly' && finding.kind === 'pattern') continue; // pattern is weekly-only
    const outcome = await persistFinding(familyId, cadence, finding);
    if (outcome === 'new') raised++;
    else if (outcome === 'duplicate') deduped++;
    // 'dropped' (low confidence) silently skipped
  }

  // Story 2.3 — the fourth pass runs alongside the daily LLM scan.
  // Runs on daily cadence only; per-message is too narrow, weekly
  // would delay urgent lapses.
  let standardsChecked: number | undefined;
  let standardsLapsed: number | undefined;
  let domainsRecomputed: number | undefined;
  if (cadence === 'daily') {
    const check = await runStandardsCheck(familyId);
    standardsChecked = check.checked;
    standardsLapsed = check.lapsed;
    // Story 2.4 — recompute domain health states once per night, after
    // standards check so newly-overdue items propagate into the grading.
    try {
      const states = await computeDomainStates(familyId);
      domainsRecomputed = states.length;
    } catch (err) {
      console.error('[REFLECTION] domain health recompute failed:', err);
    }
  }

  return {
    cadence,
    familyId,
    findingsRaised: raised,
    findingsDeduped: deduped,
    standardsChecked,
    standardsLapsed,
    domainsRecomputed,
  };
}

/**
 * Per-message reflection — scoped to a single freshly-written Space.
 * Cheap and synchronous (well, async but awaited by its fire-and-forget
 * caller in synthesis.ts). Looks only at this Space and whatever
 * Spaces it wikilinks to.
 */
export async function runPerMessageReflection(familyId: string, touched: Space): Promise<ReflectionResult> {
  if (!(await reflectionEnabled(familyId))) {
    return { cadence: 'per_message', familyId, findingsRaised: 0, findingsDeduped: 0, skipped: 'disabled' };
  }
  const wikilinks = [...touched.bodyMarkdown.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].toLowerCase().trim());
  const fullCatalogue = await getCatalogue(familyId, familyId);
  const relevant = fullCatalogue.filter(
    e => e.uri === touched.uri || wikilinks.includes(e.slug) || wikilinks.includes(e.name.toLowerCase()),
  );

  const linkedSpaces: Space[] = [];
  for (const entry of relevant) {
    const sp = await findSpaceByUri(entry.uri);
    if (sp) linkedSpaces.push(sp);
  }

  const recent = linkedSpaces
    .map(s => `=== ${s.name} (${s.category}) uri=${s.uri} ===\n${s.bodyMarkdown}`)
    .join('\n\n---\n\n') || touched.bodyMarkdown;

  const findings = await callReflection({
    familyId,
    cadence: 'per_message',
    catalogue: relevant,
    recentActivity: recent,
  });

  let raised = 0;
  let deduped = 0;
  for (const finding of findings) {
    if (finding.kind !== 'contradiction') continue; // per-message is contradiction-only
    const outcome = await persistFinding(familyId, 'per_message', finding);
    if (outcome === 'new') raised++;
    else if (outcome === 'duplicate') deduped++;
    // 'dropped' (low confidence) silently skipped
  }
  return { cadence: 'per_message', familyId, findingsRaised: raised, findingsDeduped: deduped };
}

export async function runReflectionForAllFamilies(cadence: Cadence): Promise<ReflectionResult[]> {
  const families = await listFamilyIds();
  const results: ReflectionResult[] = [];
  for (const familyId of families) {
    try {
      results.push(await runReflection(cadence, familyId));
    } catch (err) {
      console.error(`[REFLECTION] ${cadence} pass failed for family ${familyId}:`, err);
    }
  }
  return results;
}

/**
 * Lightweight daily maintenance — standards check + domain health recompute,
 * with NO LLM reflection scan. The daily LLM scan was retired 2026-04-25
 * because it duplicated work the morning briefing already does and was the
 * primary noise source in stream cards. Per_message contradiction checks
 * (synchronous) and the weekly pattern detector remain. This pass runs at
 * 06:30 so domain states are fresh for the 07:00 briefing.
 */
export interface DailyMaintenanceResult {
  familyId: string;
  standardsChecked: number;
  standardsLapsed: number;
  domainsRecomputed: number;
  skipped?: 'disabled';
}

export async function runDailyMaintenance(familyId: string): Promise<DailyMaintenanceResult> {
  if (!(await reflectionEnabled(familyId))) {
    return { familyId, standardsChecked: 0, standardsLapsed: 0, domainsRecomputed: 0, skipped: 'disabled' };
  }
  const check = await runStandardsCheck(familyId);
  let domainsRecomputed = 0;
  try {
    const states = await computeDomainStates(familyId);
    domainsRecomputed = states.length;
  } catch (err) {
    console.error('[MAINTENANCE] domain health recompute failed:', err);
  }
  return {
    familyId,
    standardsChecked: check.checked,
    standardsLapsed: check.lapsed,
    domainsRecomputed,
  };
}

export async function runDailyMaintenanceForAllFamilies(): Promise<DailyMaintenanceResult[]> {
  const families = await listFamilyIds();
  const results: DailyMaintenanceResult[] = [];
  for (const familyId of families) {
    try {
      results.push(await runDailyMaintenance(familyId));
    } catch (err) {
      console.error(`[MAINTENANCE] daily maintenance failed for family ${familyId}:`, err);
    }
  }
  return results;
}
