/**
 * Story 3.2 — full Article 20 family export.
 *
 * Builds a ZIP containing data.json, the spaces/ directory mirror, any
 * uploaded attachments, and a README. The shape is the GDPR Article 20
 * "right to data portability" archive — everything Memu knows about
 * the family, in a form they can take to a competitor or read on their
 * own machine.
 *
 * The hash of data.json is recorded in export_log so the family can
 * later prove what they exported and when.
 */

import { promises as fs, createWriteStream, existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import archiver from 'archiver';
import { pool } from '../db/connection';

function spacesRoot(): string {
  return process.env.MEMU_SPACES_ROOT ?? path.resolve(process.cwd(), 'data', 'spaces');
}

function attachmentsRoot(): string {
  return process.env.MEMU_ATTACHMENTS_DIR ?? path.resolve(process.cwd(), 'data', 'attachments');
}

function tmpRoot(): string {
  return process.env.MEMU_TMP_DIR ?? path.resolve(process.cwd(), 'data', 'tmp');
}

export interface ExportArchive {
  zipPath: string;
  bytes: number;
  dataHash: string;
  categoryCounts: Record<string, number>;
}

interface FamilyData {
  exported_at: string;
  family_id: string;
  profile: any;
  personas: any[];
  connected_channels: any[];
  messages: any[];
  stream_cards: any[];
  stream_card_actions: any[];
  synthesis_pages: any[];
  context_entries: any[];
  privacy_ledger: any[];
  twin_registry: any[];
  care_standards: any[];
  domain_states: any[];
  reflection_findings: any[];
}

async function gatherFamilyData(familyId: string): Promise<FamilyData> {
  const profile = await pool.query("SELECT * FROM profiles WHERE id = $1", [familyId]);
  const personas = await pool.query("SELECT * FROM personas WHERE profile_id = $1", [familyId]);
  const channels = await pool.query(
    "SELECT channel, channel_identifier FROM profile_channels WHERE profile_id = $1",
    [familyId],
  );
  const messages = await pool.query(
    "SELECT * FROM messages WHERE profile_id = $1 ORDER BY created_at ASC",
    [familyId],
  );
  const streamCards = await pool.query(
    "SELECT * FROM stream_cards WHERE family_id = $1 ORDER BY created_at ASC",
    [familyId],
  );
  // Stream-card edit history. The actions table records every state
  // transition (created/modified/dismissed/resolved); join in cards
  // owned by this family.
  const cardActions = await pool.query(
    `SELECT a.* FROM actions a
       JOIN stream_cards c ON c.id = a.stream_card_id
      WHERE c.family_id = $1
      ORDER BY a.created_at ASC`,
    [familyId],
  ).catch(() => ({ rows: [] as any[] })); // actions table may not be wired yet

  const synthesisPages = await pool.query(
    "SELECT * FROM synthesis_pages WHERE family_id = $1 OR profile_id = $1",
    [familyId],
  );
  // Embeddings are regenerable; strip them to keep the JSON small and
  // human-readable. text + source + timestamps stay.
  const contextEntries = await pool.query(
    `SELECT id, profile_id, content, source, created_at, owner_profile_id, visibility
       FROM context_entries WHERE profile_id = $1 OR owner_profile_id = $1`,
    [familyId],
  ).catch(() => ({ rows: [] as any[] }));

  const ledger = await pool.query(
    `SELECT * FROM privacy_ledger WHERE family_id = $1 OR profile_id = $1
      ORDER BY created_at ASC`,
    [familyId],
  ).catch(() => ({ rows: [] as any[] }));

  const twin = await pool.query(
    `SELECT id, entity_type, real_name, anonymous_label, detected_by, confirmed,
            first_seen_at, confirmed_at
       FROM entity_registry
      ORDER BY entity_type, anonymous_label`,
  );

  const careStandards = await pool.query(
    `SELECT * FROM care_standards WHERE family_id = $1`,
    [familyId],
  ).catch(() => ({ rows: [] as any[] }));

  const domainStates = await pool.query(
    `SELECT * FROM domain_states WHERE family_id = $1`,
    [familyId],
  ).catch(() => ({ rows: [] as any[] }));

  const reflectionFindings = await pool.query(
    `SELECT * FROM reflection_findings WHERE family_id = $1`,
    [familyId],
  ).catch(() => ({ rows: [] as any[] }));

  return {
    exported_at: new Date().toISOString(),
    family_id: familyId,
    profile: profile.rows[0] ?? null,
    personas: personas.rows,
    connected_channels: channels.rows,
    messages: messages.rows,
    stream_cards: streamCards.rows,
    stream_card_actions: cardActions.rows,
    synthesis_pages: synthesisPages.rows,
    context_entries: contextEntries.rows,
    privacy_ledger: ledger.rows,
    twin_registry: twin.rows,
    care_standards: careStandards.rows,
    domain_states: domainStates.rows,
    reflection_findings: reflectionFindings.rows,
  };
}

function countCategories(data: FamilyData): Record<string, number> {
  return {
    personas: data.personas.length,
    channels: data.connected_channels.length,
    messages: data.messages.length,
    stream_cards: data.stream_cards.length,
    stream_card_actions: data.stream_card_actions.length,
    synthesis_pages: data.synthesis_pages.length,
    context_entries: data.context_entries.length,
    privacy_ledger: data.privacy_ledger.length,
    twin_registry: data.twin_registry.length,
    care_standards: data.care_standards.length,
    domain_states: data.domain_states.length,
    reflection_findings: data.reflection_findings.length,
  };
}

const README_TEMPLATE = (counts: Record<string, number>, hash: string, exportedAt: string) => `# Memu Family Export

This archive is a complete, GDPR Article 20-compliant export of everything Memu
knows about your family.

## Contents

- **data.json** — structured database export. SHA-256: \`${hash}\`
- **spaces/** — human-readable mirror of your compiled understanding (open in Obsidian)
- **attachments/** — uploaded documents, photos, and files (if any)
- **README.md** — this file

## What's in data.json

| Category | Records |
|---|---|
${Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## How to use this archive

- The JSON is structured for re-import into any compatible system.
- The Spaces mirror is plain markdown with YAML frontmatter — open the directory
  as a vault in Obsidian and you'll see the full graph view of your family's
  understanding, with backlinks.
- Embeddings are intentionally excluded from context_entries — they're
  regenerable from the text and they bloat the file enormously.

## Proof of export

This archive was generated at \`${exportedAt}\`. The SHA-256 hash of
\`data.json\` (\`${hash}\`) is recorded in Memu's export_log so you can
later prove what you exported and when.

— Generated by Memu.
`;

export async function buildArticle20Export(familyId: string, actorProfileId?: string): Promise<ExportArchive> {
  const data = await gatherFamilyData(familyId);
  const counts = countCategories(data);

  const dataJsonString = JSON.stringify(data, null, 2);
  const dataHash = crypto.createHash('sha256').update(dataJsonString).digest('hex');
  const readme = README_TEMPLATE(counts, dataHash, data.exported_at);

  const tmp = tmpRoot();
  await fs.mkdir(tmp, { recursive: true });
  const stamp = data.exported_at.replace(/[:.]/g, '-');
  const zipPath = path.join(tmp, `memu-export-${familyId}-${stamp}.zip`);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const zip = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    zip.on('error', reject);
    zip.pipe(output);

    zip.append(dataJsonString, { name: 'data.json' });
    zip.append(readme, { name: 'README.md' });

    const familyDir = path.join(spacesRoot(), familyId);
    if (existsSync(familyDir)) {
      zip.directory(familyDir, 'spaces');
    }
    const attachDir = path.join(attachmentsRoot(), familyId);
    if (existsSync(attachDir)) {
      zip.directory(attachDir, 'attachments');
    }

    zip.finalize();
  });

  const stat = await fs.stat(zipPath);

  await pool.query(
    `INSERT INTO export_log (family_id, actor_profile_id, data_hash, byte_count, category_counts)
     VALUES ($1, $2, $3, $4, $5)`,
    [familyId, actorProfileId ?? null, dataHash, stat.size, JSON.stringify(counts)],
  );
  await pool.query(
    `INSERT INTO spaces_log (family_id, event, summary, actor_profile_id)
     VALUES ($1, 'exported', $2, $3)`,
    [familyId, `Article 20 export (${stat.size} bytes, hash ${dataHash.slice(0, 12)}…)`, actorProfileId ?? null],
  );

  return {
    zipPath,
    bytes: stat.size,
    dataHash,
    categoryCounts: counts,
  };
}

export { countCategories };
