/**
 * Document Ingestion Pipeline (Bug 6 — Tier 1 pre-beta skill, 2026-04-26).
 *
 * Slice 1 supports PDF and plain text. mammoth/.docx is deferred to slice 2 —
 * school newsletters and utility bills (Hareesh's named pain points) are
 * almost always PDFs. Image documents (a photo of a school letter) already
 * flow through the existing `vision` skill via /api/vision; this module
 * is for "I have the actual file" uploads.
 *
 * Flow:
 *   buffer + mimeType
 *      ↓ parseDocument
 *   raw text (real names, real numbers, real addresses)
 *      ↓ detectAndRegisterNovelEntities
 *      ↓ translateToAnonymous
 *   anonymised text
 *      ↓ dispatch('document_ingestion')
 *   anonymous JSON {doc_type, title, summary_markdown, key_dates, key_amounts, parties, stream_cards}
 *      ↓ translateToReal on every user-facing string
 *   real-names JSON
 *      ↓ upsertSpace (category: 'document') + persistStreamCards
 *   {ok, spaceUri, streamCardCount, charCount}
 *
 * Privacy invariant: real names enter only at parsing and exit only at
 * persistence. The skill operates entirely in the anonymous namespace.
 * The Twin guard runs as part of dispatch() per-skill (document_ingestion
 * is requires_twin: true).
 *
 * Storage: original file persisted under MEMU_DOCUMENTS_ROOT
 * (/mnt/memu-data/memu-core-standalone/documents/ on the Z2) so future
 * passes can re-process or surface the original via a "view source"
 * Space action. Path shape: <familyId>/<yyyy-mm>/<uuid>-<safe-name>.
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { detectAndRegisterNovelEntities } from '../twin/novel';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { dispatch } from '../skills/router';
import { upsertSpace } from '../spaces/store';
import { pool } from '../db/connection';
import { interactiveQueryTools, interactiveQueryServerTools } from './tools';
import { formatToolSummaryFooter } from './toolSummary';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Cap parsed text fed to the LLM. ~50k chars ≈ ~12k tokens — generous for
// typical letters and bills, well inside Sonnet's context. Larger inputs
// get truncated with a marker so the skill can flag the truncation in its
// summary rather than the pipeline silently dropping content.
const MAX_TEXT_CHARS = 50_000;
const TRUNCATION_NOTICE = '\n\n…[document truncated for processing — only the first 50,000 characters shown]';

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
]);

// File-extension fallback for `mimeType: application/octet-stream` uploads
// (some browsers / clients send this for unknown types). Keep extending as
// new parsers come online.
const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/plain',
};

// ---------------------------------------------------------------------------
// Pure parsing helpers
// ---------------------------------------------------------------------------

export interface ParseResult {
  ok: true;
  text: string;
  charCount: number;
  truncated: boolean;
  detectedMimeType: string;
}

export interface ParseError {
  ok: false;
  error: string;
}

export type ParseOutcome = ParseResult | ParseError;

function applyTruncation(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_TEXT_CHARS) + TRUNCATION_NOTICE, truncated: true };
}

export async function parsePdf(buffer: Buffer): Promise<ParseOutcome> {
  try {
    // pdf-parse 2.x is class-based — `new PDFParse({ data })` then
    // `.getText()` returns a TextResult with `.text` containing the
    // concatenated document string. Loaded lazily so non-document code
    // paths don't drag the dep.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const rawText = (result.text ?? '').trim();
    if (rawText.length === 0) {
      return { ok: false, error: 'PDF parsed but contained no extractable text (likely scanned image — try uploading as a photo via /api/vision)' };
    }
    const { text, truncated } = applyTruncation(rawText);
    return {
      ok: true,
      text,
      charCount: rawText.length,
      truncated,
      detectedMimeType: 'application/pdf',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `PDF parse failed: ${message}` };
  }
}

export function parsePlainText(buffer: Buffer): ParseOutcome {
  try {
    const rawText = buffer.toString('utf8').trim();
    if (rawText.length === 0) {
      return { ok: false, error: 'document is empty' };
    }
    const { text, truncated } = applyTruncation(rawText);
    return {
      ok: true,
      text,
      charCount: rawText.length,
      truncated,
      detectedMimeType: 'text/plain',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `plain-text parse failed: ${message}` };
  }
}

/**
 * Resolve a usable mime type from the upload's declared mime + filename
 * extension. Some clients send `application/octet-stream` for everything.
 */
export function resolveMimeType(declaredMime: string, fileName: string): string {
  if (SUPPORTED_MIME_TYPES.has(declaredMime)) return declaredMime;
  const ext = path.extname(fileName).toLowerCase();
  const fromExt = EXT_TO_MIME[ext];
  if (fromExt) return fromExt;
  return declaredMime; // pass through; dispatcher will reject if unsupported
}

/**
 * Top-level dispatcher. Picks a parser by mime type, falls back to error
 * with a clear list of supported types so the caller can render a helpful
 * message.
 */
export async function parseDocument(buffer: Buffer, mimeType: string): Promise<ParseOutcome> {
  switch (mimeType) {
    case 'application/pdf':
      return parsePdf(buffer);
    case 'text/plain':
      return parsePlainText(buffer);
    default:
      return {
        ok: false,
        error: `unsupported document type "${mimeType}". Supported: PDF (application/pdf), plain text (text/plain). For images, use /api/vision instead. .docx support is on the roadmap.`,
      };
  }
}

// ---------------------------------------------------------------------------
// Skill output shape
// ---------------------------------------------------------------------------

interface KeyDate {
  label?: string;
  iso_date?: string;
  urgency?: string;
}

interface KeyAmount {
  label?: string;
  amount?: string;
}

interface SkillStreamCard {
  card_type?: string;
  title?: string;
  body?: string;
  due_iso?: string;
}

interface DocumentSkillOutput {
  doc_type?: string;
  title?: string;
  summary_markdown?: string;
  key_dates?: KeyDate[];
  key_amounts?: KeyAmount[];
  parties?: string[];
  stream_cards?: SkillStreamCard[];
}

const VALID_DOC_TYPES = new Set([
  'school_letter', 'bill', 'appointment', 'council', 'receipt',
  'form', 'contract', 'manual', 'creative', 'other',
]);

function coerceDocType(raw: unknown): string {
  if (typeof raw === 'string' && VALID_DOC_TYPES.has(raw)) return raw;
  return 'other';
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function documentsRoot(): string {
  return process.env.MEMU_DOCUMENTS_ROOT ?? path.resolve(process.cwd(), 'data', 'documents');
}

function safeFileName(name: string): string {
  // Strip path separators + control chars; preserve extension. Keep it
  // short — 80 chars max post-sanitization.
  const stripped = name.replace(/[\x00-\x1f/\\:*?"<>|]/g, '_');
  return stripped.slice(0, 80);
}

async function persistOriginal(
  familyId: string,
  fileName: string,
  buffer: Buffer,
): Promise<string> {
  const yyyymm = new Date().toISOString().slice(0, 7); // YYYY-MM
  const dir = path.join(documentsRoot(), familyId, yyyymm);
  await fs.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  const target = path.join(dir, `${id}-${safeFileName(fileName)}`);
  await fs.writeFile(target, buffer);
  return target;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface DocumentIngestionInput {
  profileId: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  channel: string;
  messageId: string;
}

export interface DocumentIngestionResult {
  ok: true;
  spaceUri: string;
  spaceTitle: string;
  docType: string;
  charCount: number;
  truncated: boolean;
  streamCardCount: number;
  storedAt: string;
  /**
   * Optional real-names text from the post-ingestion follow-up turn —
   * Claude's narration of any actions it took (calendar events written,
   * planning Spaces created, etc.). Empty when the followup didn't fire
   * or returned nothing actionable.
   */
  followupText?: string;
}

export interface DocumentIngestionFailure {
  ok: false;
  error: string;
  stage: 'parse' | 'skill' | 'persist';
}

export type DocumentIngestionOutcome = DocumentIngestionResult | DocumentIngestionFailure;

/**
 * Build the user-message payload for the document_ingestion skill. The
 * filename is part of the prompt because document type / title are often
 * informed by it (e.g. "april-2026-bill.pdf" pre-classifies as a bill).
 */
function buildSkillPrompt(fileName: string, anonText: string, nowIso: string): string {
  return `## Today
${nowIso}

## Filename
${fileName}

## Document text

${anonText}`;
}

export async function processDocumentIngestion(
  input: DocumentIngestionInput,
): Promise<DocumentIngestionOutcome> {
  const resolvedMime = resolveMimeType(input.mimeType, input.fileName);
  const parsed = await parseDocument(input.buffer, resolvedMime);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, stage: 'parse' };
  }

  // Persist the original file early so we have a durable reference even
  // if the LLM call fails later. Storage path becomes a sourceReference
  // on the Space.
  let storedAt: string;
  try {
    storedAt = await persistOriginal(input.profileId, input.fileName, input.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `failed to save document: ${message}`, stage: 'persist' };
  }

  // Run novel-entity detection BEFORE translation so any unseen names in
  // the document get registered in the Twin and anonymised on the next
  // pass. Same pattern as the message orchestrator.
  await detectAndRegisterNovelEntities(parsed.text);
  const anonText = await translateToAnonymous(parsed.text);

  const nowIso = new Date().toISOString();
  let skillReply: string;
  try {
    const result = await dispatch({
      skill: 'document_ingestion',
      userMessage: buildSkillPrompt(input.fileName, anonText, nowIso),
      profileId: input.profileId,
      familyId: input.profileId,
      maxTokens: 4096,
      temperature: 0,
    });
    skillReply = result.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `document_ingestion skill failed: ${message}`, stage: 'skill' };
  }

  // Parse the JSON object out of the reply. Skill is told to return only
  // JSON, but we tolerate the model wrapping it (markdown fences, etc.)
  // by greedy-matching the first top-level {...}.
  const jsonMatch = skillReply.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      ok: false,
      error: 'document_ingestion skill returned no JSON object',
      stage: 'skill',
    };
  }

  let skillOutput: DocumentSkillOutput;
  try {
    skillOutput = JSON.parse(jsonMatch[0]) as DocumentSkillOutput;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `document_ingestion JSON parse failed: ${message}`,
      stage: 'skill',
    };
  }

  // Translate user-facing strings back to real names. Title, summary,
  // key_dates labels, key_amounts labels, stream_cards titles+bodies.
  // doc_type and ISO dates and amounts pass through unchanged.
  const realTitle = await translateToReal(
    typeof skillOutput.title === 'string' && skillOutput.title.trim().length > 0
      ? skillOutput.title.trim()
      : input.fileName,
  );
  const realSummary = await translateToReal(
    typeof skillOutput.summary_markdown === 'string' ? skillOutput.summary_markdown : '',
  );
  const docType = coerceDocType(skillOutput.doc_type);

  // Translate structured data to real names ONCE — re-used for both the
  // Space body below and the follow-up prompt fed to interactive_query.
  interface RealKeyDate { label: string; iso: string; urgency: string }
  interface RealKeyAmount { label: string; amount: string }
  const realKeyDates: RealKeyDate[] = [];
  if (Array.isArray(skillOutput.key_dates)) {
    for (const kd of skillOutput.key_dates) {
      realKeyDates.push({
        label: await translateToReal(kd.label ?? ''),
        iso: typeof kd.iso_date === 'string' ? kd.iso_date : '',
        urgency: typeof kd.urgency === 'string' ? kd.urgency : '',
      });
    }
  }
  const realKeyAmounts: RealKeyAmount[] = [];
  if (Array.isArray(skillOutput.key_amounts)) {
    for (const ka of skillOutput.key_amounts) {
      realKeyAmounts.push({
        label: await translateToReal(ka.label ?? ''),
        amount: typeof ka.amount === 'string' ? ka.amount : '',
      });
    }
  }
  const realParties: string[] = Array.isArray(skillOutput.parties)
    ? (await Promise.all(
        skillOutput.parties.map(p => translateToReal(typeof p === 'string' ? p : '')),
      )).filter(p => p.trim().length > 0)
    : [];

  // Build the Space body. Append the metadata sections after the LLM's
  // summary so a reader sees the prose first, then structured fields.
  const sections: string[] = [];
  if (realSummary.trim().length > 0) sections.push(realSummary.trim());

  if (realKeyDates.length > 0) {
    const lines: string[] = ['## Key dates'];
    for (const kd of realKeyDates) {
      const urgencyTag = kd.urgency ? ` _(${kd.urgency})_` : '';
      lines.push(`- **${kd.iso}**: ${kd.label}${urgencyTag}`);
    }
    sections.push(lines.join('\n'));
  }

  if (realKeyAmounts.length > 0) {
    const lines: string[] = ['## Key amounts'];
    for (const ka of realKeyAmounts) {
      lines.push(`- **${ka.amount}**: ${ka.label}`);
    }
    sections.push(lines.join('\n'));
  }

  if (realParties.length > 0) {
    sections.push(`## Referenced\n\n${realParties.map(p => `- ${p}`).join('\n')}`);
  }

  // Source reference points back to the original file on disk so future
  // tools (Article 20 export, view-original UI) can resurface it.
  const sourceRef = `document:${storedAt}`;

  let spaceUri: string;
  try {
    const space = await upsertSpace({
      familyId: input.profileId,
      category: 'document',
      name: realTitle,
      bodyMarkdown: sections.join('\n\n'),
      description: `${docType.replace(/_/g, ' ')} — ingested ${nowIso.slice(0, 10)}`,
      visibility: 'family',
      confidence: 0.7,
      sourceReferences: [sourceRef, `message:${input.messageId}`],
      tags: [docType],
      actorProfileId: input.profileId,
    });
    spaceUri = space.uri;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Space upsert failed: ${message}`, stage: 'persist' };
  }

  // Persist any time-sensitive items as stream cards on the family stream.
  let streamCardCount = 0;
  if (Array.isArray(skillOutput.stream_cards)) {
    for (let i = 0; i < skillOutput.stream_cards.length; i++) {
      const sc = skillOutput.stream_cards[i];
      const cardType = typeof sc.card_type === 'string' ? sc.card_type : 'extraction';
      const cardTitle = await translateToReal(typeof sc.title === 'string' ? sc.title : '');
      const cardBody = await translateToReal(typeof sc.body === 'string' ? sc.body : '');
      if (cardTitle.trim().length === 0) continue;
      try {
        await pool.query(
          `INSERT INTO stream_cards (family_id, card_type, title, body, source, source_message_id, actions)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.profileId,
            cardType,
            cardTitle,
            cardBody,
            'document',
            `${input.messageId}-doc-${i}`,
            JSON.stringify([]),
          ],
        );
        streamCardCount += 1;
      } catch (err) {
        // Don't fail the whole ingestion for one bad card. Log and move on.
        console.error('[DOCUMENT INGESTION] stream card insert failed:', err);
      }
    }
  }

  // Best-effort follow-up: hand the document context to interactive_query
  // so Claude can act on it — search the web for missing dates, write
  // calendar events, spawn planning Spaces, cross-reference existing
  // family Spaces. The Space already exists, so a followup failure does
  // NOT roll back the ingestion.
  let followupText: string | undefined;
  try {
    followupText = await runDocumentFollowup({
      profileId: input.profileId,
      messageId: input.messageId,
      spaceUri,
      spaceTitle: realTitle,
      docType,
      fileName: input.fileName,
      summary: realSummary,
      keyDates: realKeyDates,
      keyAmounts: realKeyAmounts,
      parties: realParties,
      truncated: parsed.truncated,
    });
  } catch (err) {
    console.error('[DOCUMENT INGESTION] followup failed (non-fatal):', err);
  }

  return {
    ok: true,
    spaceUri,
    spaceTitle: realTitle,
    docType,
    charCount: parsed.charCount,
    truncated: parsed.truncated,
    streamCardCount,
    storedAt,
    followupText,
  };
}

// ---------------------------------------------------------------------------
// Post-ingestion follow-up (intelligent action chain)
// ---------------------------------------------------------------------------

interface FollowupInput {
  profileId: string;
  messageId: string;
  spaceUri: string;
  spaceTitle: string;
  docType: string;
  fileName: string;
  summary: string;
  keyDates: { label: string; iso: string; urgency: string }[];
  keyAmounts: { label: string; amount: string }[];
  parties: string[];
  truncated: boolean;
}

/**
 * Format the document context as a synthetic user-message that
 * interactive_query can act on. Phrased as if Hareesh just told Memu
 * about the upload — so Memu's reply lands naturally as a chat bubble.
 *
 * The instruction list is explicit because document follow-ups are a
 * narrow use case: search the web to ground missing dates, look up
 * relevant family Spaces, write to the calendar, spawn planning
 * Spaces. Without explicit guidance the skill defaults to general
 * conversational behaviour.
 */
function buildFollowupPrompt(input: FollowupInput): string {
  const lines: string[] = [];
  lines.push(`I just uploaded a document. Here's what was extracted:`);
  lines.push('');
  lines.push(`- Title: ${input.spaceTitle}`);
  lines.push(`- Type: ${input.docType.replace(/_/g, ' ')}`);
  lines.push(`- Source filename: ${input.fileName}`);
  lines.push(`- Saved as Space: ${input.spaceUri}`);
  if (input.truncated) {
    lines.push(`- ⚠ Note: only the first 50,000 characters were processed.`);
  }
  lines.push('');
  lines.push(`Summary:`);
  lines.push(input.summary.trim().length > 0 ? input.summary.trim() : '(none)');
  lines.push('');

  if (input.keyDates.length > 0) {
    lines.push(`Key dates extracted from the text:`);
    for (const kd of input.keyDates) {
      const urgency = kd.urgency ? ` (${kd.urgency})` : '';
      lines.push(`- ${kd.iso || '(no ISO)'}: ${kd.label}${urgency}`);
    }
  } else {
    lines.push(
      `Key dates: none extractable from the text. The PDF may have been a visual ` +
      `calendar grid that didn't parse cleanly — in that case search the web for the ` +
      `authoritative published version using the document title as your seed.`,
    );
  }
  lines.push('');

  if (input.keyAmounts.length > 0) {
    lines.push(`Key amounts:`);
    for (const ka of input.keyAmounts) {
      lines.push(`- ${ka.amount}: ${ka.label}`);
    }
    lines.push('');
  }

  if (input.parties.length > 0) {
    lines.push(`Parties referenced: ${input.parties.join(', ')}`);
    lines.push('');
  }

  lines.push(`Take any sensible follow-up actions on my behalf:`);
  lines.push(
    `- If exact dates are missing or incomplete, use web_search to find the ` +
    `authoritative published source and use those real grounded dates. Never invent dates.`,
  );
  lines.push(
    `- Cross-reference with existing family context using \`findSpaces\` — relate the ` +
    `document to the right person, household, or commitment before acting.`,
  );
  lines.push(
    `- For any concrete dated event (term start/end, half-term, MOT, appointment, ` +
    `deadline), call \`addCalendarEvent\` with real, grounded dates only.`,
  );
  lines.push(
    `- Where the document implies forward planning (school holidays → half-term plans, ` +
    `summer plans; recurring bills; deadlines), call \`createSpace\` or \`updateSpace\` ` +
    `to give the family a starting page they can grow into.`,
  );
  lines.push(
    `- Be honest about what you couldn't ground. Don't fabricate — say "I couldn't find X" ` +
    `and the user will fill it in.`,
  );
  lines.push('');
  lines.push(`Reply with what you actioned, in your usual voice. Keep it concise.`);

  return lines.join('\n');
}

async function runDocumentFollowup(input: FollowupInput): Promise<string | undefined> {
  const realPrompt = buildFollowupPrompt(input);

  // Twin guard runs inside dispatch (interactive_query is requires_twin: true).
  // Pre-anonymise here so the dispatch sees the same shape as a normal chat
  // turn — saves the guard from rewriting a long prompt at the boundary.
  const anonPrompt = await translateToAnonymous(realPrompt);

  const result = await dispatch({
    skill: 'interactive_query',
    templateVars: { context_block: '' },
    userMessage: anonPrompt,
    profileId: input.profileId,
    familyId: input.profileId,
    useBYOK: true,
    tools: interactiveQueryTools,
    serverTools: interactiveQueryServerTools,
    maxTokens: 4096,
    toolContext: {
      familyId: input.profileId,
      profileId: input.profileId,
      channel: 'pwa',
      messageId: `${input.messageId}-followup`,
    },
  });

  if (result.toolCalls && result.toolCalls.length > 0) {
    const summary = result.toolCalls.map(c => `${c.name}:${c.ok ? 'ok' : 'fail'}`).join(' ');
    console.log(`[DOC FOLLOWUP TOOL-USE]: ${summary}`);
  }

  const realText = await translateToReal(result.text);
  const trimmed = realText.trim();
  if (trimmed.length === 0 && (!result.toolCalls || result.toolCalls.length === 0)) {
    return undefined;
  }

  const footer = formatToolSummaryFooter(result.toolCalls);
  return footer ? `${trimmed}${footer}` : trimmed;
}
