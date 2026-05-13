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

import type { ClaudeServerSideTool, ClaudeToolSchema } from './claude';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { addItem, listItems, completeItem, type ListType, type ListFilter, type ListStatus } from '../lists/store';
import { db } from '../db/tenant';
import { upsertSpace, findSpaceByUri, findSpaceBySlug, validateParentRelationship, countChildrenForParents } from '../spaces/store';
import { SPACE_CATEGORIES, type SpaceCategory } from '../spaces/model';
import { getCatalogue } from '../spaces/catalogue';
import { insertCalendarEvent, fetchUpcomingEventsDetailed } from '../channels/calendar/google';

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
// readLists
// ---------------------------------------------------------------------------

const READ_LISTS_SCHEMA: ClaudeToolSchema = {
  name: 'readLists',
  description:
    'Read items from the family\'s shopping list or task list. ' +
    'Use this whenever the user asks about what is on their list or requests to see their lists. ' +
    'It returns the current pending items by default.',
  input_schema: {
    type: 'object',
    properties: {
      list: {
        type: 'string',
        enum: ['shopping', 'task', 'custom'],
        description: 'Optional filter by list type. Omit to fetch from all lists.',
      },
      status: {
        type: 'string',
        enum: ['pending', 'done'],
        description: 'Filter by item status. Defaults to "pending".',
      },
    },
  },
};

interface ReadListsInput {
  list?: ListType;
  status?: ListStatus;
}

async function executeReadLists(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const input = rawInput as Partial<ReadListsInput> | undefined;
  const listType = input?.list;
  const status = input?.status ?? 'pending';

  try {
    const filter: ListFilter = { familyId: ctx.familyId, status };
    if (listType) {
      filter.listType = listType;
    }
    const items = await listItems(filter);
    
    // Anonymise the output before sending back to Claude
    const anonymisedItems = await Promise.all(items.map(async item => ({
      id: item.id,
      list_type: item.list_type,
      list_name: item.list_name,
      item_text: await translateToAnonymous(item.item_text),
      note: item.note ? await translateToAnonymous(item.note) : null,
      due_at: item.due_at,
    })));

    return {
      ok: true,
      output: {
        count: items.length,
        items: anonymisedItems,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `readLists failed: ${message}` };
  }
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
      parentSpaceUri: {
        type: 'string',
        description:
          'Optional URI of an existing top-level Space to nest this new Space under. ' +
          'Use when the user references a project, person, or theme that this new Space ' +
          'is a sub-page of — e.g. "shopping list for the garden" → look up the Garden ' +
          'Space via findSpaces first, then pass its URI here. Two-level limit: do NOT ' +
          'pass a parent that itself has a parent — if findSpaces returns a match whose ' +
          'parentSpaceUri is non-null, nest under THAT grandparent instead, or skip the ' +
          'parent. Pass null or omit for a top-level Space.',
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
  parentSpaceUri?: string | null;
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

  // Treat undefined and empty-string identically to "no parent". null is
  // accepted as an explicit "no parent" signal but for create that's the
  // same outcome — we don't have a self URI to compare against because
  // the row doesn't exist yet.
  const parentRaw = input.parentSpaceUri;
  const parentUri =
    parentRaw === null || parentRaw === undefined || (typeof parentRaw === 'string' && parentRaw.trim() === '')
      ? null
      : parentRaw;

  if (parentUri !== null) {
    const validation = await validateParentRelationship(ctx.familyId, parentUri);
    if (!validation.ok) {
      return { ok: false, error: `parent rejected: ${validation.message ?? validation.reason}` };
    }
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
      parentSpaceUri: parentUri,
    });

    return {
      ok: true,
      output: {
        id: space.id,
        uri: space.uri,
        slug: space.slug,
        category: space.category,
        parentSpaceUri: space.parentSpaceUri ?? null,
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

const UPDATE_SPACE_MODES = ['append', 'replace'] as const;
type UpdateSpaceMode = typeof UPDATE_SPACE_MODES[number];

const UPDATE_SPACE_SCHEMA: ClaudeToolSchema = {
  name: 'updateSpace',
  description:
    'Update an existing Space by URI or slug+category. Use this when the user adds a fact, ' +
    'corrects something, or reports progress on an existing Space — e.g. "the bolts arrived, ' +
    'just need the wood now" on the climbing-frame Space. ' +
    '**Default mode is "append"** — the `body` field is added to the bottom of the existing ' +
    'body under a dated separator, and prior content is preserved. Use mode="replace" only ' +
    'when the user explicitly asks to rewrite the Space, or when correcting a single fact ' +
    'that is wrong (in which case rewrite the whole body so the correction lands cleanly). ' +
    'When in doubt, append. Returns an error if the Space cannot be found.',
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
        description:
          'Markdown content. In "append" mode (default) this is added to the bottom of the ' +
          'existing body under a dated separator. In "replace" mode this becomes the entire ' +
          'new body and prior content is overwritten.',
      },
      mode: {
        type: 'string',
        enum: [...UPDATE_SPACE_MODES],
        description:
          'How to combine `body` with the existing Space body. "append" (default) preserves ' +
          'prior content and adds beneath it. "replace" overwrites — use only when the user ' +
          'explicitly asks to rewrite, or when a small targeted correction calls for a clean ' +
          'rewrite of the whole body.',
      },
      description: {
        type: 'string',
        description: 'Optional one-line description update',
      },
      parentSpaceUri: {
        type: 'string',
        description:
          'Optional. Pass an existing top-level Space URI to re-parent this Space under it. ' +
          'Pass an empty string to explicitly un-parent (promote to top-level). Omit to leave ' +
          'the parent unchanged. Two-level limit: do NOT pass a parent that itself has a parent.',
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
  mode?: UpdateSpaceMode;
  description?: string;
  parentSpaceUri?: string | null;
}

/**
 * Pure helper — combine the existing body with the incoming body.
 *
 * Append mode preserves prior content. The new content is appended under a
 * dated separator (Markdown horizontal rule + italic timestamp), so a reader
 * can scan the file as a chronological log of updates. Trailing whitespace
 * on the existing body is trimmed before joining so successive updates don't
 * accumulate blank lines. If the existing body is empty/whitespace, the
 * incoming body is used verbatim with no separator.
 *
 * Replace mode returns the incoming body verbatim.
 *
 * Pure / testable / no DB / no Twin / no logging — those happen in the
 * executor around this function.
 */
export function mergeSpaceBody(
  existing: string,
  incoming: string,
  mode: UpdateSpaceMode,
  timestampISO: string,
): string {
  if (mode === 'replace') return incoming;

  const trimmedExisting = existing.replace(/\s+$/g, '');
  if (trimmedExisting.length === 0) return incoming;

  // YYYY-MM-DD HH:MM (UTC). The full ISO is preserved in spaces_log; this
  // marker is just for human scanability inside the markdown body.
  const stamp = timestampISO.replace('T', ' ').slice(0, 16);
  return `${trimmedExisting}\n\n---\n_Updated ${stamp} (UTC)_\n\n${incoming}`;
}

function countLines(body: string): number {
  if (body.length === 0) return 0;
  return body.split('\n').length;
}

async function executeUpdateSpace(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const input = rawInput as Partial<UpdateSpaceInput>;
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'missing input object' };
  }
  if (typeof input.body !== 'string' || input.body.length === 0) {
    return { ok: false, error: 'body is required' };
  }
  const mode: UpdateSpaceMode = input.mode ?? 'append';
  if (!UPDATE_SPACE_MODES.includes(mode)) {
    return { ok: false, error: `mode must be one of: ${UPDATE_SPACE_MODES.join(', ')}` };
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

  // parentSpaceUri update semantics:
  //   - field absent → omit from upsert (preserve current parent)
  //   - empty string  → un-parent (treat as null)
  //   - non-empty     → re-parent (validate first)
  let parentField: { parentSpaceUri: string | null } | undefined;
  if (input.parentSpaceUri !== undefined) {
    const candidate =
      input.parentSpaceUri === null || (typeof input.parentSpaceUri === 'string' && input.parentSpaceUri.trim() === '')
        ? null
        : input.parentSpaceUri;
    if (candidate !== null) {
      const validation = await validateParentRelationship(existing.familyId, candidate, existing.uri);
      if (!validation.ok) {
        return { ok: false, error: `parent rejected: ${validation.message ?? validation.reason}` };
      }
    }
    parentField = { parentSpaceUri: candidate };
  }

  try {
    const body = await translateToReal(input.body);
    const title = input.title ? await translateToReal(input.title.trim()) : existing.name;
    const description = input.description !== undefined
      ? await translateToReal(input.description)
      : existing.description;

    const linesBefore = countLines(existing.bodyMarkdown);
    const mergedBody = mergeSpaceBody(
      existing.bodyMarkdown,
      body,
      mode,
      new Date().toISOString(),
    );
    const linesAfter = countLines(mergedBody);

    const space = await upsertSpace({
      familyId: existing.familyId,
      category: existing.category,
      slug: existing.slug,
      name: title,
      bodyMarkdown: mergedBody,
      description,
      domains: existing.domains,
      people: existing.people,
      visibility: existing.visibility,
      confidence: Math.min(1, existing.confidence + 0.05),
      sourceReferences: [...existing.sourceReferences, `message:${ctx.messageId}`],
      tags: existing.tags,
      actorProfileId: ctx.profileId,
      ...(parentField ?? {}),
    });

    return {
      ok: true,
      output: {
        id: space.id,
        uri: space.uri,
        slug: space.slug,
        category: space.category,
        action: mode === 'append' ? 'appended' : 'replaced',
        linesBefore,
        linesAfter,
        linesAdded: Math.max(0, linesAfter - linesBefore),
        parentSpaceUri: space.parentSpaceUri ?? null,
        parentChanged: parentField !== undefined,
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
    'matches as {uri, title, category, slug, description, parentSpaceUri, childCount}. ' +
    '`childCount` tells you whether a match is itself a container (>0 means it has sub-Spaces). ' +
    '`parentSpaceUri` tells you whether the match is itself a sub-Space — when picking a parent ' +
    'for a new Space, only top-level results (parentSpaceUri === null) are valid parents. ' +
    'If the result count is 0, it is safe to createSpace. If there is a near match (e.g. you ' +
    'searched "robin" and got "robins"), prefer updateSpace on the existing one over creating a ' +
    'duplicate.',
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

    // For each hit, fetch the underlying Space row so we have parent +
    // can look up child counts. catalogue.ts doesn't carry parent,
    // and surfacing parent + childCount to Claude is what lets it
    // honour the two-level constraint when deciding where to nest.
    const fullRows = await Promise.all(hits.map(h => findSpaceByUri(h.uri)));
    const presentUris = fullRows
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map(s => s.uri);
    const childCounts = await countChildrenForParents(ctx.familyId, presentUris);

    const spaces = await Promise.all(
      hits.map(async (entry, idx) => {
        const full = fullRows[idx];
        return {
          uri: entry.uri,
          title: await translateToAnonymous(entry.name),
          category: entry.category,
          slug: entry.slug,
          description: entry.description ? await translateToAnonymous(entry.description) : '',
          parentSpaceUri: full?.parentSpaceUri ?? null,
          childCount: childCounts.get(entry.uri) ?? 0,
        };
      }),
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
// readUpcomingEvents
// ---------------------------------------------------------------------------

const READ_UPCOMING_EVENTS_SCHEMA: ClaudeToolSchema = {
  name: 'readUpcomingEvents',
  description:
    "Fetch upcoming events from the user's connected Google Calendar. " +
    "Use this whenever the user asks about their schedule, meetings, or calendar. " +
    "Returns the upcoming events for the next 7 days.",
  input_schema: {
    type: 'object',
    properties: {},
  },
};

async function executeReadUpcomingEvents(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  try {
    // BUG-17 — use the detailed outcome so we can distinguish
    // "no events" (a normal answer) from "calendar disconnected"
    // (auth expired — user needs to reconnect) from "transient
    // fetch failure" (worth retrying / continuing without). Claude
    // sees the structured shape and can mention the disconnect
    // ("the calendar's disconnected — reconnect in Settings") instead
    // of silently behaving as if you have nothing scheduled.
    const result = await fetchUpcomingEventsDetailed(ctx.profileId);

    if (result.kind === 'not_connected') {
      return {
        ok: true,
        output: {
          count: 0,
          events: [],
          calendar_status: 'not_connected',
          calendar_note: 'No Google Calendar is connected for this profile.',
        },
      };
    }
    if (result.kind === 'auth_expired') {
      return {
        ok: true,
        output: {
          count: 0,
          events: [],
          calendar_status: 'auth_expired',
          calendar_note: 'Google Calendar access has expired. The user needs to reconnect Google Calendar in Settings — surface this naturally if the question depended on calendar context.',
        },
      };
    }
    if (result.kind === 'fetch_failed') {
      return {
        ok: true,
        output: {
          count: 0,
          events: [],
          calendar_status: 'fetch_failed',
          calendar_note: 'Calendar fetch failed transiently — answer without calendar context for this turn.',
        },
      };
    }

    // Anonymise the events before sending back to Claude
    const anonymisedEvents = await Promise.all(result.events.map(async e => {
      const summary = e.summary ? await translateToAnonymous(e.summary) : '(untitled event)';
      const location = e.location ? await translateToAnonymous(e.location) : undefined;
      const description = e.description ? await translateToAnonymous(e.description) : undefined;
      return {
        id: e.id,
        summary,
        start: e.start,
        end: e.end,
        location,
        description,
        htmlLink: e.htmlLink,
      };
    }));

    return {
      ok: true,
      output: {
        count: result.events.length,
        events: anonymisedEvents,
        calendar_status: 'ok',
      },
    };
  } catch (err) {
    // Defence-in-depth — fetchUpcomingEventsDetailed already catches
    // every internal failure mode and returns a structured outcome, so
    // this catch should never fire in practice. If it does, treat as
    // ok with a fetch_failed shape so the chat turn doesn't die.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[TOOL readUpcomingEvents] unexpected throw:', message);
    return {
      ok: true,
      output: {
        count: 0,
        events: [],
        calendar_status: 'fetch_failed',
        calendar_note: `Unexpected error: ${message}. Answer without calendar context for this turn.`,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// resolveStreamCard
// ---------------------------------------------------------------------------
//
// When the user reports something is done — "I fixed the climbing frame",
// "that's sorted", "I bought the barrel nuts" — Claude should mark the
// related stream card(s) as resolved so the next briefing doesn't keep
// surfacing them. Without this tool, the only completion mechanism is the
// 14-day age-out cron, which means resolved items keep nagging for two
// weeks.

const RESOLVE_STREAM_CARD_SCHEMA: ClaudeToolSchema = {
  name: 'resolveStreamCard',
  description:
    'Mark stream cards as resolved (done) when the user confirms something is finished. ' +
    'Call this whenever the user says something is done, sorted, fixed, completed, or handled — ' +
    'don\'t just acknowledge verbally; close the loop in the data so future briefings stop surfacing it. ' +
    'You can pass either specific cardIds (preferred when you can identify the exact card from context) ' +
    'OR a topic substring; topic mode resolves any active card whose title or body case-insensitively ' +
    'contains the substring. Returns the count of cards actually resolved.',
  input_schema: {
    type: 'object',
    properties: {
      cardIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific stream card IDs to resolve. Use when you have card IDs from prior context.',
      },
      topic: {
        type: 'string',
        description: 'Substring to match against card title or body (case-insensitive). E.g. "climbing frame", "AWBS".',
      },
    },
  },
};

interface ResolveStreamCardInput {
  cardIds?: string[];
  topic?: string;
}

async function executeResolveStreamCard(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const input = (rawInput || {}) as ResolveStreamCardInput;
  const idList = Array.isArray(input.cardIds) ? input.cardIds.filter(s => typeof s === 'string' && s.length > 0) : [];
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';

  if (idList.length === 0 && topic.length === 0) {
    return { ok: false, error: 'Provide cardIds or topic' };
  }

  try {
    // The user typed in real names; Claude sees and emits anonymous tokens.
    // Translate the topic back to real before substring-matching against
    // stream_cards.title/body which are stored in real form.
    const realTopic = topic ? await translateToReal(topic) : '';

    const params: any[] = [ctx.familyId];
    const clauses: string[] = [`family_id = $1`, `status = 'active'`];

    if (idList.length > 0) {
      params.push(idList);
      clauses.push(`id = ANY($${params.length})`);
    } else {
      params.push(`%${realTopic.toLowerCase()}%`);
      clauses.push(`(LOWER(title) LIKE $${params.length} OR LOWER(body) LIKE $${params.length})`);
    }

    const { rows } = await db.query<{ id: string; title: string }>(
      `UPDATE stream_cards
         SET status = 'resolved', resolved_at = NOW()
       WHERE ${clauses.join(' AND ')}
       RETURNING id, title`,
      params,
    );

    return {
      ok: true,
      output: {
        resolvedCount: rows.length,
        cardIds: rows.map(r => r.id),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `resolveStreamCard failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// markListItemDone
// ---------------------------------------------------------------------------
//
// User says "I bought the barrel nuts" → corresponding `list_items` row(s)
// should flip to `status = 'done'`. Without this, items stay pending and
// the lists tab + briefing keep treating them as open.

const MARK_LIST_ITEM_DONE_SCHEMA: ClaudeToolSchema = {
  name: 'markListItemDone',
  description:
    'Mark list items as done when the user reports completing them. ' +
    'Call this when the user says they\'ve bought / done / completed something on a list — ' +
    'don\'t just acknowledge; flip the underlying list_items row to done so the count and ' +
    'briefing stop treating it as pending. Pass either specific itemIds or a topic substring ' +
    'matched against pending items\' text. Returns the count actually marked done.',
  input_schema: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific list item IDs to mark done.',
      },
      topic: {
        type: 'string',
        description: 'Substring to match against pending items\' text (case-insensitive). E.g. "barrel nuts", "milk".',
      },
      list: {
        type: 'string',
        enum: ['shopping', 'task'],
        description: 'Optional: restrict matching to one list type.',
      },
    },
  },
};

interface MarkListItemDoneInput {
  itemIds?: string[];
  topic?: string;
  list?: ListType;
}

async function executeMarkListItemDone(rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
  const input = (rawInput || {}) as MarkListItemDoneInput;
  const idList = Array.isArray(input.itemIds) ? input.itemIds.filter(s => typeof s === 'string' && s.length > 0) : [];
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  const listType = input.list;

  if (idList.length === 0 && topic.length === 0) {
    return { ok: false, error: 'Provide itemIds or topic' };
  }

  try {
    let matched: string[] = idList;

    if (matched.length === 0) {
      const realTopic = await translateToReal(topic);
      const params: any[] = [ctx.familyId, 'pending', `%${realTopic.toLowerCase()}%`];
      let typeClause = '';
      if (listType) {
        params.push(listType);
        typeClause = ` AND list_type = $${params.length}`;
      }
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM list_items
         WHERE family_id = $1 AND status = $2 AND LOWER(item_text) LIKE $3${typeClause}`,
        params,
      );
      matched = rows.map(r => r.id);
    }

    let doneCount = 0;
    for (const id of matched) {
      const result = await completeItem(id, ctx.familyId);
      if (result) doneCount += 1;
    }

    return {
      ok: true,
      output: {
        doneCount,
        itemIds: matched.slice(0, doneCount),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `markListItemDone failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
//
// Local-function tools — Memu executes these in-process via `execute()`.
// The Twin invariant is enforced inside each executor (real-name
// translation only inside the function; tool outputs back to Claude stay
// anonymous-safe / structural).

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
  readLists: {
    schema: READ_LISTS_SCHEMA,
    execute: executeReadLists,
  },
  readUpcomingEvents: {
    schema: READ_UPCOMING_EVENTS_SCHEMA,
    execute: executeReadUpcomingEvents,
  },
  resolveStreamCard: {
    schema: RESOLVE_STREAM_CARD_SCHEMA,
    execute: executeResolveStreamCard,
  },
  markListItemDone: {
    schema: MARK_LIST_ITEM_DONE_SCHEMA,
    execute: executeMarkListItemDone,
  },
};

// Anthropic server-side tools — Anthropic resolves these on their
// infrastructure and includes the result inline in Claude's response. The
// router does NOT execute them locally; it only synthesises a
// ToolCallLogEntry per invocation so the orchestrator's footer can
// surface what happened.
//
// `web_search_20260209` migrated from a local DDG-Lite scraper
// (2026-04-26) — the scraper was returning `no_results` reliably from
// the Z2's IP (rate-limit / captcha / parse drift) so the capability was
// effectively broken. Anthropic's managed search has its own infra and
// integrates directly with Claude's reasoning loop.
//
// Privacy note: search queries pass through Anthropic's search proxy and
// then to a third-party search engine. Twin tokens MUST stay out of the
// query — the SKILL.md webSearch description carries the warning.
// Anthropic, like any LLM provider in Memu's design, sees the
// anonymous-namespace prompt; this just adds one extra hop for the
// search query specifically. Net privacy posture is unchanged from DDG
// (which also forwarded queries to a third party).
export const interactiveQueryServerTools: ClaudeServerSideTool[] = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    // 2 searches per turn — enough for "find X then verify a detail",
    // not enough to spend the entire output budget on iterative
    // searching with nothing left for synthesis. Was 3; dropped to 2
    // 2026-04-26 after observing the truncation pattern in Hareesh's
    // raised-bed search dogfood (Claude burned all 3 then ran out of
    // maxTokens before answering). Halves cost too (~$0.02/turn vs
    // ~$0.03).
    max_uses: 2,
  },
];

export function toolSchemas(tools: Record<string, ToolDefinition>): ClaudeToolSchema[] {
  return Object.values(tools).map(t => t.schema);
}
