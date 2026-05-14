/**
 * CLI: npm run eval:replay -- --collective <id> --viewer <profile_id>
 *
 * Loads ./eval/golden/*.md, runs every query through the real retrieval
 * pipeline under the given collective context, prints a per-query pass/fail
 * line plus aggregate recall %. Exits non-zero if any query failed (useful
 * for CI; the nightly cron in Task 8 ignores the exit code).
 */
import { resolve } from 'node:path';
import { enterCollectiveContext } from '../db/tenant';
import { loadGoldenQueries } from './golden';
import { replayAll } from './replay';

function parseArgs(argv: string[]): { collective: string; viewer: string; dir: string } {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) { args.set(k, v); i++; }
    }
  }
  const collective = args.get('collective') ?? process.env.MEMU_EVAL_COLLECTIVE_ID;
  const viewer = args.get('viewer') ?? process.env.MEMU_EVAL_VIEWER_PROFILE_ID ?? collective;
  const dir = args.get('dir') ?? resolve(process.cwd(), 'eval/golden');
  if (!collective) {
    throw new Error('Usage: --collective <id> [--viewer <profile_id>] [--dir <path>]');
  }
  return { collective, viewer: viewer!, dir };
}

async function main() {
  const { collective, viewer, dir } = parseArgs(process.argv.slice(2));
  const queries = loadGoldenQueries(dir);
  if (queries.length === 0) {
    console.error(`[eval] no golden queries found in ${dir}`);
    process.exit(2);
  }

  const result = await enterCollectiveContext(collective, async () => {
    return await replayAll(queries, { collectiveId: collective, viewerProfileId: viewer });
  });

  for (const d of result.diffs) {
    const tag = d.passed ? 'PASS' : 'FAIL';
    const reasons: string[] = [];
    if (d.missingUris.length) reasons.push(`missing ${d.missingUris.length}`);
    if (d.extraUris.length) reasons.push(`extra ${d.extraUris.length}`);
    if (d.stateMismatch) reasons.push(`state: expected=${d.expectedRetrievalState} actual=${d.actualRetrievalState}/${d.actualRetrievalPath}`);
    console.log(`[${tag}] ${d.id}  ${reasons.length ? '— ' + reasons.join('; ') : ''}`);
  }
  console.log('');
  console.log(`recall: ${result.recallPercent}%  (${result.passed}/${result.total})`);
  console.log(`by state: sourced ${result.byState.sourced.passed}/${result.byState.sourced.total} · fallback ${result.byState.fallback.passed}/${result.byState.fallback.total} · empty ${result.byState.empty.passed}/${result.byState.empty.total}`);

  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[eval] fatal:', err);
  process.exit(2);
});
