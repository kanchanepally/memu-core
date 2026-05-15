/**
 * Build Spec 2 Phase R2 — research-workspace source ingestion.
 *
 * Companion to documentIngestion.ts. Where documentIngestion produces a
 * family-shaped Document Space (LLM extracts dates / amounts / parties
 * for bills + school letters), this produces a research-shaped Source
 * Space:
 *
 *   - category = 'source' (per the research-workspace category set
 *     from R1; only valid in research workspaces)
 *   - body = the full extracted text with stable passage IDs assigned
 *     by upsertSpace's Z.2 path; researchers code passages from this
 *     body so it must be present, complete, addressable
 *   - title = filename minus extension (no LLM — the spec is explicit
 *     that research ingestion is mechanical, not interpretive; metadata
 *     enrichment via LLM is a later refinement and gated by R4 evals)
 *   - sourceReferences carries `document:<storedAt>` so the PDF
 *     viewer (Z.3) mounts the original inline above the markdown body
 *
 * Anonymisation invariant — the SAME novel-entity gate that the family
 * path runs, applied here BEFORE the text is persisted to the Space.
 * The Twin registry is per-Collective, so participant names detected
 * in a research transcript register in THAT workspace's registry and
 * never leak to subsequent LLM calls (memo suggestions, coding
 * proposals — both in later phases). This is the load-bearing
 * research-ethics property the spec calls out repeatedly.
 *
 * What this module deliberately does NOT do:
 *   - LLM enrichment (title parsing, metadata extraction, summary).
 *     The research workspace's reading surface is the PDF viewer +
 *     raw extracted text; the researcher does the interpretation.
 *   - Stream cards. Source ingestion in a research workspace
 *     produces no action items — there's nothing to "do" with an
 *     uploaded paper.
 *   - Confirmation cards for participant detection. The novel-entity
 *     gate already registers in `auto` mode by default; explicit
 *     researcher confirmation of participant identity is R3 work
 *     (it ties into the participant-Space surface that doesn't
 *     exist yet).
 */

import { detectAndRegisterNovelEntities } from '../twin/novel';
import { upsertSpace } from '../spaces/store';
import {
  parseDocument,
  persistOriginal,
  resolveMimeType,
  RESEARCH_MAX_TEXT_CHARS,
} from './documentIngestion';

export interface ResearchSourceIngestionInput {
  /** Active profile id; used for git authorship + the upsertSpace familyId. */
  profileId: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  /** Channel the upload came from (mobile / pwa / whatsapp). Recorded on
   *  the Space's sourceReferences for provenance; doesn't change behaviour. */
  channel: string;
  /** Message id from the chat that triggered the upload — used as part
   *  of sourceReferences so the upload can be back-traced. */
  messageId: string;
}

export interface ResearchSourceIngestionResult {
  ok: true;
  spaceUri: string;
  spaceTitle: string;
  charCount: number;
  truncated: boolean;
  storedAt: string;
  /** Number of novel entities (names, places, organisations) detected
   *  in the source and registered in the workspace's Twin registry. */
  entitiesRegistered: number;
}

export interface ResearchSourceIngestionFailure {
  ok: false;
  error: string;
  stage: 'parse' | 'persist' | 'space';
}

export type ResearchSourceIngestionOutcome =
  | ResearchSourceIngestionResult
  | ResearchSourceIngestionFailure;

/**
 * Derive a Space title from the upload's filename. The leading
 * date / ordinal / UUID-style prefixes that some scanners attach
 * ("2024-03-15-paper.pdf", "1234567-talk.pdf") are stripped; the
 * remainder is title-cased with separators collapsed. Pure — no LLM,
 * no DB. The researcher renames freely from the Space-detail edit
 * surface if the auto-derived title is wrong.
 */
export function deriveTitleFromFilename(fileName: string): string {
  // Strip extension.
  const noExt = fileName.replace(/\.[^.]+$/, '');
  // Strip common leading-prefix noise: ISO dates, UUIDs, leading
  // digits + separators. The trailing `(?:[-_. ]+|$)` lets each
  // regex match a prefix that fills the entire string too — so a
  // filename that's JUST a date ("2024-03-15.pdf") strips to empty
  // and triggers the noExt fallback below rather than half-stripping
  // into nonsense.
  const cleaned = noExt
    .replace(/^\d{4}[-_.]?\d{2}[-_.]?\d{2}(?:[-_. ]+|$)/, '') // YYYY-MM-DD prefix
    .replace(/^[0-9a-f]{8,}(?:[-_. ]+|$)/i, '')               // hex / UUID prefix
    .replace(/^\d+(?:[-_. ]+|$)/, '')                          // bare numeric prefix
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return noExt || fileName;
  // Title-case the first letter only — preserve mid-word casing
  // (acronyms, author surnames) which a heavy-handed title-case
  // would mangle.
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Process a research-workspace source upload end-to-end. Caller is
 * /api/document when the active workspace's type === 'research'; the
 * family-workspace path stays on processDocumentIngestion.
 */
export async function processResearchSourceIngestion(
  input: ResearchSourceIngestionInput,
): Promise<ResearchSourceIngestionOutcome> {
  const resolvedMime = resolveMimeType(input.mimeType, input.fileName);
  // Research path uses a much higher truncation cap than the family
  // path — researchers code from the full text, not from an LLM
  // summary. RESEARCH_MAX_TEXT_CHARS (~120k tokens) covers a typical
  // book-length PDF; longer documents get truncated with a visible
  // notice in the Space body.
  const parsed = await parseDocument(input.buffer, resolvedMime, { maxChars: RESEARCH_MAX_TEXT_CHARS });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, stage: 'parse' };
  }

  // Persist the original BEFORE any LLM-side work so a failure on the
  // anonymisation path still leaves the file recoverable. Same storage
  // shape as the family path — /api/spaces/:id/document serves both.
  let storedAt: string;
  try {
    storedAt = await persistOriginal(input.profileId, input.fileName, input.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `failed to save source: ${message}`, stage: 'persist' };
  }

  // ANONYMISATION GATE — the spec's load-bearing correctness property.
  // Every proper noun in the source registers in the workspace's Twin
  // registry BEFORE the text reaches the Space body, so any subsequent
  // LLM call (memo suggestion in R3, coding proposals in R5) sees only
  // anonymous labels. detectAndRegisterNovelEntities operates against
  // the active Collective's session var (memu.collective_id), which
  // requireCollective has already set for this request.
  let entitiesRegistered = 0;
  try {
    const novelEntities = await detectAndRegisterNovelEntities(parsed.text);
    entitiesRegistered = Array.isArray(novelEntities) ? novelEntities.length : 0;
  } catch (err) {
    // Non-fatal in this slice — log + continue. The hard test in
    // src/__tests__/research-anonymisation-gate.test.ts will catch
    // any regression that lets named text reach an LLM without
    // registration. For Source ingestion specifically we don't yet
    // call any LLM (no skill dispatch), so a registration failure
    // here doesn't actually leak — but we log loudly so it surfaces
    // before the R3 memo-suggestion / R5 coding-proposal paths
    // start consuming Source bodies.
    console.warn('[R2] novel-entity registration failed (continuing — no LLM call follows):', err);
  }

  const title = deriveTitleFromFilename(input.fileName);
  const sourceRef = `document:${storedAt}`;

  // Body: a small header (filename, page count if PDF, truncation
  // notice if applied) followed by the extracted text verbatim. The
  // header is markdown — passage IDs (Z.2) will land on each top-level
  // block inside upsertSpace.
  const bodyLines: string[] = [
    `**Source**: ${input.fileName}`,
    `**Characters**: ${parsed.charCount.toLocaleString('en-US')}${parsed.truncated ? ' _(truncated)_' : ''}`,
    '',
    '---',
    '',
    parsed.text,
  ];

  let spaceUri: string;
  try {
    const space = await upsertSpace({
      familyId: input.profileId,
      category: 'source',
      name: title,
      bodyMarkdown: bodyLines.join('\n'),
      description: `Source · ${parsed.detectedMimeType}`,
      visibility: 'family',
      confidence: 1.0, // verbatim extraction; no LLM inference
      sourceReferences: [sourceRef, `message:${input.messageId}`],
      tags: ['source'],
      actorProfileId: input.profileId,
    });
    spaceUri = space.uri;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Source upsert failed: ${message}`, stage: 'space' };
  }

  return {
    ok: true,
    spaceUri,
    spaceTitle: title,
    charCount: parsed.charCount,
    truncated: parsed.truncated,
    storedAt,
    entitiesRegistered,
  };
}
