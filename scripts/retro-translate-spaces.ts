/**
 * Retrospective de-anonymisation of existing Spaces (Bug 1 fix, 2026-04-19).
 *
 * The synthesis write path previously passed LLM output straight to
 * upsertSpace without running translateToReal. Every Space created before
 * the synthesis.ts fix landed carries anonymous labels in its title,
 * description, body, people[], and tags[] — e.g. "Family-177661940667O-0 (Wife)"
 * instead of "Rach (Wife)". This script walks every synthesis_pages row
 * and rewrites the offending fields in place.
 *
 * Why UPDATE by id (not upsertSpace):
 *   upsertSpace keys on (family_id, category, slug). If the translated
 *   title differs from the original, slugify(newTitle) !== oldSlug, so
 *   upsertSpace would mint a NEW row and leave the broken one behind.
 *   The retrospective must preserve id/uri/slug so existing inbound
 *   references (source_references, spaces_log, git history) stay valid.
 *
 * What it does per row:
 *   1. translateToReal on title, description, body_markdown.
 *   2. translateToReal on each element of people[] and tags[].
 *   3. UPDATE synthesis_pages SET ... WHERE id = $1 — preserves slug/uri.
 *   4. Rewrite the on-disk .md at its existing filesystem path using the
 *      same gray-matter frontmatter shape store.ts writes.
 *   5. Append a line to _log.md describing the retrospective fix.
 *   6. git commit attributed to "Memu Migration <memu@localhost>".
 *
 * Usage (inside the memu_core container on Z2):
 *   docker exec -it memu_core_standalone_api npx tsx scripts/retro-translate-spaces.ts
 *
 * Idempotent: running twice is a no-op because translateToReal on a
 * fully-real string doesn't match any anonymous labels.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import matter from 'gray-matter';
import { pool } from '../src/db/connection';
import { translateToReal } from '../src/twin/translator';

interface SpaceRow {
  id: string;
  family_id: string;
  uri: string;
  slug: string;
  category: string;
  title: string;
  body_markdown: string;
  description: string;
  domains: string[];
  people: string[];
  visibility: string;
  confidence: string;
  source_references: string[];
  tags: string[];
  last_updated_at: Date;
}

function spacesRoot(): string {
  return process.env.MEMU_SPACES_ROOT ?? path.resolve(process.cwd(), 'data', 'spaces');
}

function familyDir(familyId: string): string {
  return path.join(spacesRoot(), familyId);
}

function filePath(familyId: string, category: string, slug: string): string {
  return path.join(familyDir(familyId), `${category}s`, `${slug}.md`);
}

function logPath(familyId: string): string {
  return path.join(familyDir(familyId), '_log.md');
}

async function translateArray(arr: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(arr)) return [];
  return Promise.all(arr.map(v => translateToReal(v)));
}

function rowChanged(before: SpaceRow, after: {
  title: string;
  description: string;
  body_markdown: string;
  people: string[];
  tags: string[];
}): boolean {
  if (before.title !== after.title) return true;
  if ((before.description ?? '') !== after.description) return true;
  if (before.body_markdown !== after.body_markdown) return true;
  if (JSON.stringify(before.people ?? []) !== JSON.stringify(after.people)) return true;
  if (JSON.stringify(before.tags ?? []) !== JSON.stringify(after.tags)) return true;
  return false;
}

function parseVisibility(stored: string): string | string[] {
  if (stored && stored.startsWith('[')) {
    try {
      return JSON.parse(stored) as string[];
    } catch {
      return 'family';
    }
  }
  return stored || 'family';
}

function renderFrontmatter(row: SpaceRow, translated: {
  title: string;
  description: string;
  body_markdown: string;
  people: string[];
  tags: string[];
}): string {
  const fm = {
    id: row.uri,
    name: translated.title,
    category: row.category,
    domains: row.domains ?? [],
    people: translated.people,
    visibility: parseVisibility(row.visibility),
    description: translated.description,
    confidence: Number(row.confidence),
    last_updated: new Date().toISOString(),
    source_references: row.source_references ?? [],
    tags: translated.tags,
  };
  const body = translated.body_markdown.endsWith('\n')
    ? translated.body_markdown
    : `${translated.body_markdown}\n`;
  return matter.stringify(body, fm);
}

async function rewriteDisk(row: SpaceRow, translated: {
  title: string;
  description: string;
  body_markdown: string;
  people: string[];
  tags: string[];
}): Promise<void> {
  const dir = familyDir(row.family_id);
  try {
    await fs.access(path.join(dir, '.git'));
  } catch {
    console.warn(`[RETRO] no git repo at ${dir} — skipping disk rewrite for ${row.uri}`);
    return;
  }

  const target = filePath(row.family_id, row.category, row.slug);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, renderFrontmatter(row, translated), 'utf8');

  const logLine = `- ${new Date().toISOString()} · updated · [[${row.slug}]] (${row.category}) · retrospective de-anonymisation\n`;
  await fs.appendFile(logPath(row.family_id), logLine, 'utf8');

  const relFile = path.relative(dir, target);
  const relLog = path.relative(dir, logPath(row.family_id));
  try {
    execFileSync('git', ['add', '--', relFile, relLog], { cwd: dir, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        'commit', '-q',
        '-m', `Retrospective de-anonymisation of ${row.category}/${row.slug}.md`,
        '--author', 'Memu Migration <memu@localhost>',
      ],
      { cwd: dir, stdio: 'ignore' },
    );
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (!/nothing to commit/i.test(msg)) {
      console.warn(`[RETRO] git commit non-fatal for ${row.uri}:`, msg);
    }
  }
}

async function main() {
  console.log('[RETRO] Starting retrospective de-anonymisation of Spaces.');
  console.log(`[RETRO] MEMU_SPACES_ROOT = ${spacesRoot()}`);

  const { rows } = await pool.query<SpaceRow>(
    `SELECT id, family_id, uri, slug, category, title, body_markdown,
            description, domains, people, visibility, confidence,
            source_references, tags, last_updated_at
       FROM synthesis_pages
      ORDER BY family_id, category, slug`,
  );

  console.log(`[RETRO] Loaded ${rows.length} Space rows.`);

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const translated = {
        title: await translateToReal(row.title ?? ''),
        description: await translateToReal(row.description ?? ''),
        body_markdown: await translateToReal(row.body_markdown ?? ''),
        people: await translateArray(row.people),
        tags: await translateArray(row.tags),
      };

      if (!rowChanged(row, translated)) {
        unchanged++;
        continue;
      }

      await pool.query(
        `UPDATE synthesis_pages
            SET title = $1,
                description = $2,
                body_markdown = $3,
                people = $4,
                tags = $5,
                last_updated_at = NOW()
          WHERE id = $6`,
        [
          translated.title,
          translated.description,
          translated.body_markdown,
          translated.people,
          translated.tags,
          row.id,
        ],
      );

      await pool.query(
        `INSERT INTO spaces_log (family_id, space_uri, event, summary, actor_profile_id)
         VALUES ($1, $2, 'updated', $3, NULL)`,
        [
          row.family_id,
          row.uri,
          `Retrospective de-anonymisation of ${row.category} "${translated.title}"`,
        ],
      );

      await rewriteDisk(row, translated);

      updated++;
      console.log(`[RETRO] ✓ ${row.category}/${row.slug} — "${row.title}" → "${translated.title}"`);
    } catch (err) {
      failed++;
      console.error(`[RETRO] ✗ ${row.category}/${row.slug}:`, (err as Error).message);
    }
  }

  console.log(`[RETRO] Done. updated=${updated} unchanged=${unchanged} failed=${failed} total=${rows.length}`);
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('[RETRO] Fatal:', err);
  process.exit(1);
});
