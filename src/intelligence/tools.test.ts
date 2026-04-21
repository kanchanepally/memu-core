import { describe, expect, it } from 'vitest';
import { interactiveQueryTools, toolSchemas } from './tools';
import type { ToolContext } from './tools';
import { SPACE_CATEGORIES } from '../spaces/model';

const ctx: ToolContext = {
  familyId: 'fam-test',
  profileId: 'prof-test',
  channel: 'mobile',
  messageId: 'msg-test',
};

describe('interactiveQueryTools registry', () => {
  it('exposes the five expected tools', () => {
    expect(Object.keys(interactiveQueryTools).sort()).toEqual([
      'addCalendarEvent',
      'addToList',
      'createSpace',
      'findSpaces',
      'updateSpace',
    ]);
  });

  it('toolSchemas() returns one schema per tool with required Claude fields', () => {
    const schemas = toolSchemas(interactiveQueryTools);
    expect(schemas).toHaveLength(5);
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
