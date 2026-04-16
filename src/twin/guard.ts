import { pool } from '../db/connection';
import { translateToAnonymous } from './translator';

/**
 * Twin guard — enforces that no real family entity leaks to an external
 * LLM provider. Runs at the lowest possible level inside the router, just
 * before the network request, so every call path is covered — including
 * future ones that don't yet exist.
 *
 * Invariant: for any dispatch with `requires_twin: true`, no entry from
 * the family's `entity_registry.real_name` column may appear as a whole
 * word in any outbound text field.
 *
 * Modes (MEMU_TWIN_GUARD_MODE):
 *   - throw              : refuse to dispatch, raise TwinViolationError
 *   - log_and_anonymize  : auto-translate leaking fields, proceed, record violation in ledger
 *   - off                : no-op (NOT recommended, kills the privacy guarantee)
 *
 * Default: 'throw' in development (NODE_ENV !== 'production'),
 *          'log_and_anonymize' in production.
 */

export type TwinGuardMode = 'throw' | 'log_and_anonymize' | 'off';

export class TwinViolationError extends Error {
  violations: string[];
  skillName: string;
  constructor(skillName: string, violations: string[]) {
    super(
      `Twin invariant violation in skill "${skillName}": real entit${violations.length === 1 ? 'y' : 'ies'} ${violations
        .map(v => JSON.stringify(v))
        .join(', ')} about to leak to external provider.`,
    );
    this.name = 'TwinViolationError';
    this.violations = violations;
    this.skillName = skillName;
  }
}

export function resolveGuardMode(): TwinGuardMode {
  const raw = process.env.MEMU_TWIN_GUARD_MODE;
  if (raw === 'throw' || raw === 'log_and_anonymize' || raw === 'off') return raw;
  return process.env.NODE_ENV === 'production' ? 'log_and_anonymize' : 'throw';
}

// ----------------------------------------------------------------------------
// Entity registry loading (with short-TTL cache)
// ----------------------------------------------------------------------------

interface CachedNames {
  names: string[];
  loadedAt: number;
}

const CACHE_TTL_MS = 30_000;
let cache: CachedNames | null = null;

export function resetEntityNameCache(): void {
  cache = null;
}

export async function loadEntityNames(): Promise<string[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.names;
  try {
    const { rows } = await pool.query('SELECT real_name FROM entity_registry');
    const names = rows
      .map(r => (typeof r.real_name === 'string' ? r.real_name.trim() : ''))
      .filter(n => n.length > 1);
    cache = { names, loadedAt: Date.now() };
    return names;
  } catch (err) {
    console.error('[TWIN-GUARD] Failed to load entity registry:', err);
    return [];
  }
}

// ----------------------------------------------------------------------------
// Pure detection
// ----------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return the list of registered real names that appear as whole words in the text.
 * Case-insensitive, same word-boundary semantics as translateToAnonymous.
 */
export function detectViolations(text: string, names: string[]): string[] {
  if (!text || names.length === 0) return [];
  const hits = new Set<string>();
  for (const name of names) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
    if (re.test(text)) hits.add(name);
  }
  return Array.from(hits);
}

// ----------------------------------------------------------------------------
// Enforcement
// ----------------------------------------------------------------------------

export interface OutboundFields {
  systemPrompt?: string;
  userPrompt: string;
  history?: Array<{ role: string; content: string }>;
}

export interface EnforcementResult {
  verified: boolean;
  violations: string[];
  fields: OutboundFields;
  mode: TwinGuardMode;
}

/**
 * Check every outbound text field against the entity registry.
 * In throw mode, throws TwinViolationError on violation (caller handles ledger write).
 * In log_and_anonymize mode, anonymises leaking fields in place and returns violations.
 * In off mode, returns verified=true without checking.
 */
export async function enforceTwinInvariant(
  skillName: string,
  fields: OutboundFields,
  opts: { mode?: TwinGuardMode; names?: string[] } = {},
): Promise<EnforcementResult> {
  const mode = opts.mode ?? resolveGuardMode();
  if (mode === 'off') {
    return { verified: false, violations: [], fields, mode };
  }

  const names = opts.names ?? (await loadEntityNames());
  if (names.length === 0) {
    // Nothing to check against — treat as verified vacuously.
    return { verified: true, violations: [], fields, mode };
  }

  const allViolations = new Set<string>();
  const scan = (s: string | undefined) => {
    if (!s) return;
    for (const v of detectViolations(s, names)) allViolations.add(v);
  };
  scan(fields.systemPrompt);
  scan(fields.userPrompt);
  if (fields.history) for (const h of fields.history) scan(h.content);

  if (allViolations.size === 0) {
    return { verified: true, violations: [], fields, mode };
  }

  const violations = Array.from(allViolations);

  if (mode === 'throw') {
    throw new TwinViolationError(skillName, violations);
  }

  // log_and_anonymize: translate every field through the Twin and continue.
  const anonymised: OutboundFields = {
    systemPrompt: fields.systemPrompt ? await translateToAnonymous(fields.systemPrompt) : undefined,
    userPrompt: await translateToAnonymous(fields.userPrompt),
    history: fields.history
      ? await Promise.all(
          fields.history.map(async h => ({ role: h.role, content: await translateToAnonymous(h.content) })),
        )
      : undefined,
  };

  return { verified: true, violations, fields: anonymised, mode };
}
