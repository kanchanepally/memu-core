/**
 * Autolearn — Tier 1 pre-beta skill #2 (2026-04-26 upgrade).
 *
 * Runs fire-and-forget after every chat turn. Extracts durable
 * observations about the person and household, then writes them to
 * BOTH:
 *
 *   1. The matching person/household/commitment/routine Space, when
 *      one exists in the family's catalogue (high-confidence
 *      observations only — durable signal worth compiling).
 *   2. `context_entries` via seedContext (every observation above the
 *      recall threshold — preserves embedding-based fallback for
 *      anything that didn't land in a Space).
 *
 * The Space-write path uses a simple line-append (NOT the heavier
 * `mergeSpaceBody` separator from the synthesis-overwrite fix) — this
 * pipeline can fire many times per day, so accumulated bullets at the
 * bottom of a Space are the right shape; horizontal-rule separators
 * would visually balloon every Space inside a week.
 *
 * Privacy invariant: the skill operates entirely in the anonymous
 * namespace (subject is "Adult-1", "Child-2", etc.). Translation to
 * real names happens only at the persistence boundary — `translateToReal`
 * before the Space body update or seedContext write.
 */

import { seedContext, type Visibility } from './context';
import { dispatch } from '../skills/router';
import { getCatalogue, type CatalogueEntry } from '../spaces/catalogue';
import { findSpaceByUri, upsertSpace } from '../spaces/store';
import { translateToReal } from '../twin/translator';
import { SPACE_CATEGORIES, type SpaceCategory } from '../spaces/model';

// Confidence thresholds:
// - Below MIN_RECALL_CONFIDENCE: skip entirely (skill returned it but
//   marked it speculative).
// - At or above MIN_RECALL_CONFIDENCE: write to context_entries (the
//   embedding recall surface).
// - At or above MIN_SPACE_WRITE_CONFIDENCE AND a matching Space exists:
//   ALSO append to that Space's body.
const MIN_RECALL_CONFIDENCE = 0.5;
const MIN_SPACE_WRITE_CONFIDENCE = 0.7;

export interface AutolearnObservation {
  text: string;
  subject: string | null;
  category: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing
// ---------------------------------------------------------------------------

/**
 * Append a single autolearn line to an existing Space body.
 *
 * Different from `mergeSpaceBody` (used by `updateSpace` tool):
 *   - `mergeSpaceBody` inserts a horizontal-rule + dated separator before
 *     each addition. Right shape for explicit user-driven updates.
 *   - `appendAutolearnLine` just adds one line. Right shape for the
 *     many silent fire-and-forget writes autolearn produces.
 *
 * Trims trailing whitespace from existing so successive appends don't
 * accumulate blank lines. Empty existing body returns the line verbatim.
 */
export function appendAutolearnLine(existing: string, newLine: string): string {
  const trimmed = existing.replace(/\s+$/g, '');
  if (trimmed.length === 0) return newLine;
  return `${trimmed}\n${newLine}`;
}

/**
 * Parse the skill reply into a normalised array of observations.
 *
 * Handles two shapes:
 *   - v2 (current): `{"observations": [{text, subject, category, confidence}, ...]}`
 *   - v1 (legacy):  `["fact one", "fact two"]` — flat array of strings.
 *     Inferred shape: subject=null, category="other", confidence=0.7.
 *
 * Returns [] on malformed JSON, missing fields, or the no-observations
 * case (`{"observations": []}` is valid and returns []).
 */
export function parseAutolearnOutput(replyText: string): AutolearnObservation[] {
  // Try the v2 object shape first.
  const objMatch = replyText.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed && Array.isArray(parsed.observations)) {
        const out: AutolearnObservation[] = [];
        for (const raw of parsed.observations) {
          if (!raw || typeof raw !== 'object') continue;
          if (typeof raw.text !== 'string' || raw.text.trim().length < 5) continue;
          if (typeof raw.confidence !== 'number') continue;
          out.push({
            text: raw.text.trim(),
            subject: typeof raw.subject === 'string' && raw.subject.trim().length > 0
              ? raw.subject.trim()
              : null,
            category: typeof raw.category === 'string' ? raw.category : 'other',
            confidence: Math.max(0, Math.min(1, raw.confidence)),
          });
        }
        return out;
      }
    } catch {
      // Fall through to legacy shape.
    }
  }

  // Legacy: flat array of strings.
  const arrMatch = replyText.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 5)
          .map(s => ({
            text: s.trim(),
            subject: null,
            category: 'other',
            confidence: 0.7, // assume durable enough to recall, not Space-write
          }));
      }
    } catch {
      // Malformed — return empty.
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Routing — private, DB-touching
// ---------------------------------------------------------------------------

/**
 * Try to find a Space in the family catalogue that matches an
 * observation's subject + category. Returns null when no Space matches
 * (caller falls back to seedContext-only persistence).
 *
 * Subject matching: translates the anonymous subject (e.g. "Child-1")
 * to the real name via the Twin, lowercases, then does case-insensitive
 * substring match against the candidate Space's name and slug.
 *
 * Category gating: the observation's category must match the Space's
 * category. Prevents a "Child-1 prefers pasta" person observation from
 * landing on a household Space that happens to mention Child-1.
 */
async function tryRouteToSpace(
  familyId: string,
  obs: AutolearnObservation,
): Promise<CatalogueEntry | null> {
  if (!obs.subject) return null;
  if (!SPACE_CATEGORIES.includes(obs.category as SpaceCategory)) return null;

  const realSubject = (await translateToReal(obs.subject)).trim().toLowerCase();
  if (realSubject.length === 0) return null;
  // If translateToReal returned the anonymous label verbatim (no entry
  // in the registry), there's no Space to route to. Skip.
  if (/^(?:adult|child|person|place|institution|detail)-\d+$/i.test(realSubject)) {
    return null;
  }

  const catalogue = await getCatalogue(familyId, familyId);
  for (const entry of catalogue) {
    if (entry.category !== obs.category) continue;
    const haystack = [entry.name, entry.slug].join(' ').toLowerCase();
    if (haystack.includes(realSubject)) return entry;
  }
  return null;
}

/**
 * Append an observation to an existing Space's body and re-upsert.
 * Returns true on success, false on any failure (caller logs but
 * doesn't crash the pipeline — autolearn is fire-and-forget).
 */
async function appendObservationToSpace(
  familyId: string,
  entry: CatalogueEntry,
  obs: AutolearnObservation,
): Promise<boolean> {
  try {
    const space = await findSpaceByUri(entry.uri);
    if (!space || space.familyId !== familyId) return false;

    const realText = await translateToReal(obs.text);
    if (realText.trim().length === 0) return false;

    const dateStr = new Date().toISOString().slice(0, 10);
    const confLabel = obs.confidence < 0.85 ? '_(observation)_ ' : '';
    const newLine = `- ${dateStr}: ${confLabel}${realText.trim()}`;

    const mergedBody = appendAutolearnLine(space.bodyMarkdown, newLine);

    await upsertSpace({
      familyId: space.familyId,
      category: space.category,
      slug: space.slug,
      name: space.name,
      bodyMarkdown: mergedBody,
      description: space.description,
      domains: space.domains,
      people: space.people,
      visibility: space.visibility,
      // Confidence creeps up a tick with each observation that lands.
      // Cap at 1.
      confidence: Math.min(1, space.confidence + 0.02),
      sourceReferences: [...space.sourceReferences, `autolearn:${dateStr}`],
      tags: space.tags,
      // No actorProfileId — autolearn is system-driven, not user-driven.
      // The Space's git commit will fall back to "Memu <memu@localhost>".
    });
    return true;
  } catch (err) {
    console.error('[AUTO-LEARN] Space append failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Top-level pipeline — called from orchestrator post-turn
// ---------------------------------------------------------------------------

export async function extractAndStoreFacts(
  profileId: string,
  userMessage: string,
  assistantResponse: string,
  visibility: Visibility = 'family',
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
    return;
  }

  let replyText: string;
  try {
    const result = await dispatch({
      skill: 'autolearn',
      userMessage: `USER: ${userMessage}\n\nASSISTANT: ${assistantResponse}`,
      profileId,
      maxTokens: 800,
      temperature: 0,
      useBYOK: true,
    });
    replyText = result.text;
  } catch (err) {
    console.error('[AUTO-LEARN] Skill dispatch failed:', err);
    return;
  }

  const observations = parseAutolearnOutput(replyText);
  if (observations.length === 0) return;

  let spaceWrites = 0;
  let recallWrites = 0;

  for (const obs of observations) {
    if (obs.confidence < MIN_RECALL_CONFIDENCE) continue;

    // Always preserve recall — the embedding store is the safety net
    // when a Space match doesn't exist OR isn't found.
    try {
      const realText = await translateToReal(obs.text);
      if (realText.trim().length > 0) {
        await seedContext(realText.trim(), 'manual', profileId, visibility);
        recallWrites += 1;
      }
    } catch (err) {
      console.error('[AUTO-LEARN] seedContext failed:', err);
    }

    // High-confidence observations also try to land on a matching Space.
    // Family-id == profile-id under the current single-family convention
    // (replaced when proper families table lands).
    if (obs.confidence >= MIN_SPACE_WRITE_CONFIDENCE) {
      const target = await tryRouteToSpace(profileId, obs);
      if (target && await appendObservationToSpace(profileId, target, obs)) {
        spaceWrites += 1;
      }
    }
  }

  console.log(
    `[AUTO-LEARN] ${observations.length} obs → ${recallWrites} recall, ${spaceWrites} Space append(s)`,
  );
}
