/**
 * Build Spec 2 Phase Z — Story Z.2.
 *
 * Stable per-block passage IDs for research-workspace Space bodies.
 *
 * Every block-level element (paragraph, heading, list item, blockquote,
 * code block, table, thematic break) gets a short, stable id written
 * into the markdown source as an inline HTML comment that precedes
 * the block:
 *
 *     <!-- pid:p7a3 -->
 *     This is the first paragraph of a transcript turn.
 *
 *     <!-- pid:k2mn -->
 *     This is the second paragraph.
 *
 * Why inline comments rather than a sidecar table: the id travels with
 * the content. Exporting the Space carries its ids; another Pod
 * reading our Space sees them; a git diff shows them; there is no
 * separate table to keep in sync. The cost is a small bit of
 * editor-visible noise in the markdown source, accepted in exchange
 * for the synchronisation bugs the sidecar approach would re-introduce.
 *
 * Algorithm:
 *   - Parse the body via the SAME markdown-it instance used on the
 *     client (matching plugin set is not necessary — we only care
 *     about block-level structure, not rendered output). This keeps
 *     "what is a block" identical between server and client so the
 *     renderer can re-attach the comments unambiguously.
 *   - For each block-open token, look at the immediately-preceding
 *     html_block token. If it contains a `<!-- pid:XYZ -->` comment,
 *     preserve XYZ as that block's id. Otherwise, generate a fresh
 *     id (collision-checked within the Space) and synthesise a
 *     comment line for it.
 *   - Re-emit the source with comments preceding every block. Blocks
 *     that already had a comment keep it; new blocks gain one.
 *
 * This preserves ids across edits that don't add or remove blocks,
 * across reordering (the comment travels with its block), and across
 * text edits within a block (the comment is unchanged). Splitting a
 * paragraph creates a new block — the new block gets a fresh id; the
 * original keeps its id with the first half. Merging two paragraphs
 * collapses to one block — one of the ids is dropped (the later
 * comment is ignored when no block follows).
 *
 * Explicit "renumber" is a separate, deliberate operation: strip
 * every `<!-- pid:... -->` first, then run assignPassageIds again.
 * Not exposed in this story — Z.2 ships generate-and-preserve only.
 */

import MarkdownIt from 'markdown-it';
// @types/markdown-it 14.x exposes Token under the MarkdownIt namespace
// in its CJS-shaped types; importing from 'markdown-it/lib/token' fails
// because the ESM-only `.mts` declaration isn't resolvable under
// classic node module resolution. Use the namespace alias instead.
type Token = MarkdownIt.Token;
import { randomBytes } from 'crypto';

/**
 * Crockford base32 alphabet, lowercase. 32 chars exact: digits 0-9 plus
 * a-z minus i, l, o, u (the standard Crockford exclusions for legibility
 * — easy to confuse with 1/1/0/0). 4-char ids → ~1M possibilities;
 * 5 → 33M; 6 → 1B. Collision-checked, widen if we run out of space at
 * the current length.
 */
const PID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const PID_PATTERN = /<!--\s*pid:([0123456789abcdefghjkmnpqrstvwxyz]{4,6})\s*-->/i;
/** Same shape as PID_PATTERN, but global — used to collect every pid in a body for collision detection. */
const PID_PATTERN_GLOBAL = /<!--\s*pid:([0123456789abcdefghjkmnpqrstvwxyz]{4,6})\s*-->/gi;

/**
 * Top-level block tokens that earn a passage id. Each "block" is the
 * whole list / blockquote / table / paragraph / heading / code block /
 * thematic break — children of those blocks (list items, table rows,
 * paragraphs inside blockquotes) do NOT earn their own pid in this
 * story. Granularity refinement to list-item / nested-block level is
 * deferred until the active-reading layer (Phase R3) shows a real
 * need; pragmatically, interview transcripts and academic prose are
 * primarily paragraph-shaped, and lists / blockquotes rarely need
 * per-item codings.
 *
 * Nesting is detected via the `level` property on the token (0 at
 * the top level, > 0 inside any open block). We only mint pids at
 * level 0 of the relevant types.
 */
const TOP_LEVEL_BLOCK_TYPES = new Set([
  'heading_open',
  'paragraph_open',
  'bullet_list_open',
  'ordered_list_open',
  'blockquote_open',
  'code_block',
  'fence',
  'hr',
  'table_open',
  'dl_open',
]);

function newPidParser(): MarkdownIt {
  // No plugins needed — we only walk the block structure. Defaults
  // produce the same token stream the client-side instance does for
  // every standard markdown construct. html: true lets us see the
  // `<!-- pid:XYZ -->` comments as html_block tokens (rather than
  // them being stripped or escaped).
  return new MarkdownIt({ html: true, linkify: false, breaks: false });
}

function generatePid(existing: Set<string>): string {
  for (let len = 4; len <= 6; len++) {
    // 20 tries at each length before widening. With 32^4 = 1M possibilities
    // and rarely > 1000 blocks per Space, the loop almost always lands on
    // the first attempt at length 4.
    for (let attempt = 0; attempt < 20; attempt++) {
      const bytes = randomBytes(len);
      let id = '';
      for (let i = 0; i < len; i++) id += PID_ALPHABET[bytes[i] % 32];
      if (!existing.has(id)) {
        existing.add(id);
        return id;
      }
    }
  }
  throw new Error('passageIds: could not generate a non-colliding pid at length 6 — body has > ~30M blocks?');
}

/**
 * Read the pid from an html_block token's content. Returns null if
 * the token isn't a pid-bearing comment (any other inline HTML is
 * passed through untouched).
 */
function readPidFromToken(token: Token | undefined): string | null {
  if (!token || token.type !== 'html_block') return null;
  const m = token.content.match(PID_PATTERN);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Collect every pid already present in a body so generatePid can
 * avoid them. Done as a single regex sweep — we don't need to parse
 * for this, just enumerate.
 */
function collectExistingPids(body: string): Set<string> {
  const set = new Set<string>();
  for (const match of body.matchAll(PID_PATTERN_GLOBAL)) set.add(match[1].toLowerCase());
  return set;
}

/**
 * Walk the token stream and build a list of "block plans": for each
 * block-open token, what pid should it carry, and at what source-line
 * (map[0]) does the block begin. The pid is either the existing one
 * read off the preceding html_block, or a freshly-generated one.
 *
 * We track nesting depth via the standard `_open` / `_close` counter
 * and only mint pids at depth=0 of the relevant block types — a
 * paragraph nested inside a list item is part of that list item's
 * pid, not its own. (List items aren't in BLOCK_OPEN_TYPES because the
 * spec is explicit "list item is a block" — handled below via the
 * dedicated list_item_open branch when at the right depth.)
 */
interface BlockPlan {
  /** 0-indexed source line where the block starts. */
  startLine: number;
  /** Existing pid (preserved) or null (will mint). */
  existingPid: string | null;
}

function planBlocks(tokens: Token[]): BlockPlan[] {
  const plans: BlockPlan[] = [];
  // Track which source line we've already planned for, so multiple
  // tokens at the same map[0] (e.g. an html_block immediately
  // followed by a paragraph_open both reporting the same line because
  // they sit adjacent) don't yield duplicate plans.
  const seenLines = new Set<number>();
  // Look back one token for an html_block carrying a pid. The token
  // immediately before a block-open is the source of the existing
  // pid if there is one.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Only top-level blocks earn a pid. token.level reflects nesting:
    // 0 = top-level, > 0 = inside another open block. Children of
    // lists / blockquotes / tables are skipped.
    if (t.level !== 0) continue;
    if (!TOP_LEVEL_BLOCK_TYPES.has(t.type)) continue;
    const startLine = (t.map ? t.map[0] : -1);
    if (startLine < 0) continue;
    if (seenLines.has(startLine)) continue;
    seenLines.add(startLine);
    const prev = tokens[i - 1];
    plans.push({ startLine, existingPid: readPidFromToken(prev) });
  }
  return plans;
}

/**
 * Render the final body. For each plan, find the source line where
 * the block starts and ensure a single `<!-- pid:XYZ -->` line
 * immediately precedes it. Existing pid lines are kept where they
 * are; missing ones are inserted on the line above the block.
 *
 * Implementation detail: we operate on the line array directly rather
 * than splicing strings, to avoid quoting and offset bookkeeping. We
 * walk plans in REVERSE source order so each insertion doesn't shift
 * subsequent indices.
 */
function emit(lines: string[], plans: BlockPlan[], existing: Set<string>): string {
  // Sort by startLine descending so later insertions don't shift
  // earlier indices.
  const ordered = plans.slice().sort((a, b) => b.startLine - a.startLine);

  // Track which startLines already have a pid line immediately above
  // — if existingPid is set, the comment is already present on the
  // line above startLine. We leave it where it is.
  for (const plan of ordered) {
    if (plan.existingPid) continue; // comment already in place

    const pid = generatePid(existing);
    const commentLine = `<!-- pid:${pid} -->`;

    // Insert the comment immediately before the block. Multiple
    // consecutive blank lines above the block are preserved — we
    // splice the comment in just above the block's first line.
    lines.splice(plan.startLine, 0, commentLine);
  }
  return lines.join('\n');
}

/**
 * The main entry point. Assigns a stable passage id to every
 * block-level element in `body` that doesn't already have one.
 * Returns the augmented markdown source. Idempotent: running it twice
 * on the same body yields the same result (modulo non-determinism in
 * pid generation, which only affects newly-minted ids).
 *
 * Empty / whitespace-only bodies return unchanged — there are no
 * blocks to id.
 */
export function assignPassageIds(body: string): string {
  if (!body || body.trim().length === 0) return body;

  const parser = newPidParser();
  const tokens = parser.parse(body, {});
  const plans = planBlocks(tokens);
  if (plans.length === 0) return body;

  const existing = collectExistingPids(body);
  const lines = body.split('\n');
  return emit(lines, plans, existing);
}

/**
 * Strip every `<!-- pid:... -->` comment from a body. Used by the
 * explicit "renumber" operation (not exposed in Z.2). Exported for
 * test setup convenience.
 */
export function stripPassageIds(body: string): string {
  if (!body) return body;
  // Strip the comment plus a single trailing newline if present, so
  // renumbering doesn't leave dangling blank lines where the comments
  // were.
  return body.replace(/<!--\s*pid:[0123456789abcdefghjkmnpqrstvwxyz]{4,6}\s*-->\n?/gi, '');
}

/**
 * Extract every pid currently in a body, in source order. Used by
 * tests + by any future code that wants to enumerate blocks.
 */
export function listPassageIds(body: string): string[] {
  const ids: string[] = [];
  for (const m of body.matchAll(PID_PATTERN_GLOBAL)) ids.push(m[1].toLowerCase());
  return ids;
}
