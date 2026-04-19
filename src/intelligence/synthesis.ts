/**
 * Story 2.1 — synthesis page compilation.
 * Story 2.3 — care-standard completion detection.
 *
 * After every chat turn we ask the LLM whether any durable understanding
 * should be compiled into a Space (or an existing Space updated), AND
 * whether any enabled care standard was just completed. If yes to either,
 * the Space lands through the Spaces store and completions advance
 * care_standards.last_completed / next_due via markCompleted().
 */

import { pool } from '../db/connection';
import { dispatch } from '../skills/router';
import { upsertSpace } from '../spaces/store';
import { SPACE_CATEGORIES, type SpaceCategory, type SpaceDomain } from '../spaces/model';
import { runPerMessageReflection } from '../reflection/reflection';
import { listStandards, markCompleted } from '../care/standards';
import { translateToReal } from '../twin/translator';

export const SYNTHESIS_CATEGORIES = [...SPACE_CATEGORIES];

interface SynthesisUpdate {
  category?: SpaceCategory;
  title?: string;
  markdown_body?: string;
  description?: string;
  domains?: SpaceDomain[];
  people?: string[];
  visibility?: string | string[];
  confidence?: number;
  tags?: string[];
  completed_standards?: Array<{ id: string; completed_at?: string }>;
}

function renderEnabledStandards(rows: Array<{ id: string; description: string; domain: string }>): string {
  if (rows.length === 0) return '(none)';
  return rows.map(r => `- ${r.id} — [${r.domain}] ${r.description}`).join('\n');
}

export async function processSynthesisUpdate(
  profileId: string,
  anonymousMsg: string,
  aiResponse: string,
) {
  const [pagesRes, standards] = await Promise.all([
    pool.query(
      `SELECT category, title, body_markdown
         FROM synthesis_pages
        WHERE family_id = $1 OR profile_id = $1`,
      [profileId],
    ),
    listStandards(profileId, true),
  ]);

  const existingStr =
    pagesRes.rows
      .map(r => `Category: ${r.category}\nTitle: ${r.title}\nCurrent Body:\n${r.body_markdown}\n---`)
      .join('\n\n') || 'No existing pages.';

  const enabledStandardsStr = renderEnabledStandards(
    standards.map(s => ({ id: s.id, description: s.description, domain: s.domain })),
  );

  const { text: llmResult } = await dispatch({
    skill: 'synthesis_update',
    templateVars: {
      existing_pages: existingStr,
      enabled_standards: enabledStandardsStr,
      user_message: anonymousMsg,
      ai_response: aiResponse,
      now_iso: new Date().toISOString(),
    },
    profileId,
  });

  if (llmResult.trim() === 'NONE' || llmResult.trim().startsWith('NONE')) return;

  let update: SynthesisUpdate;
  try {
    const cleanJson = llmResult.replace(/```json/gi, '').replace(/```/g, '').trim();
    update = JSON.parse(cleanJson) as SynthesisUpdate;
  } catch (err) {
    console.error('[SYNTHESIS] Failed to parse JSON from AI', err);
    return;
  }

  // Completion detection — advance each named standard. Must run even
  // if no page update was produced. Unknown ids are ignored rather
  // than failing the whole batch.
  const standardIds = new Set(standards.map(s => s.id));
  if (Array.isArray(update.completed_standards)) {
    for (const entry of update.completed_standards) {
      if (!entry || typeof entry.id !== 'string') continue;
      if (!standardIds.has(entry.id)) {
        console.warn(`[SYNTHESIS] Completion for unknown standard id: ${entry.id}`);
        continue;
      }
      const when = entry.completed_at ? new Date(entry.completed_at) : new Date();
      if (isNaN(when.getTime())) continue;
      try {
        await markCompleted(entry.id, when);
        console.log(`[CARE] Marked standard ${entry.id} completed at ${when.toISOString()}`);
      } catch (err) {
        console.error('[CARE] markCompleted failed:', err);
      }
    }
  }

  // If the LLM only returned completions, stop here — no page to upsert.
  if (!update.category || !update.title || !update.markdown_body) return;

  if (!SPACE_CATEGORIES.includes(update.category)) {
    console.warn(`[SYNTHESIS] Unknown category: ${update.category}`);
    return;
  }

  // De-anonymise LLM output before persisting. Spaces are local-only family
  // data; they should contain real names. Without this, every Space row and
  // every compiled .md file would carry anonymous labels like "Adult-1" or
  // "Family-1776…-0" instead of "Rach", which is both wrong data and an
  // alarming UX for the family reading their own Space.
  const realTitle = await translateToReal(update.title);
  const realBody = await translateToReal(update.markdown_body);
  const realDescription = await translateToReal(update.description ?? '');
  const realPeople = await Promise.all(
    (update.people ?? []).map(p => translateToReal(p)),
  );
  const realTags = await Promise.all(
    (update.tags ?? []).map(t => translateToReal(t)),
  );

  try {
    const space = await upsertSpace({
      familyId: profileId,
      category: update.category,
      name: realTitle,
      bodyMarkdown: realBody,
      description: realDescription,
      domains: update.domains ?? [],
      people: realPeople,
      visibility: (update.visibility as any) ?? 'family',
      confidence: update.confidence ?? 0.7,
      tags: realTags,
      actorProfileId: profileId,
    });
    console.log(`[SYNTHESIS] Upserted Space: ${space.uri}`);

    // Per-message reflection — cheap synchronous check for contradictions
    // against linked Spaces. Fire-and-forget: the chat flow shouldn't
    // wait on reflection.
    runPerMessageReflection(profileId, space).catch(err => {
      console.error('[REFLECTION] per-message pass failed:', err);
    });
  } catch (err) {
    console.error('[SYNTHESIS] Failed to upsert Space', err);
  }
}
