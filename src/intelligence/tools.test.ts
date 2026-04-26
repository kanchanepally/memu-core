import { describe, expect, it } from 'vitest';
import { interactiveQueryTools, toolSchemas, mergeSpaceBody } from './tools';
import type { ToolContext } from './tools';
import { SPACE_CATEGORIES } from '../spaces/model';

const ctx: ToolContext = {
  familyId: 'fam-test',
  profileId: 'prof-test',
  channel: 'mobile',
  messageId: 'msg-test',
};

describe('interactiveQueryTools registry', () => {
  it('exposes the six expected tools', () => {
    expect(Object.keys(interactiveQueryTools).sort()).toEqual([
      'addCalendarEvent',
      'addToList',
      'createSpace',
      'findSpaces',
      'updateSpace',
      'webSearch',
    ]);
  });

  it('toolSchemas() returns one schema per tool with required Claude fields', () => {
    const schemas = toolSchemas(interactiveQueryTools);
    expect(schemas).toHaveLength(6);
    for (const s of schemas) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.description).toBe('string');
      expect(s.input_schema.type).toBe('object');
      expect(s.input_schema.properties).toBeDefined();
    }
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

describe('webSearch schema', () => {
  it('declares query as the only required field', () => {
    const schema = interactiveQueryTools.webSearch.schema;
    expect(schema.input_schema.required).toEqual(['query']);
  });

  it('description warns Claude off anonymous tokens', () => {
    const schema = interactiveQueryTools.webSearch.schema;
    expect(schema.description).toMatch(/anonymous token/i);
  });
});

describe('webSearch executor — validation branches', () => {
  const exec = interactiveQueryTools.webSearch.execute;

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

  // Privacy invariant: anonymous tokens (Adult-N, Child-N, Person-N, Place-N,
  // Institution-N, Detail-N) must never reach the public search engine.
  // Refuse rather than leak — translateToReal would defeat the Twin.
  it('rejects query containing an Adult-N token', async () => {
    const r = await exec({ query: 'carpet cleaner near Adult-1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/anonymous token/i);
  });

  it('rejects query containing a Child-N token', async () => {
    const r = await exec({ query: 'Child-2 birthday party ideas' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/anonymous token/i);
  });

  it('rejects query containing a Person-N token', async () => {
    const r = await exec({ query: 'gift for Person-3' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/anonymous token/i);
  });

  it('rejects query containing a Place-N token', async () => {
    const r = await exec({ query: 'restaurants near Place-1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/anonymous token/i);
  });

  it('rejects query containing an Institution-N token', async () => {
    const r = await exec({ query: 'term dates Institution-2' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/anonymous token/i);
  });

  it('rejects query containing a Detail-N token', async () => {
    const r = await exec({ query: 'Detail-4 specifications' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/anonymous token/i);
  });

  // Network-touching happy path (DDG Lite scrape, no_results, fetch errors)
  // covered by manual QA, same convention as the addCalendarEvent tests above.
});
