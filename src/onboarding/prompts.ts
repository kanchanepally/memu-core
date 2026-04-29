/**
 * Onboarding prompt generator. Pure helpers — given the accumulated
 * answers from prior steps, produce the next step's UI strings.
 *
 * The prompts are intentionally written from Memu's voice (warm, brief,
 * direct — no marketing fluff, no "Welcome to your AI journey!"). They
 * read as if Memu is a person talking, because the conversational
 * onboarding is the user's first impression of how Memu addresses them
 * for every chat turn after this.
 *
 * Personalisation is shape-driven: we don't try to parse out specific
 * names (the entity registry handles that downstream). We just look at
 * the rough shape of the previous answer to choose a register —
 * solo / couple / household-with-children / household-without-children.
 */

import type { OnboardingState, OnboardingStep } from './state';

export interface StepCopy {
  /** The Memu chat-bubble prompt at the top of the step screen. */
  prompt: string;
  /** Placeholder text inside the free-form input. Concrete examples build
   *  trust by showing the kind of answer Memu can use. */
  placeholder: string;
  /** One-line helper under the input — the "why we're asking". Privacy +
   *  outcome framing. The audit's Day-0 finding said every step should
   *  pay rent; the helper text is where it's earned. */
  helper: string;
  /** Skip-button label. Defaults to "Skip" but can be tuned per step
   *  ("Just me, skip" reads better on the people step than a bare "Skip"). */
  skipLabel: string;
}

/**
 * Quick shape detection on the people answer. We don't need a full NLP
 * parse — autolearn handles entity extraction downstream. Here we just
 * decide which register to use for the rhythm + focus prompts.
 */
type Register = 'solo' | 'couple' | 'children' | 'household';

export function detectRegister(peopleAnswer: string | undefined): Register {
  if (!peopleAnswer) return 'household';
  const t = peopleAnswer.toLowerCase();

  // Solo cues — "just me", "only me", "alone", "myself".
  if (/\b(just\s+me|only\s+me|just\s+myself|alone|on\s+my\s+own|solo)\b/.test(t)) {
    return 'solo';
  }

  // Children cues — explicit terms or age numbers like "7yo", "5 yr",
  // "10-year-old". A bare number doesn't trigger; we want a clear signal.
  if (
    /\b(kid|kids|child|children|son|daughter|baby|toddler|teenager|teen)\b/.test(t)
    || /\b(\d{1,2})\s*(yo|y\.o\.|yr|year)/.test(t)
    || /\b(\d{1,2})[-\s]year[-\s]old/.test(t)
  ) {
    return 'children';
  }

  // Couple cues — partner / wife / husband / spouse but no children term.
  if (/\b(wife|husband|partner|spouse|fianc[eé]e?|girlfriend|boyfriend)\b/.test(t)) {
    return 'couple';
  }

  return 'household';
}

/**
 * Heuristic: does the people answer suggest the user has a job-shaped
 * professional life? Used to tune the focus step's example placeholder
 * away from purely-domestic anchors. Conservative — defaults to false.
 */
function suggestsWorkLife(peopleAnswer: string | undefined): boolean {
  if (!peopleAnswer) return false;
  return /\b(work|colleague|boss|manager|client|customer|team|company|founder|startup|consult|freelance)\b/i.test(peopleAnswer);
}

// ---------------------------------------------------------------------------
// Per-step copy generators
// ---------------------------------------------------------------------------

function peopleCopy(): StepCopy {
  return {
    prompt:
      "Hi. I'm Memu — your private chief of staff. " +
      "Before anything else, who are the people who matter most to your day?",
    placeholder:
      "e.g. Rach (wife), Robin (7yo) — or 'Just me' if it's only you.",
    helper:
      "First names are enough. I'll keep them on your hardware and never send your real names to any cloud AI.",
    skipLabel: 'Skip — start blank',
  };
}

function rhythmCopy(register: Register): StepCopy {
  if (register === 'solo') {
    return {
      prompt:
        "What's the shape of your week? The recurring things — work blocks, " +
        "exercise, regular calls, anything that anchors your routine.",
      placeholder:
        "e.g. Standup Mon/Wed/Fri 9am, gym Tue/Thu evenings, Sunday roast at Mum's.",
      helper:
        "These become routine Spaces. When the week shifts, I'll notice — and tell you.",
      skipLabel: 'Skip — no fixed rhythm',
    };
  }

  if (register === 'children') {
    return {
      prompt:
        "What's the rhythm of your household? School runs, kids' clubs, " +
        "regular family time, anything that tends to repeat.",
      placeholder:
        "e.g. School run M-F 8:30am, Robin's swimming Tue 5pm, Friday family dinner.",
      helper:
        "These become routine Spaces. The morning briefing draws on them when something is about to happen.",
      skipLabel: 'Skip — week varies a lot',
    };
  }

  if (register === 'couple') {
    return {
      prompt:
        "What's the shape of your week together? The recurring anchors — " +
        "shared meals, exercise, weekly calls home, that kind of thing.",
      placeholder:
        "e.g. Saturday morning yoga together, Sunday call to my parents, Friday date night.",
      helper:
        "These become routine Spaces I can reference when something might clash.",
      skipLabel: 'Skip — varies week to week',
    };
  }

  // household (default)
  return {
    prompt:
      "What does a typical week look like for your household? The recurring things " +
      "that anchor most weeks.",
    placeholder:
      "e.g. School run M-F 8:30am, Tuesday food shop, weekend coffee with the neighbours.",
    helper:
      "These become routine Spaces. I'll surface them in your morning briefing when relevant.",
    skipLabel: 'Skip — too varied to capture',
  };
}

function focusCopy(register: Register, hasWork: boolean): StepCopy {
  // Concrete examples are paired to the user's earlier answer so the
  // prompt feels like Memu is paying attention — not a generic form.
  let placeholder: string;
  if (register === 'solo' && hasWork) {
    placeholder = "e.g. Q2 board prep, get the boiler service booked, gym back to 4× a week.";
  } else if (register === 'solo') {
    placeholder = "e.g. Find a new flat, finish the dissertation chapter, mum's birthday dinner.";
  } else if (register === 'children' && hasWork) {
    placeholder = "e.g. Q2 board prep, Robin's parent-teacher Tuesday, the boiler service.";
  } else if (register === 'children') {
    placeholder = "e.g. Robin's parent-teacher Tuesday, half-term plans, the boiler service.";
  } else if (register === 'couple') {
    placeholder = "e.g. Edinburgh trip in May, finalise mortgage paperwork, Mum's 70th.";
  } else {
    placeholder = "e.g. Mortgage renewal mid-May, summer holiday booking, garden extension quote.";
  }

  return {
    prompt:
      "What's on your plate right now? Big things, small things — anything you " +
      "don't want to forget.",
    placeholder,
    helper:
      "These become commitment Spaces and stream cards. Time-sensitive ones land on your Today tab.",
    skipLabel: 'Skip — nothing top of mind',
  };
}

function previewCopy(): StepCopy {
  return {
    prompt: "I've got the shape of your life now. Want me to brief you on it?",
    placeholder: '',
    helper:
      "I'll send a daily push at the time you choose. You can change anything I've " +
      "remembered by just chatting with me.",
    skipLabel: 'Skip notifications for now',
  };
}

function channelsCopy(): StepCopy {
  return {
    prompt:
      "Last thing — want to plug in your Google Calendar? Optional, but it makes " +
      "the morning briefing a lot more useful.",
    placeholder: '',
    helper:
      "The OAuth happens in your browser. Memu only sees the events on the calendar " +
      "you connect — and only this device.",
    skipLabel: 'Skip — connect later',
  };
}

// ---------------------------------------------------------------------------
// Top-level — choose copy based on accumulated state
// ---------------------------------------------------------------------------

export function copyForStep(step: OnboardingStep, state: OnboardingState): StepCopy {
  const peopleAnswer = state.answers.people;
  const register = detectRegister(peopleAnswer);
  const hasWork = suggestsWorkLife(peopleAnswer);

  switch (step) {
    case 'people':   return peopleCopy();
    case 'rhythm':   return rhythmCopy(register);
    case 'focus':    return focusCopy(register, hasWork);
    case 'preview':  return previewCopy();
    case 'channels': return channelsCopy();
  }
}

// ---------------------------------------------------------------------------
// Acknowledgement templates
// ---------------------------------------------------------------------------

/**
 * Build the warm 1-line acknowledgement that follows a successful answer.
 * Uses the autolearn output's structured observations to be specific
 * ("Got it — Rach and Robin are saved.") rather than generic ("Got it!").
 *
 * `learnedNames` is the deduped list of real names extracted from the
 * answer. `learnedKinds` tells us what category dominated. We pick a
 * template that matches — e.g. "Got it — 4 routines saved." for the
 * rhythm step when no person names appear.
 */
export interface AckInput {
  step: OnboardingStep;
  /** Real names of entities the answer introduced (Rach, Robin). May be empty. */
  learnedNames: string[];
  /** Total number of structured observations autolearn extracted. May be 0. */
  observationCount: number;
}

export function buildAcknowledgement(input: AckInput): string {
  const { step, learnedNames, observationCount } = input;

  // Fallback: nothing structured was learned. Honest and brief — better
  // than a fake "Great, got it!" that hides the empty result.
  if (observationCount === 0 && learnedNames.length === 0) {
    if (step === 'people') return "Noted. We can come back to this later.";
    if (step === 'rhythm') return "Noted. I'll learn the rhythm as the weeks land.";
    if (step === 'focus') return "Noted. Tell me anytime something comes up.";
    return "Noted.";
  }

  // People step: the names matter most.
  if (step === 'people' && learnedNames.length > 0) {
    if (learnedNames.length === 1) return `Got it — I'll remember ${learnedNames[0]}.`;
    if (learnedNames.length === 2) return `Got it — I'll remember ${learnedNames[0]} and ${learnedNames[1]}.`;
    const last = learnedNames[learnedNames.length - 1];
    const head = learnedNames.slice(0, -1).join(', ');
    return `Got it — I'll remember ${head}, and ${last}.`;
  }

  // Rhythm + Focus: count of items is more useful than name list, since
  // the items are routines / commitments rather than people.
  if (step === 'rhythm') {
    return observationCount === 1
      ? `Got it — one routine saved. I'll factor it into your briefings.`
      : `Got it — ${observationCount} routines saved. I'll factor them into your briefings.`;
  }
  if (step === 'focus') {
    return observationCount === 1
      ? `Got it — one item on your radar. It'll appear on your Today tab if it's time-sensitive.`
      : `Got it — ${observationCount} items on your radar. The time-sensitive ones will land on Today.`;
  }

  return `Got it — saved.`;
}
