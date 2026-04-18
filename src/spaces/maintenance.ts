/**
 * Story 3.1 — periodic maintenance on the per-family spaces repos.
 *
 * `git gc` repacks loose objects so the repo doesn't grow unbounded
 * across years of synthesis writes. Snapshot is the on-demand
 * tarball-the-whole-thing operation behind /api/spaces/snapshot.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { pool } from '../db/connection';

const execFileAsync = promisify(execFile);

function spacesRoot(): string {
  return process.env.MEMU_SPACES_ROOT ?? path.resolve(process.cwd(), 'data', 'spaces');
}

function familyDir(familyId: string): string {
  return path.join(spacesRoot(), familyId);
}

async function listFamilyDirs(): Promise<string[]> {
  const root = spacesRoot();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export interface GcResult {
  familyId: string;
  ok: boolean;
  message?: string;
}

export async function gcFamilyRepo(familyId: string): Promise<GcResult> {
  const dir = familyDir(familyId);
  const gitDir = path.join(dir, '.git');
  try {
    await fs.access(gitDir);
  } catch {
    return { familyId, ok: false, message: 'no .git directory' };
  }
  try {
    await execFileAsync('git', ['gc', '--quiet', '--auto'], { cwd: dir });
    return { familyId, ok: true };
  } catch (err) {
    return { familyId, ok: false, message: (err as Error).message };
  }
}

export async function gcAllFamilyRepos(): Promise<GcResult[]> {
  const families = await listFamilyDirs();
  const results: GcResult[] = [];
  for (const familyId of families) {
    results.push(await gcFamilyRepo(familyId));
  }
  return results;
}

/**
 * Produce a tarball of the family's full spaces directory, including
 * .git/. Returns the absolute path of the temp file written. Caller
 * is responsible for streaming + deleting it.
 */
export async function snapshotFamilyRepo(familyId: string): Promise<{ tarPath: string; bytes: number }> {
  const dir = familyDir(familyId);
  try {
    await fs.access(dir);
  } catch {
    throw new Error(`No spaces directory for family ${familyId}`);
  }

  const tmpRoot = process.env.MEMU_TMP_DIR ?? path.resolve(process.cwd(), 'data', 'tmp');
  await fs.mkdir(tmpRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tarPath = path.join(tmpRoot, `spaces-${familyId}-${stamp}.tar.gz`);

  // Use `tar` to stream the directory. Spaces directory shape is small
  // (kilobytes typically), so synchronous is fine.
  execFileSync(
    'tar',
    ['-czf', tarPath, '-C', spacesRoot(), familyId],
    { stdio: 'ignore' },
  );

  const stat = await fs.stat(tarPath);

  await pool.query(
    `INSERT INTO spaces_log (family_id, event, summary)
     VALUES ($1, 'snapshot', $2)`,
    [familyId, `Snapshot taken (${stat.size} bytes)`],
  );

  return { tarPath, bytes: stat.size };
}
