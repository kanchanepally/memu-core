import { pool } from '../db/connection';
import { dispatch } from '../skills/router';
import { resetEntityNameCache } from './guard';

/**
 * Story 1.5 — novel-entity detection.
 *
 * When an inbound message contains a proper noun the Twin registry hasn't seen,
 * the existing regex-based translator can't anonymise it — it would leak
 * downstream. This module closes that gap.
 *
 * Flow:
 *   1. Run the `twin_translate` skill against the raw inbound text. The skill
 *      returns a JSON array of probable proper nouns with kind + confidence.
 *   2. For each hit not already in `entity_registry`, allocate a fresh anonymous
 *      label and insert with `detected_by='auto_ner'` and `confirmed=FALSE`.
 *   3. Return the list of newly registered entities. Callers then re-run
 *      `translateToAnonymous` which picks up the new rows.
 *
 * Modes (MEMU_TWIN_NOVEL_MODE):
 *   - auto    : detect + register automatically (default when Ollama available)
 *   - prompt  : detect + hold message pending family approval (not implemented)
 *   - off     : skip detection entirely
 *
 * Tier notes: `twin_translate` is `model: local` in its frontmatter. In Tier 2
 * deployments without Ollama, set `MEMU_MODEL_OVERRIDE_LOCAL=haiku` to route it
 * to Claude Haiku as a cloud fallback. The tradeoff (raw names sent to Haiku
 * for extraction) is documented in docs/INTEGRATION_CONTRACTS.md §7.
 */

export type NovelMode = 'auto' | 'prompt' | 'off';

export function resolveNovelMode(): NovelMode {
  const raw = process.env.MEMU_TWIN_NOVEL_MODE;
  if (raw === 'auto' || raw === 'prompt' || raw === 'off') return raw;
  return 'auto';
}

type SkillKind = 'person' | 'place' | 'institution' | 'distinctive_detail';

const KIND_TO_ENTITY_TYPE: Record<SkillKind, string> = {
  person: 'person',
  place: 'location',
  institution: 'institution',
  distinctive_detail: 'other',
};

const ENTITY_TYPE_TO_LABEL_PREFIX: Record<string, string> = {
  person: 'Person',
  location: 'Place',
  institution: 'Institution',
  school: 'School',
  workplace: 'Workplace',
  medical: 'Medical',
  activity: 'Activity',
  business: 'Business',
  other: 'Detail',
};

interface SkillHit {
  text: string;
  kind: SkillKind;
  confidence: number;
}

interface NovelEntity {
  id: string;
  entity_type: string;
  real_name: string;
  anonymous_label: string;
}

function parseSkillOutput(raw: string): SkillHit[] {
  // Skill prompt asks for a bare JSON array. Be defensive about preamble / code fences.
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SkillHit =>
          item &&
          typeof item.text === 'string' &&
          typeof item.kind === 'string' &&
          (item.kind === 'person' ||
            item.kind === 'place' ||
            item.kind === 'institution' ||
            item.kind === 'distinctive_detail') &&
          typeof item.confidence === 'number',
      )
      .filter(item => item.text.trim().length > 1)
      .filter(item => item.confidence >= 0.5);
  } catch {
    return [];
  }
}

async function allocateLabel(entityType: string): Promise<string> {
  const prefix = ENTITY_TYPE_TO_LABEL_PREFIX[entityType] ?? 'Entity';
  // Count existing rows with this entity_type to pick the next number.
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM entity_registry WHERE entity_type = $1',
    [entityType],
  );
  const next = (rows[0]?.n ?? 0) + 1;
  return `${prefix}-${next}`;
}

/**
 * Detect and register novel entities in a raw inbound message.
 * Safe to call on every inbound message — short-circuits when mode is 'off'
 * or when the skill call fails (degrades gracefully rather than blocking the pipeline).
 */
export async function detectAndRegisterNovelEntities(rawText: string): Promise<NovelEntity[]> {
  const mode = resolveNovelMode();
  if (mode === 'off') return [];
  if (!rawText || rawText.trim().length === 0) return [];

  let skillText: string;
  try {
    const result = await dispatch({
      skill: 'twin_translate',
      templateVars: { message: rawText },
      maxTokens: 400,
      temperature: 0,
    });
    skillText = result.text;
  } catch (err) {
    // Local provider not wired, or cloud override absent. Log once, continue.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[TWIN-NOVEL] Skipping detection: ${message}`);
    return [];
  }

  const hits = parseSkillOutput(skillText);
  if (hits.length === 0) return [];

  if (mode === 'prompt') {
    // Mode B — hold-and-prompt not implemented yet. Log hits and return empty
    // so the orchestrator behaves as if detection was off. A follow-up story
    // will add the pending-review queue and mobile push flow.
    console.warn(
      `[TWIN-NOVEL] Mode 'prompt' not yet implemented. Detected ${hits.length} novel entit${hits.length === 1 ? 'y' : 'ies'} but not registering automatically.`,
    );
    return [];
  }

  // Mode A — auto-register with anonymous labels.
  const registered: NovelEntity[] = [];
  for (const hit of hits) {
    const realName = hit.text.trim();
    const entityType = KIND_TO_ENTITY_TYPE[hit.kind];

    // Skip if this exact real_name is already in the registry (case-insensitive).
    const existing = await pool.query(
      'SELECT id FROM entity_registry WHERE LOWER(real_name) = LOWER($1) LIMIT 1',
      [realName],
    );
    if ((existing.rowCount ?? 0) > 0) continue;

    const label = await allocateLabel(entityType);
    try {
      const inserted = await pool.query(
        `INSERT INTO entity_registry (entity_type, real_name, anonymous_label, detected_by, confirmed)
         VALUES ($1, $2, $3, 'auto_ner', FALSE)
         RETURNING id, entity_type, real_name, anonymous_label`,
        [entityType, realName, label],
      );
      const row = inserted.rows[0];
      registered.push({
        id: row.id,
        entity_type: row.entity_type,
        real_name: row.real_name,
        anonymous_label: row.anonymous_label,
      });
    } catch (err) {
      console.error(`[TWIN-NOVEL] Failed to register "${realName}":`, err);
    }
  }

  if (registered.length > 0) {
    console.log(
      `[TWIN-NOVEL] Registered ${registered.length} novel entit${registered.length === 1 ? 'y' : 'ies'}: ${registered
        .map(r => `${r.real_name} → ${r.anonymous_label}`)
        .join(', ')}`,
    );
    // Bust the guard's name cache so downstream translateToAnonymous picks up
    // the new entries on the very next call in this request.
    resetEntityNameCache();
  }

  return registered;
}
