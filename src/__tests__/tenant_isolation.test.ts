import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Static guardrail: every mutating SQL on a tenant-scoped table in
 * `src/index.ts` MUST include a `family_id = $X` (or `profile_id = $X`)
 * filter so a leaked / guessed entity ID can't be used to reach across
 * tenants.
 *
 * The four leaks fixed 2026-05-06 (resolveStreamCard, dismissStreamCard,
 * editStreamCard, calendar/add SELECT) all followed the identical pattern:
 * mutation by `id` alone with no family_id check. This test would have
 * caught all four. It's deliberately string-based because the route
 * handlers are inline `server.post(...)` blocks and not easily refactored
 * to take an injectable pool. A regex over the file source is the
 * lightest possible signal.
 *
 * What this test does NOT cover:
 *   - Queries inside `src/lists/store.ts`, `src/spaces/store.ts`, etc —
 *     those take an explicit familyId arg and the handlers verify it.
 *   - SELECT-only queries that don't mutate (low-impact leaks read-only).
 *   - JOINs that scope by a different table's family_id.
 *
 * The point is to anchor the high-risk mutation pattern that already broke
 * once. New endpoints added in the future should land safely under this.
 */

const indexSource = fs.readFileSync(
  path.join(__dirname, '..', 'index.ts'),
  'utf8',
);

// Tables that hold tenant-scoped rows. If a future migration adds a new one,
// add it here so this test covers it too.
const SCOPED_TABLES = [
  'stream_cards',
  'list_items',
  'synthesis_pages',
  'conversations',
  'messages',
  'push_tokens',
  'inbox_messages',
  'domain_states',
  'care_standards',
  'context_entries',
];

function findStatements(verb: 'UPDATE' | 'DELETE FROM' | 'INSERT INTO', table: string): string[] {
  // Match "UPDATE stream_cards ..." up to the next semicolon-or-quote
  // closing the SQL string. Greedy enough to capture the full WHERE clause
  // when one exists. Multi-line SQL is preserved.
  const re = new RegExp(`${verb}\\s+${table}[\\s\\S]+?(?=\`|"\\s*,)`, 'g');
  const matches = indexSource.match(re);
  return matches ?? [];
}

function findSelectStarStatements(table: string): string[] {
  // Specifically catch `SELECT * FROM <table> WHERE id = $1` — the calendar/add
  // bug pattern. SELECTs that filter only by id can leak content cross-tenant.
  const re = new RegExp(`SELECT\\s+\\*\\s+FROM\\s+${table}[\\s\\S]+?(?=\`|"\\s*,)`, 'g');
  const matches = indexSource.match(re);
  return matches ?? [];
}

describe('tenant isolation — src/index.ts', () => {
  // Regex piece that matches either a literal Postgres placeholder ($N)
  // OR a TypeScript template-literal interpolation that resolves to one
  // ($${someVar}). Some routes build the placeholder index dynamically
  // (e.g. variable-shape UPDATE on stream_cards), so a strict $\d+ match
  // would false-positive on those.
  const PLACEHOLDER = String.raw`(\$\d+|\$\$\{[^}]+\})`;
  const familyScoped = new RegExp(String.raw`\bfamily_id\s*=\s*` + PLACEHOLDER);
  const profileScoped = new RegExp(String.raw`\bprofile_id\s*=\s*` + PLACEHOLDER);

  // Match `id = $N` / `id = $${var}` / `id = ANY($N)` — the entity-by-id
  // patterns that need tenant scoping. Bulk maintenance updates that target
  // by status / time / column-list (e.g. the 04:30 auto-expire cron sweeping
  // active cards older than 14 days across ALL families) are intentionally
  // cross-tenant server-side jobs and don't carry an entity id.
  const targetsById = new RegExp(
    String.raw`\bid\s*=\s*` + PLACEHOLDER + String.raw`|\bid\s+IN\s*\(|\bid\s*=\s*ANY\(`,
  );

  for (const table of SCOPED_TABLES) {
    it(`every entity-by-id UPDATE on ${table} scopes by family_id or profile_id`, () => {
      const updates = findStatements('UPDATE', table);
      for (const stmt of updates) {
        // Only flag UPDATEs that target a specific row (or rows) by id —
        // those are the API-exposed mutation pattern that needs scoping.
        // Bulk status/time-driven maintenance runs without an id are
        // out of scope (and would break the cron pattern if forced).
        if (!targetsById.test(stmt)) continue;
        const ok = familyScoped.test(stmt) || profileScoped.test(stmt);
        expect(
          ok,
          `UPDATE on ${table} targets an id without family_id/profile_id scope:\n${stmt.slice(0, 240)}…`,
        ).toBe(true);
      }
    });

    it(`every entity-by-id DELETE on ${table} scopes by family_id or profile_id`, () => {
      const deletes = findStatements('DELETE FROM', table);
      for (const stmt of deletes) {
        if (!targetsById.test(stmt)) continue;
        const ok = familyScoped.test(stmt) || profileScoped.test(stmt);
        expect(
          ok,
          `DELETE on ${table} targets an id without family_id/profile_id scope:\n${stmt.slice(0, 240)}…`,
        ).toBe(true);
      }
    });
  }

  it('SELECT * FROM stream_cards always scopes by family_id', () => {
    const selects = findSelectStarStatements('stream_cards');
    for (const stmt of selects) {
      const hasFamily = familyScoped.test(stmt);
      expect(
        hasFamily,
        `SELECT * FROM stream_cards must include family_id check:\n${stmt.slice(0, 240)}…`,
      ).toBe(true);
    }
  });
});
