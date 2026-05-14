import { db } from '../db/tenant';
import type { ReplayResult } from './types';

export interface RecallCard {
  title: string;
  body: string;
  cardType: 'eval_recall';
}

export function renderRecallCard(summary: ReplayResult, previousRecall: number | null): RecallCard {
  const { recallPercent, passed, total, byState } = summary;
  const title = `Retrieval recall · ${recallPercent}%`;

  const lines: string[] = [
    `${passed}/${total} passing across the golden set.`,
    '',
    `By state — sourced ${byState.sourced.passed}/${byState.sourced.total} · fallback ${byState.fallback.passed}/${byState.fallback.total} · empty ${byState.empty.passed}/${byState.empty.total}`,
  ];

  if (previousRecall !== null) {
    const delta = Math.round((recallPercent - previousRecall) * 10) / 10;
    if (delta > 0) lines.push('', `Drift: up ${delta} points from yesterday (${previousRecall}%).`);
    else if (delta < 0) lines.push('', `Drift: down ${Math.abs(delta)} points from yesterday (${previousRecall}%).`);
  }

  // List failing query ids so the developer/owner can drill in.
  const failing = summary.diffs.filter(d => !d.passed);
  if (failing.length > 0) {
    lines.push('', 'Failing:', ...failing.slice(0, 10).map(d => `  · ${d.id}`));
    if (failing.length > 10) lines.push(`  · …and ${failing.length - 10} more`);
  }

  return { title, body: lines.join('\n'), cardType: 'eval_recall' };
}

/**
 * Look up yesterday's eval_recall card title for drift comparison.
 * Returns the percent number parsed from the title, or null on first run.
 *
 * RLS-scoped: must be called inside an active collective context.
 */
export async function readPreviousRecallPercent(): Promise<number | null> {
  const res = await db.query<{ title: string }>(
    `SELECT title FROM stream_cards
      WHERE card_type = 'eval_recall'
      ORDER BY created_at DESC LIMIT 1`,
  );
  if (res.rows.length === 0) return null;
  const m = res.rows[0].title.match(/(\d+(?:\.\d+)?)%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Upsert an eval_recall stream card — one card per collective per day.
 * If today's already exists, delete + reinsert (stream_cards has no
 * unique constraint here; same pattern as migration 030's dedupe).
 *
 * Real schema (per schema.sql / migrations):
 *  - family_id TEXT NOT NULL — the admin profile_id (Story 2.1 convention)
 *  - collective_id TEXT NOT NULL — collectives.id
 *  - source TEXT — uses 'proactive' (closest fit; system-generated surface)
 *  - status TEXT — 'active' (no 'pending' in the enum)
 *
 * RLS-scoped: must be called inside an active collective context.
 */
export async function writeRecallCard(
  collectiveId: string,
  adminProfileId: string,
  card: RecallCard,
): Promise<void> {
  await db.query(
    `DELETE FROM stream_cards
       WHERE card_type = 'eval_recall'
         AND DATE(created_at) = CURRENT_DATE`,
  );
  // Explicit Dismiss-only actions — informational card, no semantic
  // "Mark done" affordance. The PWA's nudge fallback would otherwise
  // synthesise Mark-done + Dismiss for any card with empty actions.
  const actions = JSON.stringify([{ type: 'dismiss', label: 'Dismiss' }]);
  await db.query(
    `INSERT INTO stream_cards (family_id, collective_id, card_type, title, body, source, status, actions)
     VALUES ($1, $2, 'eval_recall', $3, $4, 'proactive', 'active', $5::jsonb)`,
    [adminProfileId, collectiveId, card.title, card.body, actions],
  );
}
