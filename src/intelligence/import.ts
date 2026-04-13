import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { seedContext } from './context';
import { pool } from '../db/connection';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ==========================================
// WHATSAPP EXPORT PARSER
// ==========================================

interface WhatsAppMessage {
  timestamp: string;
  sender: string;
  content: string;
}

/**
 * Parse a WhatsApp .txt export into structured messages.
 * Handles both 12-hour and 24-hour formats, and multi-line messages.
 *
 * Formats:
 *   12/03/2026, 09:15 - Hareesh: message text
 *   [12/03/2026, 9:15:30 AM] Hareesh: message text
 *   03/12/26, 09:15 - Hareesh: message text
 */
function parseWhatsAppExport(text: string): WhatsAppMessage[] {
  const messages: WhatsAppMessage[] = [];

  // Match common WhatsApp export timestamp patterns (Relaxed for US/UK/24H/12H and var separators)
  const lineRegex = /^\[?(\d{1,2}[\/\.]\d{1,2}[\/\.]\d{2,4}.*?)\]?\s*[-–]?\s*([^:]+):\s*(.*)/;

  const lines = text.split('\n');
  let current: WhatsAppMessage | null = null;

  for (const line of lines) {
    const match = line.match(lineRegex);
    if (match) {
      // Save previous message
      if (current) messages.push(current);
      current = {
        timestamp: match[1].trim(),
        sender: match[2].trim(),
        content: match[3].trim(),
      };
    } else if (current && line.trim()) {
      // Continuation of previous message (multi-line)
      current.content += '\n' + line.trim();
    }
  }
  if (current) messages.push(current);

  return messages;
}

/**
 * Filter out trivial WhatsApp messages that won't yield useful facts.
 */
function isSubstantive(msg: WhatsAppMessage): boolean {
  const content = msg.content.toLowerCase().trim();
  if (content.length < 5) return false;
  if (content === '<media omitted>') return false;
  if (content === 'this message was deleted') return false;
  if (content.startsWith('missed voice call')) return false;
  if (content.startsWith('missed video call')) return false;
  if (/^(ok|okay|yes|no|yep|nope|sure|thanks|thank you|lol|haha|hahaha|😂|👍|❤️|🙏|😊)$/i.test(content)) return false;
  return true;
}

// ==========================================
// TEXT / MARKDOWN CHUNKER
// ==========================================

interface TextChunk {
  content: string;
  heading?: string; // For markdown files, the nearest heading
  source: string;   // Filename or label
}

/**
 * Split markdown/text into chunks by heading or by paragraph groups.
 * Each chunk is small enough for a single extraction call.
 */
function chunkMarkdown(text: string, filename: string, maxChunkChars: number = 3000): TextChunk[] {
  const chunks: TextChunk[] = [];

  // Split by headings first
  const sections = text.split(/^(#{1,3}\s+.+)$/m);

  let currentHeading = filename;
  let currentContent = '';

  for (const section of sections) {
    if (/^#{1,3}\s+/.test(section)) {
      // This is a heading — flush previous content
      if (currentContent.trim().length > 20) {
        chunks.push({ content: currentContent.trim(), heading: currentHeading, source: filename });
      }
      currentHeading = section.replace(/^#+\s+/, '').trim();
      currentContent = '';
    } else {
      currentContent += section;

      // If content is getting too long, flush it
      if (currentContent.length > maxChunkChars) {
        chunks.push({ content: currentContent.trim(), heading: currentHeading, source: filename });
        currentContent = '';
      }
    }
  }

  // Flush remaining
  if (currentContent.trim().length > 20) {
    chunks.push({ content: currentContent.trim(), heading: currentHeading, source: filename });
  }

  return chunks;
}

/**
 * Split plain text into paragraph groups of roughly maxChunkChars.
 */
function chunkPlainText(text: string, filename: string, maxChunkChars: number = 3000): TextChunk[] {
  const chunks: TextChunk[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > maxChunkChars && current.length > 0) {
      chunks.push({ content: current.trim(), source: filename });
      current = '';
    }
    current += para + '\n\n';
  }

  if (current.trim().length > 20) {
    chunks.push({ content: current.trim(), source: filename });
  }

  return chunks;
}

// ==========================================
// DEDUPLICATION
// ==========================================

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

async function isAlreadyImported(sourceId: string): Promise<boolean> {
  const res = await pool.query(
    'SELECT 1 FROM context_entries WHERE source_id = $1 LIMIT 1',
    [sourceId]
  );
  return res.rows.length > 0;
}

// ==========================================
// EXTRACTION (batch of messages → facts)
// ==========================================

import { generateResponse } from './provider';

/**
 * Extract durable facts from a batch of messages or a text chunk.
 * Returns an array of fact strings.
 */
async function extractFactsFromChunk(content: string, contextLabel: string): Promise<string[]> {
  try {
    const prompt = `You are a memory extraction system. Given text from ${contextLabel}, extract durable facts worth remembering about the people, their routines, preferences, relationships, commitments, plans, and interests.

Extract ONLY facts that would be useful in future conversations:
- Preferences and routines ("Alice does ballet on Tuesdays")
- Relationships ("Bob is Alice's uncle")
- Commitments and plans ("Planning to renovate the kitchen in spring")
- Health details ("Child has a peanut allergy")
- Interests ("Has been talking about composting")
- Work context ("Works from home on Wednesdays")
- Important dates ("Wedding anniversary is 15 March")
- Recurring events ("School pickup is at 3:15pm")

DO NOT extract: temporary states, jokes, greetings, logistics that have already passed, or generic conversation.

Return a JSON array of strings. Each string is one self-contained fact.
If there are no durable facts, return [].

Text to extract from:
${content}`;

    const replyText = await generateResponse(prompt, [], []);

    const jsonMatch = replyText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const facts: string[] = JSON.parse(jsonMatch[0]);
    return facts.filter(f => typeof f === 'string' && f.trim().length > 5);
  } catch (err) {
    console.error('[IMPORT EXTRACTION ERROR]', err);
    return [];
  }
}

// ==========================================
// PUBLIC API: IMPORT WHATSAPP
// ==========================================

export interface ImportResult {
  totalMessages: number;
  substantiveMessages: number;
  chunksProcessed: number;
  factsExtracted: number;
  duplicatesSkipped: number;
}

/**
 * Import a WhatsApp .txt export. Can be run multiple times — deduplicates by chunk hash.
 * Batches messages into groups of ~15 for extraction, then stores each extracted fact.
 */
export async function importWhatsAppExport(
  profileId: string,
  fileContent: string,
  chatName: string = 'WhatsApp Chat'
): Promise<ImportResult> {
  const allMessages = parseWhatsAppExport(fileContent);
  const substantive = allMessages.filter(isSubstantive);

  let chunksProcessed = 0;
  let factsExtracted = 0;
  let duplicatesSkipped = 0;

  // Batch into groups of 15 messages for extraction
  const batchSize = 15;
  for (let i = 0; i < substantive.length; i += batchSize) {
    const batch = substantive.slice(i, i + batchSize);
    const batchText = batch.map(m => `[${m.timestamp}] ${m.sender}: ${m.content}`).join('\n');

    // Dedup by batch hash
    const sourceId = `whatsapp_import:${chatName}:${hashContent(batchText)}`;
    if (await isAlreadyImported(sourceId)) {
      duplicatesSkipped++;
      continue;
    }

    const facts = await extractFactsFromChunk(batchText, `a WhatsApp group chat called "${chatName}"`);

    for (const fact of facts) {
      await seedContext(fact.trim(), 'manual', profileId);
      factsExtracted++;
    }

    // Mark this batch as processed (store a lightweight entry for dedup)
    await pool.query(
      `INSERT INTO context_entries (source, source_id, content, metadata)
       VALUES ('whatsapp_group', $1, $2, $3)`,
      [sourceId, `[Import batch: ${facts.length} facts extracted]`, JSON.stringify({ profile_id: profileId, import_type: 'whatsapp', chat_name: chatName })]
    );

    chunksProcessed++;
    console.log(`[WHATSAPP IMPORT] Batch ${Math.floor(i / batchSize) + 1}: ${facts.length} facts extracted`);
  }

  console.log(`[WHATSAPP IMPORT] Done. ${substantive.length} substantive messages → ${chunksProcessed} batches → ${factsExtracted} facts. ${duplicatesSkipped} duplicate batches skipped.`);

  return {
    totalMessages: allMessages.length,
    substantiveMessages: substantive.length,
    chunksProcessed,
    factsExtracted,
    duplicatesSkipped,
  };
}

// ==========================================
// PUBLIC API: IMPORT TEXT / MARKDOWN / OBSIDIAN
// ==========================================

/**
 * Import a text or markdown file. Can be run multiple times — deduplicates by chunk hash.
 * Splits by headings (markdown) or paragraphs (plain text), then extracts facts from each chunk.
 */
export async function importTextFile(
  profileId: string,
  fileContent: string,
  filename: string
): Promise<ImportResult> {
  const isMarkdown = filename.endsWith('.md') || filename.endsWith('.markdown');
  const chunks = isMarkdown
    ? chunkMarkdown(fileContent, filename)
    : chunkPlainText(fileContent, filename);

  let chunksProcessed = 0;
  let factsExtracted = 0;
  let duplicatesSkipped = 0;

  for (const chunk of chunks) {
    // Dedup by chunk hash
    const sourceId = `file_import:${filename}:${hashContent(chunk.content)}`;
    if (await isAlreadyImported(sourceId)) {
      duplicatesSkipped++;
      continue;
    }

    const label = chunk.heading
      ? `a document called "${filename}", section "${chunk.heading}"`
      : `a document called "${filename}"`;

    const facts = await extractFactsFromChunk(chunk.content, label);

    for (const fact of facts) {
      await seedContext(fact.trim(), 'document', profileId);
      factsExtracted++;
    }

    // Mark chunk as processed
    await pool.query(
      `INSERT INTO context_entries (source, source_id, content, metadata)
       VALUES ('document', $1, $2, $3)`,
      [sourceId, `[Import: ${filename}${chunk.heading ? ' > ' + chunk.heading : ''} — ${facts.length} facts]`, JSON.stringify({ profile_id: profileId, import_type: 'file', filename })]
    );

    chunksProcessed++;
    console.log(`[FILE IMPORT] ${filename}${chunk.heading ? ' > ' + chunk.heading : ''}: ${facts.length} facts extracted`);
  }

  console.log(`[FILE IMPORT] Done. ${chunks.length} chunks → ${chunksProcessed} processed → ${factsExtracted} facts. ${duplicatesSkipped} duplicates skipped.`);

  return {
    totalMessages: chunks.length,
    substantiveMessages: chunks.length,
    chunksProcessed,
    factsExtracted,
    duplicatesSkipped,
  };
}

// ==========================================
// PUBLIC API: IMPORT DIRECTORY (Obsidian vault)
// ==========================================

/**
 * Import multiple files at once (e.g., an Obsidian vault export).
 * Accepts an array of {filename, content} pairs.
 */
export async function importFileBundle(
  profileId: string,
  files: Array<{ filename: string; content: string }>
): Promise<ImportResult> {
  let totalMessages = 0;
  let substantiveMessages = 0;
  let chunksProcessed = 0;
  let factsExtracted = 0;
  let duplicatesSkipped = 0;

  for (const file of files) {
    // Skip very small files or non-text
    if (file.content.trim().length < 50) continue;

    const result = await importTextFile(profileId, file.content, file.filename);
    totalMessages += result.totalMessages;
    substantiveMessages += result.substantiveMessages;
    chunksProcessed += result.chunksProcessed;
    factsExtracted += result.factsExtracted;
    duplicatesSkipped += result.duplicatesSkipped;
  }

  return { totalMessages, substantiveMessages, chunksProcessed, factsExtracted, duplicatesSkipped };
}
