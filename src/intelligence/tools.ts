/**
 * Interactive-query tool-use wire-up.
 *
 * Claude can now invoke these three functions mid-turn from the
 * `interactive_query` skill instead of relying on a post-reply regex
 * reconciler to paper over hallucinated confirmations. Tool execution
 * is the source of truth; a successful tool call is the confirmation
 * Claude then reports to the user.
 *
 * Flow (per interactive_query turn):
 *   1. Orchestrator calls dispatch({ skill: 'interactive_query', tools: interactiveQueryTools })
 *   2. Claude receives anonymised prompt + tool schemas
 *   3. If Claude emits tool_use blocks, the router executes each one
 *      via `execute()` and feeds tool_result blocks back to Claude
 *   4. Final assistant message (stop_reason='end_turn') is returned
 *
 * Privacy invariant: Claude always operates in the anonymous namespace.
 *   - Inputs arrive from Claude in anonymous form (e.g. "Adult-1's garden")
 *   - Executors run `translateToReal()` on user-facing strings before
 *     persisting to the DB, so what the family sees is real names
 *   - Outputs returned to Claude stay structural (ok/id/count) and never
 *     echo real names back into the Claude loop
 */

import type { ClaudeToolSchema } from './claude';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { addItem, type ListType } from '../lists/store';
import { upsertSpace, findSpaceByUri, findSpaceBySlug } from '../spaces/store';
import { SPACE_CATEGORIES, type SpaceCategory } from '../spaces/model';
import { getCatalogue } from '../spaces/catalogue';
import { insertCalendarEvent } from '../channels/calendar/google';

export interface ToolContext {
  familyId: string;
  profileId: string;
  channel: string;
  messageId: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export interface ToolDefinition {
  schema: ClaudeToolSchema;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolExecutionResult>;
}

// ---------------------------------------------------------------------------
// addToList
// ---------------------------------------------------------------------------

const ADD_TO_LIST_SCHEMA: ClaudeToolSchema = {
  name: 'addToList',
  description:
    'Add one or more items to the family\'s shopping list or task list. ' +
    'Use this the moment the user asks to add, remember, or put something on a list — ' +
    'do not suggest external tools (Notion, Todoist, etc). After this tool returns ok=true, ' +
    'confirm naturally in your reply. If ok=false, tell the user the items did not save.',
  input_schema: {
    type: 'object',
    properties: {
      list: {
        type: 'string',
        enum: ['shopping', 'task'],
        description: '"shopping" for groceries/household items, "task" for to-do items and reminders',
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'One or more short item strings, each ≤120 chars',
      },
    },
    required: ['list', 'items'],
  },
};

interface AddToListInput {
  list: ListType;
  items: string[];
}

function sanitiseListItem(raw: string): string {
  return raw.trim().replace(/^(?:some|a|an|the)\s+/i, '').slice(0, 120);
}

async function executeAddToList(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const input = rawInput as Partial<AddToListInput>;
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'missing input object' };
  }
  if (input.list !== 'shopping' && input.list !== 'task') {
    return { ok: false, error: 'list must be "shopping" or "task"' };
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, error: 'items array must be non-empty' };
  }

  const cleaned = input.items
    .filter((x): x is string => typeof x === 'string')
    .map(sanitiseListItem)
    .filter(x => x.length > 0);

  if (cleaned.length === 0) {
    return { ok: false, error: 'no valid items after cleaning' };
  }

  const inserted: string[] = [];
  for (const anon of cleaned) {
    const real = await translateToReal(anon);
    try {
      const row = await addItem({
        familyId: ctx.familyId,
        listType: input.list,
        itemText: real,
        source: `tool:addToList:${ctx.channel}`,
        sourceMessageId: ctx.messageId,
        createdBy: ctx.profileId,
      });
      inserted.push(row.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `insert failed after ${inserted.length}/${cleaned.length} items: ${message}`,
        output: { list: input.list, added: inserted.length, requested: cleaned.length },
      };
    }
  }

  return {
    ok: true,
    output: {
      list: input.list,
      added: inserted.length,
      requested: cleaned.length,
    },
  };
}

// ---------------------------------------------------------------------------
// createSpace
// ---------------------------------------------------------------------------

const CREATE_SPACE_SCHEMA: ClaudeToolSchema = {
  name: 'createSpace',
  description:
    'Create a new Space (compiled page of family understanding) when the user references a ' +
    'named project or area that should be remembered long-term — e.g. "a gardening project", ' +
    '"the climbing frame build", "Dad\'s cardiology appointments". Use this proactively when ' +
    'the user introduces a durable topic, not just for throwaway to-dos (use addToList for those). ' +
    'The body field should be a short markdown summary of what you know so far. If the Space ' +
    'already exists by slug, this upserts — existing content is replaced.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Human-readable name of the Space, e.g. "Climbing frame build"',
      },
      category: {
        type: 'string',
        enum: [...SPACE_CATEGORIES],
        description:
          'person (about a family member), routine (recurring activity), household (about the ' +
          'home/car/pet), commitment (ongoing project/plan), document (extracted letter/form)',
      },
      body: {
        type: 'string',
        description: 'Markdown summary of what is known about this Space so far',
      },
      description: {
        type: 'string',
        description: 'Optional one-line description shown in listings',
      },
    },
    required: ['title', 'category', 'body'],
  },
};

interface CreateSpaceInput {
  title: string;
  category: SpaceCategory;
  body: string;
  description?: string;
}

async function executeCreateSpace(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const input = rawInput as Partial<CreateSpaceInput>;
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'missing input object' };
  }
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    return { ok: false, error: 'title is required' };
  }
  if (typeof input.category !== 'string' || !SPACE_CATEGORIES.includes(input.category as SpaceCategory)) {
    return { ok: false, error: `category must be one of: ${SPACE_CATEGORIES.join(', ')}` };
  }
  if (typeof input.body !== 'string') {
    return { ok: false, error: 'body is required' };
  }

  try {
    const title = await translateToReal(input.title.trim());
    const body = await translateToReal(input.body);
    const description = input.description ? await translateToReal(input.description) : '';

    const space = await upsertSpace({
      familyId: ctx.familyId,
      category: input.category as SpaceCategory,
      name: title,
      bodyMarkdown: body,
      description,
      confidence: 0.6,
      sourceReferences: [`message:${ctx.messageId}`],
      actorProfileId: ctx.profileId,
    });

    return {
      ok: true,
      output: {
        id: space.id,
        uri: space.uri,
        slug: space.slug,
        category: space.category,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `createSpace failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// updateSpace
// ---------------------------------------------------------------------------

const UPDATE_SPACE_SCHEMA: ClaudeToolSchema = {
  name: 'updateSpace',
  description:
    'Update an existing Space by URI or slug+category. Use this when the user adds a fact, ' +
    'corrects something, or reports progress on an existing Space — e.g. "the bolts arrived, ' +
    'just need the wood now" on the climbing-frame Space. The `body` field replaces the Space\'s ' +
    'body entirely, so synthesise the updated state rather than appending. Returns an error ' +
    'if the Space cannot be found.',
  input_schema: {
    type: 'object',
    properties: {
      uri: {
        type: 'string',
        description: 'memu:// URI of the Space. Preferred when known.',
      },
      category: {
        type: 'string',
        enum: [...SPACE_CATEGORIES],
        description: 'Category, used with slug when URI is not available',
      },
      slug: {
        type: 'string',
        description: 'Slug (kebab-case), used with category when URI is not available',
      },
      title: {
        type: 'string',
        description: 'Optional new title. Omit to keep existing title.',
      },
      body: {
        type: 'string',
        description: 'Full updated markdown body. Replaces the existing body.',
      },
      description: {
        type: 'string',
        description: 'Optional one-line description update',
      },
    },
    required: ['body'],
  },
};

interface UpdateSpaceInput {
  uri?: string;
  category?: SpaceCategory;
  slug?: string;
  title?: string;
  body: string;
  description?: string;
}

async function executeUpdateSpace(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const input = rawInput as Partial<UpdateSpaceInput>;
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'missing input object' };
  }
  if (typeof input.body !== 'string' || input.body.length === 0) {
    return { ok: false, error: 'body is required' };
  }

  const existing = input.uri
    ? await findSpaceByUri(input.uri)
    : input.category && input.slug && SPACE_CATEGORIES.includes(input.category as SpaceCategory)
      ? await findSpaceBySlug(ctx.familyId, input.category as SpaceCategory, input.slug)
      : null;

  if (!existing) {
    return {
      ok: false,
      error:
        'Space not found. Pass either uri="memu://..." or both category and slug. ' +
        'If unsure of slug, call createSpace instead.',
    };
  }

  if (existing.familyId !== ctx.familyId) {
    return { ok: false, error: 'Space belongs to a different family' };
  }

  try {
    const body = await translateToReal(input.body);
    const title = input.title ? await translateToReal(input.title.trim()) : existing.name;
    const description = input.description !== undefined
      ? await translateToReal(input.description)
      : existing.description;

    const space = await upsertSpace({
      familyId: existing.familyId,
      category: existing.category,
      slug: existing.slug,
      name: title,
      bodyMarkdown: body,
      description,
      domains: existing.domains,
      people: existing.people,
      visibility: existing.visibility,
      confidence: Math.min(1, existing.confidence + 0.05),
      sourceReferences: [...existing.sourceReferences, `message:${ctx.messageId}`],
      tags: existing.tags,
      actorProfileId: ctx.profileId,
    });

    return {
      ok: true,
      output: {
        id: space.id,
        uri: space.uri,
        slug: space.slug,
        category: space.category,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `updateSpace failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// findSpaces
// ---------------------------------------------------------------------------

const FIND_SPACES_SCHEMA: ClaudeToolSchema = {
  name: 'findSpaces',
  description:
    'Search for existing Spaces by name, slug, or description. Call this BEFORE createSpace ' +
    'whenever the user references a person, project, routine, or household topic by name — ' +
    'the Space may already exist under a slightly different slug (typo, singular/plural) and ' +
    'you would not have seen it if retrieval missed it. Returns up to 10 visibility-filtered ' +
    'matches as {uri, title, category, slug, description}. If the result count is 0, it is safe ' +
    'to createSpace. If there is a near match (e.g. you searched "robin" and got "robins"), ' +
    'prefer updateSpace on the existing one over creating a duplicate.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'The name, slug, or topic to search for. Case-insensitive substring match against ' +
          'title, slug, and description. Use singular forms; partial matches are fine.',
      },
      category: {
        type: 'string',
        enum: [...SPACE_CATEGORIES],
        description: 'Optional category filter. Omit to search across all categories.',
      },
    },
    required: ['query'],
  },
};

interface FindSpacesInput {
  query: string;
  category?: SpaceCategory;
}

const FIND_SPACES_LIMIT = 10;

async function executeFindSpaces(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const input = rawInput as Partial<FindSpacesInput>;
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'missing input object' };
  }
  if (typeof input.query !== 'string' || input.query.trim().length === 0) {
    return { ok: false, error: 'query is required' };
  }
  if (input.category !== undefined && !SPACE_CATEGORIES.includes(input.category as SpaceCategory)) {
    return { ok: false, error: `category must be one of: ${SPACE_CATEGORIES.join(', ')}` };
  }

  try {
    const realQuery = (await translateToReal(input.query.trim())).toLowerCase();
    const catalogue = await getCatalogue(ctx.familyId, ctx.profileId);

    const filtered = catalogue.filter(entry => {
      if (input.category && entry.category !== input.category) return false;
      const haystack = [entry.name, entry.slug, entry.description].join(' ').toLowerCase();
      return haystack.includes(realQuery);
    });

    const hits = filtered.slice(0, FIND_SPACES_LIMIT);

    const spaces = await Promise.all(
      hits.map(async entry => ({
        uri: entry.uri,
        title: await translateToAnonymous(entry.name),
        category: entry.category,
        slug: entry.slug,
        description: entry.description ? await translateToAnonymous(entry.description) : '',
      })),
    );

    return {
      ok: true,
      output: {
        count: spaces.length,
        truncated: filtered.length > FIND_SPACES_LIMIT,
        spaces,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `findSpaces failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// addCalendarEvent
// ---------------------------------------------------------------------------

const ADD_CALENDAR_EVENT_SCHEMA: ClaudeToolSchema = {
  name: 'addCalendarEvent',
  description:
    "Add an event to the user's connected Google Calendar. Use this when the user asks to " +
    'schedule, book, or put something on the calendar — e.g. "book a dentist appointment for ' +
    'Tuesday 3pm" or "put swimming class on the calendar every Thursday 4–5pm" (for a one-off ' +
    'instance; recurrence is not yet supported — create one event). Times must be full ISO 8601 ' +
    'with timezone. If the user gives a vague time ("tomorrow afternoon"), resolve to a concrete ' +
    'time using the current date context, and mention the chosen time when you confirm. Returns ' +
    "ok=false with reason='not_connected' if Google Calendar is not set up — tell the user to " +
    'connect it in Settings.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Event title/summary, shown in the calendar. Concise.',
      },
      start: {
        type: 'string',
        description: 'ISO 8601 start datetime with timezone, e.g. "2026-04-22T15:00:00+01:00"',
      },
      end: {
        type: 'string',
        description: 'ISO 8601 end datetime with timezone. Must be after start.',
      },
      location: {
        type: 'string',
        description: 'Optional location string (address or place name).',
      },
      notes: {
        type: 'string',
        description: 'Optional longer description / notes attached to the event.',
      },
    },
    required: ['title', 'start', 'end'],
  },
};

interface AddCalendarEventInput {
  title: string;
  start: string;
  end: string;
  location?: string;
  notes?: string;
}

async function executeAddCalendarEvent(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const input = rawInput as Partial<AddCalendarEventInput>;
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'missing input object' };
  }
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    return { ok: false, error: 'title is required' };
  }
  if (typeof input.start !== 'string' || typeof input.end !== 'string') {
    return { ok: false, error: 'start and end (ISO 8601) are required' };
  }

  try {
    const title = await translateToReal(input.title.trim());
    const location = input.location ? await translateToReal(input.location) : undefined;
    const description = input.notes ? await translateToReal(input.notes) : undefined;

    const result = await insertCalendarEvent(ctx.profileId, {
      summary: title,
      startISO: input.start,
      endISO: input.end,
      location,
      description,
    });

    if (!result.ok) {
      return { ok: false, error: `${result.reason}: ${result.message}` };
    }

    return {
      ok: true,
      output: {
        eventId: result.eventId,
        htmlLink: result.htmlLink,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `addCalendarEvent failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const interactiveQueryTools: Record<string, ToolDefinition> = {
  addToList: {
    schema: ADD_TO_LIST_SCHEMA,
    execute: executeAddToList,
  },
  findSpaces: {
    schema: FIND_SPACES_SCHEMA,
    execute: executeFindSpaces,
  },
  createSpace: {
    schema: CREATE_SPACE_SCHEMA,
    execute: executeCreateSpace,
  },
  updateSpace: {
    schema: UPDATE_SPACE_SCHEMA,
    execute: executeUpdateSpace,
  },
  addCalendarEvent: {
    schema: ADD_CALENDAR_EVENT_SCHEMA,
    execute: executeAddCalendarEvent,
  },
};

export function toolSchemas(tools: Record<string, ToolDefinition>): ClaudeToolSchema[] {
  return Object.values(tools).map(t => t.schema);
}
