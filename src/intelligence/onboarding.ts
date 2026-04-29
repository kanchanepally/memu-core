/**
 * Onboarding answer processor.
 *
 * The conversational onboarding flow asks the user three free-form
 * questions (people / rhythm / focus). Each answer arrives here and
 * gets turned into structured durable context — Spaces, entity registry
 * entries, and embedding-recall rows — so when the user finishes
 * onboarding, Memu's Day-0 Today screen has real content rather than
 * the platitudes the audit flagged.
 *
 * This is intentionally a different shape from the autolearn pipeline
 * (`src/intelligence/autolearn.ts`):
 *
 *   - Autolearn fires after every chat turn, fire-and-forget. It only
 *     APPENDS to existing Spaces — it never creates new ones.
 *   - Onboarding fires when the user explicitly seeds context. It needs
 *     to CREATE Spaces because the family is brand new and the catalogue
 *     starts empty.
 *
 * The two pipelines share primitives (Twin, novel-entity registration,
 * autolearn skill, seedContext, upsertSpace) but compose them
 * differently.
 *
 * Privacy invariant: the autolearn skill operates entirely in the
 * anonymous namespace. Real names enter the database only via the
 * persistence step (Space body, context_entries) — same boundary as
 * autolearn.
 */

import { dispatch } from '../skills/router';
import { translateToReal } from '../twin/translator';
import { detectAndRegisterNovelEntities } from '../twin/novel';
import { upsertSpace } from '../spaces/store';
import { getCatalogue } from '../spaces/catalogue';
import { seedContext } from './context';
import { parseAutolearnOutput, appendAutolearnLine, type AutolearnObservation } from './autolearn';
import type { SpaceCategory } from '../spaces/model';
import type { OnboardingStep } from '../onboarding/state';

// Each onboarding step has a "primary category" that drives Space
// creation. The autolearn skill may surface other categories within an
// answer (e.g., the people answer also mentions a school name as an
// 'institution'), and we still write those to context_entries — but the
// Space we create / update is keyed off the primary category.
const STEP_PRIMARY_CATEGORY: Record<Exclude<OnboardingStep, 'preview' | 'channels'>, SpaceCategory> = {
  people: 'person',
  rhythm: 'routine',
  focus: 'commitment',
};

// For non-person primary categories (rhythm, focus) we don't try to
// split observations into one-per-Space — autolearn returns text-level
// observations and there's no reliable way to know where one routine
// ends and the next begins. So we collect everything into a single
// canonical Space per step. The user can split / rename later.
const COLLECTIVE_SPACE_NAME: Record<'routine' | 'commitment', { name: string; slug: string; description: string }> = {
  routine: {
    name: 'Weekly rhythm',
    slug: 'weekly-rhythm',
    description: 'Your recurring weekly anchors — captured during onboarding.',
  },
  commitment: {
    name: 'Current focus',
    slug: 'current-focus',
    description: 'What was top of mind during onboarding. Adjust as life moves on.',
  },
};

// Confidence floor for writing anything during onboarding. Lower than
// autolearn's normal MIN_RECALL_CONFIDENCE (0.5) — onboarding answers
// are the user explicitly seeding context, so we trust them more than
// observations extracted from chat turns. Anything genuinely vague the
// skill can still mark below 0.4 and we'll skip.
const MIN_ONBOARDING_CONFIDENCE = 0.4;

export interface OnboardingProcessResult {
  observationCount: number;
  /** Real names extracted (Rach, Robin) — used by the ack template. */
  learnedNames: string[];
  /** Spaces created or appended during processing. */
  spacesAffected: { uri: string; name: string; category: SpaceCategory; created: boolean }[];
  /** Number of context_entries written for embedding recall. */
  recallWrites: number;
}

/**
 * Process a single onboarding answer end-to-end. Synchronous-ish — the
 * caller awaits this so the UI can show the structured acknowledgement.
 * Total latency: 1 LLM call (autolearn skill) + 1 novel-entity-detection
 * call + a handful of DB writes. Typical 3–8 seconds on Haiku.
 */
export async function processOnboardingAnswer(
  profileId: string,
  step: Exclude<OnboardingStep, 'preview' | 'channels'>,
  answer: string,
): Promise<OnboardingProcessResult> {
  // Family-id == profile-id under the current single-family convention.
  const familyId = profileId;

  // 1. Detect novel entities first so the registry has Rach / Robin
  //    before autolearn translates the prompt to anonymous tokens.
  await detectAndRegisterNovelEntities(answer);

  // 2. Run autolearn for structured observations. We synthesise an
  //    "assistant response" so the skill prompt isn't malformed —
  //    autolearn was designed to extract from a USER+ASSISTANT exchange,
  //    not a single turn.
  const syntheticAssistantTurn = `[Onboarding ${step} step]`;
  let replyText = '';
  try {
    const result = await dispatch({
      skill: 'autolearn',
      userMessage: `USER: ${answer}\n\nASSISTANT: ${syntheticAssistantTurn}`,
      profileId,
      familyId,
      maxTokens: 800,
      temperature: 0,
    });
    replyText = result.text;
  } catch (err) {
    console.error('[ONBOARDING] autolearn dispatch failed:', err);
    return { observationCount: 0, learnedNames: [], spacesAffected: [], recallWrites: 0 };
  }

  const observations = parseAutolearnOutput(replyText)
    .filter(o => o.confidence >= MIN_ONBOARDING_CONFIDENCE);

  if (observations.length === 0) {
    // Honest empty result. Don't fabricate a Space from nothing.
    return { observationCount: 0, learnedNames: [], spacesAffected: [], recallWrites: 0 };
  }

  // 3. Write to context_entries (embedding recall surface). Same as
  //    autolearn — every observation above the floor lands here even
  //    if it doesn't end up in a Space.
  let recallWrites = 0;
  for (const obs of observations) {
    try {
      const realText = await translateToReal(obs.text);
      if (realText.trim().length > 0) {
        await seedContext(realText.trim(), 'manual', profileId, 'family');
        recallWrites += 1;
      }
    } catch (err) {
      console.error('[ONBOARDING] seedContext failed:', err);
    }
  }

  // 4. Create / update Spaces for the step's primary category.
  const primaryCategory = STEP_PRIMARY_CATEGORY[step];
  const spacesAffected = await writeSpacesForStep(familyId, profileId, primaryCategory, observations);

  // 5. Build the names list for the acknowledgement template. Only
  //    person-category observations contribute names; routine/commitment
  //    observations don't have a "name" worth surfacing in the ack.
  const learnedNames = await collectLearnedNames(observations);

  console.log(
    `[ONBOARDING] ${step} → ${observations.length} obs, ${recallWrites} recall, ${spacesAffected.length} Space op(s)`,
  );

  return {
    observationCount: observations.length,
    learnedNames,
    spacesAffected,
    recallWrites,
  };
}

// ---------------------------------------------------------------------------
// Space creation — the new behaviour
// ---------------------------------------------------------------------------

async function writeSpacesForStep(
  familyId: string,
  actorProfileId: string,
  primaryCategory: SpaceCategory,
  observations: AutolearnObservation[],
): Promise<{ uri: string; name: string; category: SpaceCategory; created: boolean }[]> {
  if (primaryCategory === 'person') {
    return writePersonSpaces(familyId, actorProfileId, observations);
  }
  if (primaryCategory === 'routine' || primaryCategory === 'commitment') {
    return writeCollectiveSpace(familyId, actorProfileId, primaryCategory, observations);
  }
  return [];
}

/**
 * Person Spaces are 1-per-subject. Group observations by their (real-name)
 * subject, write one Space per group with all observations as bullets in
 * the body. If a Space with that slug already exists (rare during
 * onboarding but possible if the user re-runs the people step), append
 * rather than overwrite.
 */
async function writePersonSpaces(
  familyId: string,
  actorProfileId: string,
  observations: AutolearnObservation[],
): Promise<{ uri: string; name: string; category: SpaceCategory; created: boolean }[]> {
  // Filter to person-category observations with a resolvable subject.
  // Routine / commitment / household observations don't get person Spaces
  // even if they appear within the people answer.
  const personObs: { realName: string; obs: AutolearnObservation }[] = [];
  for (const obs of observations) {
    if (obs.category !== 'person') continue;
    if (!obs.subject) continue;
    const realName = (await translateToReal(obs.subject)).trim();
    // Skip entities whose anonymous label survived translation — they
    // weren't registered, so we can't credibly create a Space for them.
    if (/^(?:adult|child|person|place|institution|detail)-\d+$/i.test(realName)) continue;
    if (realName.length === 0) continue;
    personObs.push({ realName, obs });
  }

  // Group by real name (case-insensitive).
  const grouped = new Map<string, { displayName: string; observations: AutolearnObservation[] }>();
  for (const { realName, obs } of personObs) {
    const key = realName.toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.observations.push(obs);
    } else {
      grouped.set(key, { displayName: realName, observations: [obs] });
    }
  }

  if (grouped.size === 0) return [];

  // Look up the catalogue once so we can check whether each Space exists.
  const catalogue = await getCatalogue(familyId, actorProfileId);

  const result: { uri: string; name: string; category: SpaceCategory; created: boolean }[] = [];
  const dateStr = new Date().toISOString().slice(0, 10);

  for (const { displayName, observations: theirObs } of grouped.values()) {
    const slug = slugifyName(displayName);
    const existing = catalogue.find(e => e.category === 'person' && e.slug === slug);

    // Build the body — onboarding-flavoured intro + dated bullets for
    // each observation. The intro line makes the Space feel intentional
    // ("written for Rach") rather than auto-generated.
    const bullets: string[] = [];
    for (const obs of theirObs) {
      const realText = (await translateToReal(obs.text)).trim();
      if (realText.length === 0) continue;
      bullets.push(`- ${dateStr}: ${realText}`);
    }

    const intro = existing
      ? '' // appending — don't duplicate the intro
      : `# ${displayName}\n\n_Created during onboarding — what you told me about ${displayName}._\n\n## Notes\n`;
    const newBody = (existing?.lastUpdated ? '' : intro) + bullets.join('\n');

    let mergedBody = newBody;
    if (existing) {
      // Use the loader to fetch the existing body — the catalogue entry
      // doesn't carry it. Tightly bounded scope: existing onboarding
      // re-run would only re-write a single Space.
      const { findSpaceByUri } = await import('../spaces/store');
      const full = await findSpaceByUri(existing.uri);
      if (full) {
        mergedBody = appendAutolearnLine(full.bodyMarkdown, bullets.join('\n'));
      }
    }

    try {
      const space = await upsertSpace({
        familyId,
        category: 'person',
        slug,
        name: displayName,
        bodyMarkdown: mergedBody,
        description: `Person Space for ${displayName}.`,
        people: [],
        visibility: 'family',
        confidence: 0.7,
        sourceReferences: [`onboarding:people:${dateStr}`],
        tags: ['onboarding'],
        actorProfileId,
      });
      result.push({
        uri: space.uri,
        name: space.name,
        category: 'person',
        created: !existing,
      });
    } catch (err) {
      console.error('[ONBOARDING] person Space upsert failed:', err);
    }
  }

  return result;
}

/**
 * Routine + commitment Spaces are 1-per-step (collective): all
 * observations land as bullets in a single canonical Space. The user
 * can split / rename later from the Spaces tab.
 */
async function writeCollectiveSpace(
  familyId: string,
  actorProfileId: string,
  category: 'routine' | 'commitment',
  observations: AutolearnObservation[],
): Promise<{ uri: string; name: string; category: SpaceCategory; created: boolean }[]> {
  const meta = COLLECTIVE_SPACE_NAME[category];
  const dateStr = new Date().toISOString().slice(0, 10);

  // Filter to observations relevant to this category. We allow some
  // category-bleed — a focus answer might surface household observations
  // — but for the collective Space we want only the canonical ones.
  const relevant = observations.filter(o => o.category === category);
  if (relevant.length === 0) return [];

  const bullets: string[] = [];
  for (const obs of relevant) {
    const realText = (await translateToReal(obs.text)).trim();
    if (realText.length === 0) continue;
    bullets.push(`- ${dateStr}: ${realText}`);
  }
  if (bullets.length === 0) return [];

  // Check whether the canonical Space already exists. If yes, append.
  const catalogue = await getCatalogue(familyId, actorProfileId);
  const existing = catalogue.find(e => e.category === category && e.slug === meta.slug);

  let mergedBody: string;
  if (existing) {
    const { findSpaceByUri } = await import('../spaces/store');
    const full = await findSpaceByUri(existing.uri);
    mergedBody = full ? appendAutolearnLine(full.bodyMarkdown, bullets.join('\n')) : bullets.join('\n');
  } else {
    const intro = `# ${meta.name}\n\n_${meta.description}_\n\n## Items\n`;
    mergedBody = intro + bullets.join('\n');
  }

  try {
    const space = await upsertSpace({
      familyId,
      category,
      slug: meta.slug,
      name: meta.name,
      bodyMarkdown: mergedBody,
      description: meta.description,
      visibility: 'family',
      confidence: 0.7,
      sourceReferences: [`onboarding:${category}:${dateStr}`],
      tags: ['onboarding'],
      actorProfileId,
    });
    return [{ uri: space.uri, name: space.name, category, created: !existing }];
  } catch (err) {
    console.error(`[ONBOARDING] ${category} Space upsert failed:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Local slugifier — kept separate from `slugify` in spaces/model so the
 * onboarding behaviour can diverge if needed (e.g., later we might want
 * to lowercase + collapse "Rach Smith" → "rach" rather than "rach-smith"
 * for the ergonomic person-Space slug).
 */
function slugifyName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'unnamed';
}

/**
 * Resolve unique real names from the person-category observations.
 * Used by the acknowledgement template — "Got it — I'll remember
 * Rach and Robin." Order-preserving so the ack feels natural rather
 * than alphabetised.
 */
async function collectLearnedNames(observations: AutolearnObservation[]): Promise<string[]> {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const obs of observations) {
    if (obs.category !== 'person') continue;
    if (!obs.subject) continue;
    const realName = (await translateToReal(obs.subject)).trim();
    if (/^(?:adult|child|person|place|institution|detail)-\d+$/i.test(realName)) continue;
    if (realName.length === 0) continue;
    const key = realName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(realName);
  }
  return names;
}
