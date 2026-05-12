/**
 * Daytime capture nudges (Fix 5 — 2026-05-12).
 *
 * The agency loop: Memu can only be useful if the user tells it things,
 * and the user only tells it things if Memu shows up at the right moments
 * with the right invitation. Two cron slots (11am + 4pm Europe/London)
 * each pick ONE rotating prompt per profile and push it to the phone with
 * a deep-link to the /capture/quick screen.
 *
 * Prompts rotate by (day of week × slot) so a profile sees a 7-day cycle
 * with two prompts per day. No repetition within a day.
 *
 * MVP scope: a fixed catalogue of evergreen prompts. Smart selection based
 * on actual gaps in autolearn observations (the "Robin → play-school
 * Thursday evenings" case from the spec) lands in Fix 5.2 — needs a query
 * over recent context_entries / synthesis_pages with confidence < 0.7 and
 * a category in {commitment, routine}. For tonight: get the surface
 * working with rotation, validate the loop end-to-end with Hareesh, then
 * upgrade the selector.
 */

export interface NudgePrompt {
  id: string;
  /** The notification body. Short — lock-screen truncates ~80 chars. */
  notification: string;
  /** The full question rendered on the capture screen. */
  question: string;
  /** Helper hint shown below the input on /capture/quick. */
  hint: string;
}

const PROMPT_CATALOGUE: NudgePrompt[] = [
  {
    id: 'kids-week-update',
    notification: 'Anything new with the kids this week?',
    question: 'Anything new about the kids that I should remember?',
    hint: 'Activities, schedule changes, friends, anything you want me to hold onto.',
  },
  {
    id: 'partner-check-in',
    notification: 'Anything happening with your partner I should know?',
    question: 'Anything about your partner I should pin down?',
    hint: 'Plans, commitments, things you discussed. I\'ll route it to the right Space.',
  },
  {
    id: 'today-residue',
    notification: 'Quick capture — anything you don\'t want to forget today?',
    question: 'What from today is worth holding onto?',
    hint: 'A decision, something someone said, a thing you want to come back to.',
  },
  {
    id: 'looming-thing',
    notification: 'Anything coming up that\'s been on your mind?',
    question: 'Is there a commitment or appointment coming up that I should know about?',
    hint: 'I\'ll put it on the calendar and remind you when it matters.',
  },
  {
    id: 'routine-check',
    notification: 'Any new rhythm I should track?',
    question: 'A new routine or rhythm I should know about?',
    hint: 'Weekly things, repeating events, "every Thursday" kind of patterns.',
  },
  {
    id: 'health-check',
    notification: 'How are you doing today?',
    question: 'How are you doing — anything on your mind?',
    hint: 'Just a note, no need to be tidy. I\'ll pick up patterns over time.',
  },
  {
    id: 'people-update',
    notification: 'Met or heard from anyone worth remembering?',
    question: 'Anyone you met or heard from today I should remember?',
    hint: 'A name, where you met them, why they matter. I\'ll start a Person Space.',
  },
  {
    id: 'house-and-things',
    notification: 'Anything about the house or admin I should note?',
    question: 'Anything about the house, bills, or admin worth pinning?',
    hint: 'Maintenance, dates, contacts — I\'ll route them into a household Space.',
  },
];

/**
 * Pick the prompt for a given profile + datetime. Deterministic per
 * (profile, dayOfWeek, slot) so a brief profile re-rolled within the
 * same slot doesn't see a different prompt. Hour 11 = morning slot,
 * Hour 16 = afternoon slot; other hours fall back to whichever is closer.
 *
 * Two prompts per day: morning slot starts at index 0 + dayOfYear*2,
 * afternoon at index 1 + dayOfYear*2. Modulo catalogue length wraps
 * cleanly.
 */
export function pickPrompt(profileId: string, when: Date = new Date()): NudgePrompt {
  const slotIndex = when.getHours() < 14 ? 0 : 1;
  // Deterministic per (profileId hash + day-of-year + slot) so the same
  // profile gets the same prompt if the cron fires twice in a slot, but
  // two profiles see different prompts. This avoids "everyone got the
  // same nudge at 11am."
  const profileSalt = hashCode(profileId);
  const dayOfYear = Math.floor(
    (when.getTime() - new Date(when.getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const idx = ((dayOfYear * 2 + slotIndex + profileSalt) % PROMPT_CATALOGUE.length + PROMPT_CATALOGUE.length) % PROMPT_CATALOGUE.length;
  return PROMPT_CATALOGUE[idx];
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getPromptById(id: string): NudgePrompt | null {
  return PROMPT_CATALOGUE.find(p => p.id === id) || null;
}

export function listPromptCatalogue(): NudgePrompt[] {
  return PROMPT_CATALOGUE.slice();
}
