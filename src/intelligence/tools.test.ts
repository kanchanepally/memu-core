import { describe, expect, it } from 'vitest';
import {
  interactiveQueryTools,
  interactiveQueryServerTools,
  toolSchemas,
  mergeSpaceBody,
} from './tools';
import type { ToolContext } from './tools';
import { SPACE_CATEGORIES } from '../spaces/model';

const ctx: ToolContext = {
  familyId: 'fam-test',
  profileId: 'prof-test',
  channel: 'mobile',
  messageId: 'msg-test',
};

describe('interactiveQueryTools registry', () => {
  it('exposes the five expected client-side tools', () => {
    // webSearch migrated to Anthropic server-side tool 2026-04-26 — see
    // `interactiveQueryServerTools` below. Local registry now holds only
    // tools Memu executes in-process.
    expect(Object.keys(interactiveQueryTools).sort()).toEqual([
      'addCalendarEvent',
      'addToList',
      'createSpace',
      'findSpaces',
      'updateSpace',
    ]);
  });

  it('toolSchemas() returns one schema per client-side tool with required Claude fields', () => {
    const schemas = toolSchemas(interactiveQueryTools);
    expect(schemas).toHaveLength(5);
    for (const s of schemas) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.description).toBe('string');
      expect(s.input_schema.type).toBe('object');
      expect(s.input_schema.properties).toBeDefined();
    }
  });

  it('interactiveQueryServerTools exposes web_search with the current Anthropic version', () => {
    expect(interactiveQueryServerTools).toHaveLength(1);
    const ws = interactiveQueryServerTools[0];
    expect(ws.type).toBe('web_search_20260209');
    expect(ws.name).toBe('web_search');
    // max_uses caps a single turn's iterative searching. 2 is enough
    // for "find X then verify a detail" patterns and bounds cost
    // (~$0.02/turn at $10/1000). Was 3 — reduced 2026-04-26 after
    // observing Claude burn all 3 searches then truncate the
    // synthesis (raised-bed search dogfood).
    expect(ws.max_uses).toBe(2);
  });

  it('addToList schema enumerates the allowed list types', () => {
    const schema = interactiveQueryTools.addToList.schema;
    const list = schema.input_schema.properties.list as { enum: string[] };
    expect(list.enum).toEqual(['shopping', 'task']);
    expect(schema.input_schema.required).toEqual(['list', 'items']);
  });

  it('createSpace schema enumerates SPACE_CATEGORIES', () => {
    const schema = interactiveQueryTools.createSpace.schema;
    const cat = schema.input_schema.properties.category as { enum: string[] };
    expect(cat.enum).toEqual([...SPACE_CATEGORIES]);
    expect(schema.input_schema.required).toEqual(['title', 'category', 'body']);
  });

  it('updateSpace schema only requires body (uri or category+slug resolved at runtime)', () => {
    const schema = interactiveQueryTools.updateSpace.schema;
    expect(schema.input_schema.required).toEqual(['body']);
  });

  it('updateSpace schema exposes optional mode with append/replace enum', () => {
    const schema = interactiveQueryTools.updateSpace.schema;
    const mode = schema.input_schema.properties.mode as { enum: string[] };
    expect(mode).toBeDefined();
    expect(mode.enum).toEqual(['append', 'replace']);
  });

  it('updateSpace schema description biases toward append', () => {
    const schema = interactiveQueryTools.updateSpace.schema;
    expect(schema.description).toMatch(/default mode is "append"/i);
    expect(schema.description).toMatch(/when in doubt, append/i);
  });
});

describe('addToList executor — validation branches', () => {
  const exec = interactiveQueryTools.addToList.execute;

  it('rejects missing input object', async () => {
    const r = await exec(null, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing input/i);
  });

  it('rejects an unknown list type', async () => {
    const r = await exec({ list: 'groceries', items: ['milk'] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/list/i);
  });

  it('rejects an empty items array', async () => {
    const r = await exec({ list: 'shopping', items: [] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/items/i);
  });

  it('rejects a non-array items field', async () => {
    const r = await exec({ list: 'shopping', items: 'milk' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/items/i);
  });

  it('rejects when items contain only empty strings', async () => {
    const r = await exec({ list: 'shopping', items: ['   ', ''] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no valid items/i);
  });
});

describe('createSpace executor — validation branches', () => {
  const exec = interactiveQueryTools.createSpace.execute;

  it('rejects missing input object', async () => {
    const r = await exec(null, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing input/i);
  });

  it('rejects missing title', async () => {
    const r = await exec({ category: 'commitment', body: 'body' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/title/i);
  });

  it('rejects whitespace-only title', async () => {
    const r = await exec({ title: '   ', category: 'commitment', body: 'body' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/title/i);
  });

  it('rejects an unknown category', async () => {
    const r = await exec({ title: 'T', category: 'project', body: 'body' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/category/i);
  });

  it('rejects missing body', async () => {
    const r = await exec({ title: 'T', category: 'commitment' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/body/i);
  });
});

describe('updateSpace executor — validation branches', () => {
  const exec = interactiveQueryTools.updateSpace.execute;

  it('rejects missing input object', async () => {
    const r = await exec(null, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing input/i);
  });

  it('rejects missing body', async () => {
    const r = await exec({ uri: 'memu://fam-test/commitment/abc' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/body/i);
  });

  it('rejects empty body', async () => {
    const r = await exec({ uri: 'memu://fam-test/commitment/abc', body: '' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/body/i);
  });

  it('returns "Space not found" when neither uri nor category+slug supplied', async () => {
    const r = await exec({ body: 'new body' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/space not found/i);
  });

  it('returns "Space not found" when only category is supplied without slug', async () => {
    const r = await exec({ category: 'commitment', body: 'new body' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/space not found/i);
  });

  it('returns "Space not found" when only slug is supplied without category', async () => {
    const r = await exec({ slug: 'garden', body: 'new body' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/space not found/i);
  });

  it('rejects an unknown mode value', async () => {
    const r = await exec(
      { uri: 'memu://fam-test/commitment/abc', body: 'new body', mode: 'overwrite' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mode/i);
  });
});

describe('mergeSpaceBody — pure helper', () => {
  const T = '2026-04-26T14:32:00.000Z';

  it('replace mode returns the incoming body verbatim', () => {
    const merged = mergeSpaceBody('old content here', 'NEW', 'replace', T);
    expect(merged).toBe('NEW');
  });

  it('replace mode works on empty existing body', () => {
    expect(mergeSpaceBody('', 'NEW', 'replace', T)).toBe('NEW');
  });

  it('append mode preserves existing content', () => {
    const merged = mergeSpaceBody('Line one.\nLine two.', 'Line three.', 'append', T);
    expect(merged).toContain('Line one.');
    expect(merged).toContain('Line two.');
    expect(merged).toContain('Line three.');
  });

  it('append mode places new content AFTER existing content', () => {
    const merged = mergeSpaceBody('OLD', 'NEW', 'append', T);
    const oldIdx = merged.indexOf('OLD');
    const newIdx = merged.indexOf('NEW');
    expect(oldIdx).toBeLessThan(newIdx);
  });

  it('append mode inserts a dated separator', () => {
    const merged = mergeSpaceBody('OLD', 'NEW', 'append', T);
    expect(merged).toContain('---');
    expect(merged).toContain('Updated 2026-04-26 14:32');
  });

  it('append mode trims trailing whitespace from existing before joining', () => {
    const merged = mergeSpaceBody('OLD\n\n\n\n', 'NEW', 'append', T);
    // No more than one consecutive blank line between OLD and the separator.
    expect(merged).not.toMatch(/OLD\n\n\n+---/);
    expect(merged).toContain('OLD\n\n---');
  });

  it('append mode on empty existing body returns the incoming body without separator', () => {
    expect(mergeSpaceBody('', 'NEW', 'append', T)).toBe('NEW');
  });

  it('append mode on whitespace-only existing body returns the incoming body without separator', () => {
    expect(mergeSpaceBody('   \n\n  \t\n', 'NEW', 'append', T)).toBe('NEW');
  });

  it('append is non-destructive across many successive updates', () => {
    let body = '';
    body = mergeSpaceBody(body, 'first', 'append', '2026-04-26T10:00:00.000Z');
    body = mergeSpaceBody(body, 'second', 'append', '2026-04-26T11:00:00.000Z');
    body = mergeSpaceBody(body, 'third', 'append', '2026-04-26T12:00:00.000Z');
    expect(body).toContain('first');
    expect(body).toContain('second');
    expect(body).toContain('third');
    // Three updates → two separators (first update wrote no separator).
    const separatorCount = (body.match(/---\n_Updated /g) ?? []).length;
    expect(separatorCount).toBe(2);
  });
});

describe('findSpaces schema', () => {
  it('declares query as the only required field', () => {
    const schema = interactiveQueryTools.findSpaces.schema;
    expect(schema.input_schema.required).toEqual(['query']);
  });

  it('optional category enumerates SPACE_CATEGORIES', () => {
    const schema = interactiveQueryTools.findSpaces.schema;
    const cat = schema.input_schema.properties.category as { enum: string[] };
    expect(cat.enum).toEqual([...SPACE_CATEGORIES]);
  });
});

describe('findSpaces executor — validation branches', () => {
  const exec = interactiveQueryTools.findSpaces.execute;

  it('rejects missing input object', async () => {
    const r = await exec(null, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing input/i);
  });

  it('rejects missing query', async () => {
    const r = await exec({}, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/query/i);
  });

  it('rejects whitespace-only query', async () => {
    const r = await exec({ query: '   ' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/query/i);
  });

  it('rejects an unknown category', async () => {
    const r = await exec({ query: 'robin', category: 'project' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/category/i);
  });
});

describe('addCalendarEvent schema', () => {
  it('requires title + start + end', () => {
    const schema = interactiveQueryTools.addCalendarEvent.schema;
    expect(schema.input_schema.required).toEqual(['title', 'start', 'end']);
  });

  it('exposes optional location and notes', () => {
    const schema = interactiveQueryTools.addCalendarEvent.schema;
    expect(schema.input_schema.properties.location).toBeDefined();
    expect(schema.input_schema.properties.notes).toBeDefined();
  });
});

describe('addCalendarEvent executor — validation branches', () => {
  const exec = interactiveQueryTools.addCalendarEvent.execute;

  it('rejects missing input object', async () => {
    const r = await exec(null, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing input/i);
  });

  it('rejects missing title', async () => {
    const r = await exec(
      { start: '2026-04-22T15:00:00+01:00', end: '2026-04-22T16:00:00+01:00' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/title/i);
  });

  it('rejects whitespace-only title', async () => {
    const r = await exec(
      { title: '   ', start: '2026-04-22T15:00:00+01:00', end: '2026-04-22T16:00:00+01:00' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/title/i);
  });

  it('rejects missing start/end', async () => {
    const r = await exec({ title: 'Dentist' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/start.*end/i);
  });

  // DB-touching happy / insert paths (not_connected, invalid_time,
  // insufficient_scope) covered by manual QA against Z2, per the project
  // convention also used by the updateSpace tests above.
});

// webSearch is now an Anthropic server-side tool (`web_search_20260209`).
// Its schema lives in `interactiveQueryServerTools` (see registry tests
// above). Privacy invariant — anonymous tokens must not reach the search
// engine — is now enforced at the prompt level via the SKILL.md
// description warning Claude off Twin tokens, rather than a regex
// reject in a local executor. Server-side tools have no local
// `execute()`; Anthropic resolves them on their infrastructure and the
// router synthesises a ToolCallLogEntry from `server_tool_use` blocks
// in the response (see `collectServerToolCalls` in router.ts and its
// tests).
