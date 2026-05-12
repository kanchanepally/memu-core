/**
 * Onboarding state — per-profile progress through the conversational
 * setup flow. Persisted in `profiles.onboarding_state` JSONB so closing
 * the app mid-flow lands the user back on the next pending step.
 *
 * State machine: each step independently progresses pending → answered |
 * skipped. The flow is finished when every step has a non-pending status,
 * or when the user explicitly completes early (some steps may stay
 * skipped / pending and that is fine — the user can revisit any step
 * from Settings → Setup).
 *
 * The accumulated `answers` map preserves the raw text the user typed
 * so we can re-prefill the input when they revisit a step. Stored in
 * cleartext (real names) — this is the user's own profile, no other
 * profile can read it. The Twin invariant only applies when this text
 * leaves the database to reach an LLM, which is handled elsewhere.
 */

import { db } from '../db/tenant';

export type OnboardingStep = 'people' | 'rhythm' | 'focus' | 'preview' | 'channels';
export type StepStatus = 'pending' | 'answered' | 'skipped';

export const ONBOARDING_STEP_ORDER: OnboardingStep[] = [
  'people',
  'rhythm',
  'focus',
  'preview',
  'channels',
];

export interface OnboardingState {
  people: StepStatus;
  rhythm: StepStatus;
  focus: StepStatus;
  preview: StepStatus;
  channels: StepStatus;
  completedAt: string | null;
  answers: Partial<Record<OnboardingStep, string>>;
}

const DEFAULT_STATE: OnboardingState = {
  people: 'pending',
  rhythm: 'pending',
  focus: 'pending',
  preview: 'pending',
  channels: 'pending',
  completedAt: null,
  answers: {},
};

/**
 * Normalise a raw row from `profiles.onboarding_state` into a fully-shaped
 * OnboardingState. Tolerates missing keys (older profiles created before the
 * migration land with `{}`) and bad values (typed as a string union, but JSONB
 * is loosely typed; defensive parse).
 */
export function normaliseState(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
  const obj = raw as Record<string, unknown>;

  const coerce = (v: unknown): StepStatus => {
    if (v === 'answered' || v === 'skipped' || v === 'pending') return v;
    return 'pending';
  };

  const answers: Partial<Record<OnboardingStep, string>> = {};
  if (obj.answers && typeof obj.answers === 'object') {
    for (const step of ONBOARDING_STEP_ORDER) {
      const v = (obj.answers as Record<string, unknown>)[step];
      if (typeof v === 'string') answers[step] = v;
    }
  }

  return {
    people: coerce(obj.people),
    rhythm: coerce(obj.rhythm),
    focus: coerce(obj.focus),
    preview: coerce(obj.preview),
    channels: coerce(obj.channels),
    completedAt: typeof obj.completedAt === 'string' ? obj.completedAt : null,
    answers,
  };
}

/**
 * Pure helper: which step should the UI navigate to next? Returns null when
 * the flow is complete (all steps non-pending OR completedAt set). Skipped
 * steps don't block — they're considered resolved by the user.
 */
export function nextPendingStep(state: OnboardingState): OnboardingStep | null {
  if (state.completedAt) return null;
  for (const step of ONBOARDING_STEP_ORDER) {
    if (state[step] === 'pending') return step;
  }
  return null;
}

/**
 * Pure helper: percentage of the flow that has been resolved (answered or
 * skipped). 0 on a fresh profile, 100 when everything is decided. Used by
 * the Today banner ("4 of 5 steps done") and Settings Setup row.
 */
export function progressPercent(state: OnboardingState): number {
  const total = ONBOARDING_STEP_ORDER.length;
  let done = 0;
  for (const step of ONBOARDING_STEP_ORDER) {
    if (state[step] !== 'pending') done += 1;
  }
  return Math.round((done / total) * 100);
}

/**
 * Pure helper: is the entire flow complete? True when either completedAt is
 * set OR every step is non-pending. The completedAt path handles the explicit
 * "Done" tap on the preview screen (user may have skipped some steps but
 * declared themselves done).
 */
export function isComplete(state: OnboardingState): boolean {
  if (state.completedAt) return true;
  return ONBOARDING_STEP_ORDER.every(s => state[s] !== 'pending');
}

// ---------------------------------------------------------------------------
// DB-touching CRUD
// ---------------------------------------------------------------------------

export async function getOnboardingState(profileId: string): Promise<OnboardingState> {
  const res = await db.query<{ onboarding_state: unknown }>(
    `SELECT onboarding_state FROM profiles WHERE id = $1 LIMIT 1`,
    [profileId],
  );
  if (res.rows.length === 0) return { ...DEFAULT_STATE };
  return normaliseState(res.rows[0].onboarding_state);
}

export async function saveOnboardingState(
  profileId: string,
  state: OnboardingState,
): Promise<void> {
  await db.query(
    `UPDATE profiles SET onboarding_state = $1::jsonb WHERE id = $2`,
    [JSON.stringify(state), profileId],
  );
}

/**
 * Apply a single-step transition: marks the step `answered` (saving the
 * answer text) or `skipped`, and returns the resulting state. Never marks
 * completedAt automatically — that requires an explicit `markComplete` call.
 */
export async function recordStep(
  profileId: string,
  step: OnboardingStep,
  outcome: { status: 'answered'; answer: string } | { status: 'skipped' },
): Promise<OnboardingState> {
  const current = await getOnboardingState(profileId);
  const next: OnboardingState = {
    ...current,
    [step]: outcome.status,
    answers:
      outcome.status === 'answered'
        ? { ...current.answers, [step]: outcome.answer }
        : current.answers,
  };
  await saveOnboardingState(profileId, next);
  return next;
}

/**
 * Mark the flow complete. Called when the user taps "Done" on the preview
 * step OR when they explicitly skip the remainder from Settings. Records
 * the timestamp so analytics + the Today banner can dismiss themselves.
 */
export async function markComplete(profileId: string): Promise<OnboardingState> {
  const current = await getOnboardingState(profileId);
  const next: OnboardingState = {
    ...current,
    completedAt: new Date().toISOString(),
  };
  await saveOnboardingState(profileId, next);
  return next;
}
