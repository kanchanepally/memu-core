import { describe, expect, it } from 'vitest';
import { formatToolSummaryFooter } from './toolSummary';
import type { ToolCallLogEntry } from '../skills/router';

describe('formatToolSummaryFooter — empty / no-op cases', () => {
  it('returns empty string for undefined toolCalls', () => {
    expect(formatToolSummaryFooter(undefined)).toBe('');
  });

  it('returns empty string for empty toolCalls', () => {
    expect(formatToolSummaryFooter([])).toBe('');
  });

  it('returns empty string when only findSpaces fired (internal navigation, not surfaced)', () => {
    const calls: ToolCallLogEntry[] = [
      { name: 'findSpaces', ok: true, output: { count: 2, spaces: [] } },
    ];
    expect(formatToolSummaryFooter(calls)).toBe('');
  });

  it('returns empty string when addToList succeeded but added zero items', () => {
    const calls: ToolCallLogEntry[] = [
      { name: 'addToList', ok: true, output: { list: 'shopping', added: 0, requested: 0 } },
    ];
    expect(formatToolSummaryFooter(calls)).toBe('');
  });
});

describe('formatToolSummaryFooter — single ok tool', () => {
  it('addToList — singular shopping', () => {
    const out = formatToolSummaryFooter([
      { name: 'addToList', ok: true, output: { list: 'shopping', added: 1, requested: 1 } },
    ]);
    expect(out).toContain('added 1 item to shopping list');
    expect(out).toMatch(/^\n\n---\n_Memu just: /);
    expect(out).toMatch(/_\n$/);
  });

  it('addToList — plural shopping', () => {
    const out = formatToolSummaryFooter([
      { name: 'addToList', ok: true, output: { list: 'shopping', added: 3, requested: 3 } },
    ]);
    expect(out).toContain('added 3 items to shopping list');
  });

  it('addToList — task list', () => {
    const out = formatToolSummaryFooter([
      { name: 'addToList', ok: true, output: { list: 'task', added: 2, requested: 2 } },
    ]);
    expect(out).toContain('added 2 items to task list');
  });

  it('createSpace', () => {
    const out = formatToolSummaryFooter([
      {
        name: 'createSpace',
        ok: true,
        output: { id: 'x', uri: 'memu://...', slug: 'climbing-frame', category: 'commitment' },
      },
    ]);
    expect(out).toContain('created a Space');
  });

  it('updateSpace — append mode shows linesAdded', () => {
    const out = formatToolSummaryFooter([
      {
        name: 'updateSpace',
        ok: true,
        output: {
          id: 'x',
          uri: 'memu://...',
          slug: 'robin',
          category: 'person',
          action: 'appended',
          linesBefore: 5,
          linesAfter: 8,
          linesAdded: 3,
        },
      },
    ]);
    expect(out).toContain('appended 3 lines to a Space');
  });

  it('updateSpace — append mode singular line', () => {
    const out = formatToolSummaryFooter([
      {
        name: 'updateSpace',
        ok: true,
        output: { action: 'appended', linesAdded: 1 },
      },
    ]);
    expect(out).toContain('appended 1 line to a Space');
  });

  it('updateSpace — replace mode names the prior content explicitly', () => {
    const out = formatToolSummaryFooter([
      {
        name: 'updateSpace',
        ok: true,
        output: { action: 'replaced', linesBefore: 12, linesAfter: 4, linesAdded: 0 },
      },
    ]);
    expect(out).toContain('replaced a Space');
    expect(out).toMatch(/prior content/i);
    expect(out).toMatch(/git history/i);
  });

  it('addCalendarEvent', () => {
    const out = formatToolSummaryFooter([
      { name: 'addCalendarEvent', ok: true, output: { eventId: 'abc', htmlLink: 'https://...' } },
    ]);
    expect(out).toContain('added an event to your calendar');
  });

  it('webSearch', () => {
    const out = formatToolSummaryFooter([
      { name: 'webSearch', ok: true, output: { results: [] } },
    ]);
    expect(out).toContain('searched the web');
  });
});

describe('formatToolSummaryFooter — failures', () => {
  it('addToList failure surfaces with warning marker and reason', () => {
    const out = formatToolSummaryFooter([
      { name: 'addToList', ok: false, error: 'insert failed' },
    ]);
    expect(out).toContain('⚠');
    expect(out).toMatch(/couldn't add to your list/);
    expect(out).toContain('insert failed');
  });

  it('webSearch failure', () => {
    const out = formatToolSummaryFooter([
      { name: 'webSearch', ok: false, error: 'no_results' },
    ]);
    expect(out).toContain('⚠');
    expect(out).toMatch(/web search failed/);
  });

  it('failure without error string still renders the warning', () => {
    const out = formatToolSummaryFooter([
      { name: 'updateSpace', ok: false },
    ]);
    expect(out).toContain('⚠');
    expect(out).toMatch(/couldn't update a Space/);
  });

  it('findSpaces failure IS surfaced (unlike successful findSpaces)', () => {
    const out = formatToolSummaryFooter([
      { name: 'findSpaces', ok: false, error: 'catalogue load failed' },
    ]);
    expect(out).toContain('⚠');
    expect(out).toMatch(/Space search failed/);
  });
});

describe('formatToolSummaryFooter — multiple tools', () => {
  it('joins with middot separator', () => {
    const out = formatToolSummaryFooter([
      { name: 'addToList', ok: true, output: { list: 'shopping', added: 1 } },
      {
        name: 'createSpace',
        ok: true,
        output: { id: 'x', uri: 'memu://...', slug: 's', category: 'commitment' },
      },
    ]);
    expect(out).toContain(' · ');
    expect(out).toContain('added 1 item to shopping list');
    expect(out).toContain('created a Space');
  });

  it('orders successes before failures', () => {
    const out = formatToolSummaryFooter([
      { name: 'addToList', ok: false, error: 'boom' },
      { name: 'createSpace', ok: true, output: { id: 'x' } },
    ]);
    const okIdx = out.indexOf('created a Space');
    const failIdx = out.indexOf('⚠');
    expect(okIdx).toBeGreaterThan(0);
    expect(failIdx).toBeGreaterThan(okIdx);
  });

  it('skips findSpaces success but keeps the rest', () => {
    const out = formatToolSummaryFooter([
      { name: 'findSpaces', ok: true, output: { count: 1, spaces: [] } },
      { name: 'addToList', ok: true, output: { list: 'shopping', added: 1 } },
    ]);
    expect(out).not.toContain('found');
    expect(out).not.toContain('Space search');
    expect(out).toContain('added 1 item to shopping list');
    // Single clause, so no separator.
    expect(out).not.toContain(' · ');
  });
});

describe('formatToolSummaryFooter — privacy invariant', () => {
  // The footer is built from `output` fields that the executors
  // deliberately keep structural (counts / actions / IDs / slugs) — never
  // real names, never user-supplied free text. This test pins the
  // discipline: even if a hostile or sloppy output payload includes
  // real-name-shaped fields, the formatter must NOT echo them.
  it('does not echo arbitrary free-text fields from output', () => {
    const out = formatToolSummaryFooter([
      {
        name: 'addToList',
        ok: true,
        output: {
          list: 'shopping',
          added: 1,
          // Fields the formatter must ignore even if present:
          item_text: 'Robin Smith',
          user_name: 'Hareesh',
          notes: 'private medical info',
        },
      },
    ]);
    expect(out).not.toContain('Robin');
    expect(out).not.toContain('Hareesh');
    expect(out).not.toContain('private medical info');
    // But it does still surface the structural summary.
    expect(out).toContain('added 1 item to shopping list');
  });

  it('updateSpace summary does not echo title/slug even if present in output', () => {
    const out = formatToolSummaryFooter([
      {
        name: 'updateSpace',
        ok: true,
        output: {
          slug: 'robin-smith',
          title: 'Robin Smith',
          category: 'person',
          action: 'appended',
          linesAdded: 2,
        },
      },
    ]);
    expect(out).not.toContain('robin');
    expect(out).not.toContain('Robin');
    expect(out).not.toContain('Smith');
    expect(out).toContain('appended 2 lines to a Space');
  });
});

describe('formatToolSummaryFooter — output shape', () => {
  it('starts with horizontal rule separator and ends with newline', () => {
    const out = formatToolSummaryFooter([
      { name: 'addToList', ok: true, output: { list: 'shopping', added: 1 } },
    ]);
    expect(out.startsWith('\n\n---\n')).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('wraps the summary line in italics with "Memu just:" prefix', () => {
    const out = formatToolSummaryFooter([
      { name: 'addToList', ok: true, output: { list: 'shopping', added: 1 } },
    ]);
    expect(out).toMatch(/_Memu just: /);
    expect(out).toMatch(/_\n$/);
  });

  it('does NOT match the listReconciler regex pattern (regression guard)', () => {
    // The list reconciler scans assistant replies for "added X to your
    // shopping list" patterns to retroactively persist items. The footer's
    // wording must NOT match that regex, otherwise every footer mention
    // of an addToList success would trigger a duplicate insert. The
    // reconciler regex requires `to (the|your|our) (shopping|...)` — the
    // footer's deliberate omission of the determiner ("to shopping list",
    // not "to your shopping list") keeps it safe. Lock that in.
    const out = formatToolSummaryFooter([
      { name: 'addToList', ok: true, output: { list: 'shopping', added: 1 } },
    ]);
    // Mirror of the actual reconciler regex (simplified — the real one is
    // in src/intelligence/listReconciler.ts).
    const reconcilerLike = /(?:added|put)\s+(.+?)\s+(?:to|on|onto)\s+(?:the|your|our)\s+(?:shopping|grocery|groceries|market|task|to-?do|todo)/i;
    expect(out).not.toMatch(reconcilerLike);
  });
});
