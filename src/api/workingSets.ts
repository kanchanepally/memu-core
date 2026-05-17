/**
 * BS3 Phase W2 — Working Sets API.
 *
 * A Working Set is a NAMED, ORDERED collection of artefact refs (Spaces
 * — memos / quotes / codes / questions / connections) that a researcher
 * assembles when preparing to write. Schema lives in migration 052; the
 * optional `feeds_into_writing_space_id` FK is added in 053.
 *
 * Endpoints:
 *
 *   GET    /api/working-sets                   — list (active workspace)
 *   POST   /api/working-sets                   — create a new set
 *   GET    /api/working-sets/:id               — set + items[] (joined
 *                                                with synthesis_pages
 *                                                for title + category)
 *   PATCH  /api/working-sets/:id               — rename / re-describe /
 *                                                clearFeedsInto
 *   DELETE /api/working-sets/:id               — cascade items
 *   POST   /api/working-sets/:id/items         — append artefact
 *   PATCH  /api/working-sets/:id/items/:itemId — re-note / re-order
 *   DELETE /api/working-sets/:id/items/:itemId — remove one
 *   POST   /api/working-sets/:id/items/reorder — full re-pack
 *
 * RLS auto-scopes every read/write via the active collective context
 * bound by requireCollective. The handlers also include explicit
 * collective_id filtering as belt-and-braces (and to make the queries
 * read clearly).
 *
 * Pure validators are exported for unit tests; DB-touching handlers
 * are covered by manual QA per project convention (see workbench.test.ts).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/tenant';
import type { SpaceCategory } from '../spaces/model';

interface AuthedRequest extends FastifyRequest {
  profileId?: string;
  familyId?: string;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_NAME_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 2000;
const MAX_NOTE_CHARS = 1000;
const MIN_ARTEFACT_URI_LEN = 10; // strictly > 10 — see spec

// ---------------------------------------------------------------------------
// Pure validators
// ---------------------------------------------------------------------------

export interface ValidatedCreateInput {
  name: string;
  description: string;
}

export type CreateInputValidation =
  | { ok: true; value: ValidatedCreateInput }
  | { ok: false; reason: 'body_required' | 'name_required' | 'name_too_long' | 'description_too_long' };

/**
 * Validate a POST /api/working-sets body.
 *
 *   - name: trimmed, non-empty, ≤ MAX_NAME_CHARS.
 *   - description: optional; trimmed; ≤ MAX_DESCRIPTION_CHARS. Defaults
 *     to '' to match the schema's DEFAULT ''.
 */
export function validateCreateInput(body: unknown): CreateInputValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { ok: false, reason: 'name_required' };
  if (name.length > MAX_NAME_CHARS) return { ok: false, reason: 'name_too_long' };
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length > MAX_DESCRIPTION_CHARS) return { ok: false, reason: 'description_too_long' };
  return { ok: true, value: { name, description } };
}

export interface ValidatedUpdateInput {
  /** When undefined, the field is not updated. */
  name?: string;
  description?: string;
  clearFeedsInto?: boolean;
}

export type UpdateInputValidation =
  | { ok: true; value: ValidatedUpdateInput }
  | { ok: false; reason: 'body_required' | 'no_op' | 'name_required' | 'name_too_long' | 'description_too_long' };

/**
 * Validate a PATCH /api/working-sets/:id body.
 *
 * All fields are optional but at least one must be present (otherwise
 * the request is a no-op — 400 rather than silently returning the
 * current row). `clearFeedsInto: true` explicitly NULLs the FK; any
 * other value (including false / undefined) leaves it untouched.
 *
 * Re-pointing feeds_into to a NEW writing_space_id isn't an API on
 * the Working Set itself — that's the W3 writing-space create flow's
 * job. Here we only support clearing.
 */
export function validateUpdateInput(body: unknown): UpdateInputValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;

  const out: ValidatedUpdateInput = {};

  if (b.name !== undefined) {
    if (typeof b.name !== 'string') return { ok: false, reason: 'name_required' };
    const name = b.name.trim();
    if (!name) return { ok: false, reason: 'name_required' };
    if (name.length > MAX_NAME_CHARS) return { ok: false, reason: 'name_too_long' };
    out.name = name;
  }

  if (b.description !== undefined) {
    if (typeof b.description !== 'string') return { ok: false, reason: 'description_too_long' };
    const description = b.description.trim();
    if (description.length > MAX_DESCRIPTION_CHARS) return { ok: false, reason: 'description_too_long' };
    out.description = description;
  }

  if (b.clearFeedsInto === true) {
    out.clearFeedsInto = true;
  }

  if (out.name === undefined && out.description === undefined && !out.clearFeedsInto) {
    return { ok: false, reason: 'no_op' };
  }
  return { ok: true, value: out };
}

export interface ValidatedAddItemInput {
  artefactSpaceUri: string;
  note: string;
}

export type AddItemInputValidation =
  | { ok: true; value: ValidatedAddItemInput }
  | { ok: false; reason: 'body_required' | 'uri_required' | 'uri_invalid' | 'note_too_long' };

/**
 * Validate a POST /api/working-sets/:id/items body.
 *
 *   - artefactSpaceUri: must start with `memu://` and be longer than
 *     MIN_ARTEFACT_URI_LEN. We don't verify the URI resolves to an
 *     existing synthesis_pages row — RLS will silently hide cross-
 *     collective targets, and the dangling-tombstone shape is the
 *     deliberate spec behaviour for deleted artefacts.
 *   - note: optional per-item annotation; ≤ MAX_NOTE_CHARS.
 */
export function validateAddItemInput(body: unknown): AddItemInputValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;
  const rawUri = typeof b.artefactSpaceUri === 'string' ? b.artefactSpaceUri.trim() : '';
  if (!rawUri) return { ok: false, reason: 'uri_required' };
  if (!rawUri.startsWith('memu://') || rawUri.length <= MIN_ARTEFACT_URI_LEN) {
    return { ok: false, reason: 'uri_invalid' };
  }
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > MAX_NOTE_CHARS) return { ok: false, reason: 'note_too_long' };
  return { ok: true, value: { artefactSpaceUri: rawUri, note } };
}

export interface ValidatedPatchItemInput {
  note?: string;
  orderIndex?: number;
}

export type PatchItemInputValidation =
  | { ok: true; value: ValidatedPatchItemInput }
  | { ok: false; reason: 'body_required' | 'no_op' | 'note_too_long' | 'order_index_invalid' };

/**
 * Validate a PATCH /api/working-sets/:id/items/:itemId body. Same
 * "at least one field" semantics as the set-level update.
 */
export function validatePatchItemInput(body: unknown): PatchItemInputValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;

  const out: ValidatedPatchItemInput = {};

  if (b.note !== undefined) {
    if (typeof b.note !== 'string') return { ok: false, reason: 'note_too_long' };
    const note = b.note.trim();
    if (note.length > MAX_NOTE_CHARS) return { ok: false, reason: 'note_too_long' };
    out.note = note;
  }

  if (b.orderIndex !== undefined) {
    const n = Number(b.orderIndex);
    if (!Number.isFinite(n) || n < 0) return { ok: false, reason: 'order_index_invalid' };
    out.orderIndex = Math.floor(n);
  }

  if (out.note === undefined && out.orderIndex === undefined) {
    return { ok: false, reason: 'no_op' };
  }
  return { ok: true, value: out };
}

export interface ValidatedReorderInput {
  itemIds: string[];
}

export type ReorderInputValidation =
  | { ok: true; value: ValidatedReorderInput }
  | { ok: false; reason: 'body_required' | 'item_ids_required' | 'item_ids_invalid' | 'duplicate_item_ids' };

/**
 * Validate a POST /api/working-sets/:id/items/reorder body.
 *
 *   - itemIds: non-empty array of strings; no duplicates. Order in
 *     the array determines the new order_index (0..N-1).
 */
export function validateReorderInput(body: unknown): ReorderInputValidation {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_required' };
  const b = body as Record<string, unknown>;
  const raw = b.itemIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, reason: 'item_ids_required' };
  }
  for (const id of raw) {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, reason: 'item_ids_invalid' };
    }
  }
  const itemIds = (raw as string[]).map(id => id.trim());
  const seen = new Set<string>();
  for (const id of itemIds) {
    if (seen.has(id)) return { ok: false, reason: 'duplicate_item_ids' };
    seen.add(id);
  }
  return { ok: true, value: { itemIds } };
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface WorkingSetRow {
  id: string;
  collective_id: string;
  name: string;
  description: string;
  owner_profile_id: string;
  feeds_into_writing_space_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface WorkingSetItemRow {
  id: string;
  working_set_id: string;
  collective_id: string;
  artefact_space_uri: string;
  note: string;
  order_index: number;
  added_at: Date;
}

interface WorkingSetItemWithArtefactRow extends WorkingSetItemRow {
  artefact_title: string | null;
  artefact_category: SpaceCategory | null;
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function shapeWorkingSet(r: WorkingSetRow) {
  return {
    id: r.id,
    collectiveId: r.collective_id,
    name: r.name,
    description: r.description,
    ownerProfileId: r.owner_profile_id,
    feedsIntoWritingSpaceId: r.feeds_into_writing_space_id,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

function shapeItem(r: WorkingSetItemWithArtefactRow) {
  return {
    id: r.id,
    workingSetId: r.working_set_id,
    artefactSpaceUri: r.artefact_space_uri,
    artefactTitle: r.artefact_title,         // null → renders as "deleted artefact"
    artefactCategory: r.artefact_category,
    note: r.note,
    orderIndex: r.order_index,
    addedAt: toIso(r.added_at),
  };
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export async function workingSetRoutes(server: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /api/working-sets — list in the active workspace
  // -------------------------------------------------------------------------
  server.get('/api/working-sets', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });

      const res = await db.query<WorkingSetRow>(
        `SELECT id, collective_id, name, description, owner_profile_id,
                feeds_into_writing_space_id, created_at, updated_at
           FROM working_sets
          ORDER BY updated_at DESC`,
      );
      return reply.send({ workingSets: res.rows.map(shapeWorkingSet) });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to list working sets' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/working-sets — create
  // -------------------------------------------------------------------------
  server.post('/api/working-sets', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });

      const validated = validateCreateInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      const { name, description } = validated.value;

      // collective_id picks up the DEFAULT from the session var
      // (memu.collective_id), so we don't pass it explicitly. RLS
      // WITH CHECK enforces it lines up.
      const res = await db.query<WorkingSetRow>(
        `INSERT INTO working_sets (name, description, owner_profile_id)
         VALUES ($1, $2, $3)
         RETURNING id, collective_id, name, description, owner_profile_id,
                   feeds_into_writing_space_id, created_at, updated_at`,
        [name, description, profileId],
      );
      return reply.code(201).send({ workingSet: shapeWorkingSet(res.rows[0]) });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to create working set' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/working-sets/:id — full detail + items
  // -------------------------------------------------------------------------
  server.get('/api/working-sets/:id', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };

      const setRes = await db.query<WorkingSetRow>(
        `SELECT id, collective_id, name, description, owner_profile_id,
                feeds_into_writing_space_id, created_at, updated_at
           FROM working_sets
          WHERE id = $1`,
        [id],
      );
      if (setRes.rowCount === 0) {
        return reply.code(404).send({ error: 'working set not found' });
      }

      // LEFT JOIN so deleted-artefact tombstones (missing synthesis_pages
      // row) surface with NULL title/category — the UI renders these as
      // "deleted artefact" instead of silently dropping them.
      const itemRes = await db.query<WorkingSetItemWithArtefactRow>(
        `SELECT wsi.id, wsi.working_set_id, wsi.collective_id,
                wsi.artefact_space_uri, wsi.note, wsi.order_index, wsi.added_at,
                sp.title AS artefact_title,
                sp.category AS artefact_category
           FROM working_set_items wsi
           LEFT JOIN synthesis_pages sp ON sp.uri = wsi.artefact_space_uri
          WHERE wsi.working_set_id = $1
          ORDER BY wsi.order_index ASC, wsi.added_at ASC`,
        [id],
      );

      return reply.send({
        workingSet: shapeWorkingSet(setRes.rows[0]),
        items: itemRes.rows.map(shapeItem),
      });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to load working set' });
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/working-sets/:id — name / description / clearFeedsInto
  // -------------------------------------------------------------------------
  server.patch('/api/working-sets/:id', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };

      const validated = validateUpdateInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      const { name, description, clearFeedsInto } = validated.value;

      // Build a dynamic SET clause. We always touch updated_at so the
      // list ordering (ORDER BY updated_at DESC) refreshes — that's
      // the felt behaviour the UI expects after any edit.
      const sets: string[] = ['updated_at = NOW()'];
      const params: any[] = [];
      if (name !== undefined) {
        params.push(name);
        sets.push(`name = $${params.length}`);
      }
      if (description !== undefined) {
        params.push(description);
        sets.push(`description = $${params.length}`);
      }
      if (clearFeedsInto) {
        sets.push(`feeds_into_writing_space_id = NULL`);
      }
      params.push(id);

      const res = await db.query<WorkingSetRow>(
        `UPDATE working_sets
            SET ${sets.join(', ')}
          WHERE id = $${params.length}
          RETURNING id, collective_id, name, description, owner_profile_id,
                    feeds_into_writing_space_id, created_at, updated_at`,
        params,
      );
      if (res.rowCount === 0) {
        return reply.code(404).send({ error: 'working set not found' });
      }
      return reply.send({ workingSet: shapeWorkingSet(res.rows[0]) });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to update working set' });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/working-sets/:id — cascade items
  // -------------------------------------------------------------------------
  server.delete('/api/working-sets/:id', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };

      const res = await db.query(
        `DELETE FROM working_sets WHERE id = $1`,
        [id],
      );
      if (res.rowCount === 0) {
        return reply.code(404).send({ error: 'working set not found' });
      }
      return reply.code(204).send();
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to delete working set' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/working-sets/:id/items — append at max(order_index)+1
  // -------------------------------------------------------------------------
  server.post('/api/working-sets/:id/items', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };

      const validated = validateAddItemInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      const { artefactSpaceUri, note } = validated.value;

      // Verify the set exists in the active collective BEFORE insert.
      // RLS would hide a cross-collective set and the FK insert would
      // then fail with 23503 (foreign-key violation) — but we'd rather
      // 404 than 500 in that case.
      const setRes = await db.query<{ id: string }>(
        `SELECT id FROM working_sets WHERE id = $1`,
        [id],
      );
      if (setRes.rowCount === 0) {
        return reply.code(404).send({ error: 'working set not found' });
      }

      try {
        const inserted = await db.transaction(async (client) => {
          // Append at end. COALESCE handles the empty-set case (NULL → 0
          // so the new item gets order_index 0). We compute next inside
          // the txn for atomicity if two adds race.
          const maxRes = await client.query<{ next_order: number }>(
            `SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order
               FROM working_set_items
              WHERE working_set_id = $1`,
            [id],
          );
          const nextOrder = maxRes.rows[0]?.next_order ?? 0;

          const insertRes = await client.query<WorkingSetItemWithArtefactRow>(
            `WITH inserted AS (
               INSERT INTO working_set_items
                 (working_set_id, artefact_space_uri, note, order_index)
               VALUES ($1, $2, $3, $4)
               RETURNING id, working_set_id, collective_id,
                         artefact_space_uri, note, order_index, added_at
             )
             SELECT i.id, i.working_set_id, i.collective_id,
                    i.artefact_space_uri, i.note, i.order_index, i.added_at,
                    sp.title AS artefact_title,
                    sp.category AS artefact_category
               FROM inserted i
               LEFT JOIN synthesis_pages sp ON sp.uri = i.artefact_space_uri`,
            [id, artefactSpaceUri, note, nextOrder],
          );

          // Bump set.updated_at so the parent re-sorts in the list.
          await client.query(
            `UPDATE working_sets SET updated_at = NOW() WHERE id = $1`,
            [id],
          );

          return insertRes.rows[0];
        });

        return reply.code(201).send({ item: shapeItem(inserted) });
      } catch (err: any) {
        if (err?.code === '23505') {
          // UNIQUE (working_set_id, artefact_space_uri) — already in set.
          return reply
            .code(409)
            .send({ error: 'artefact already in this working set', reason: 'duplicate' });
        }
        if (err?.code === '23503') {
          // working_set_id FK no longer matches (race with delete) or
          // collective FK mismatch.
          return reply.code(422).send({ error: 'invalid reference', reason: 'fk_violation' });
        }
        throw err;
      }
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to add item' });
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/working-sets/:id/items/:itemId — note / orderIndex
  // -------------------------------------------------------------------------
  server.patch('/api/working-sets/:id/items/:itemId', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id, itemId } = request.params as { id: string; itemId: string };

      const validated = validatePatchItemInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      const { note, orderIndex } = validated.value;

      const sets: string[] = [];
      const params: any[] = [];
      if (note !== undefined) {
        params.push(note);
        sets.push(`note = $${params.length}`);
      }
      if (orderIndex !== undefined) {
        params.push(orderIndex);
        sets.push(`order_index = $${params.length}`);
      }
      params.push(itemId);
      params.push(id);

      const res = await db.query<WorkingSetItemRow>(
        `UPDATE working_set_items
            SET ${sets.join(', ')}
          WHERE id = $${params.length - 1}
            AND working_set_id = $${params.length}
          RETURNING id, working_set_id, collective_id,
                    artefact_space_uri, note, order_index, added_at`,
        params,
      );
      if (res.rowCount === 0) {
        return reply.code(404).send({ error: 'item not found' });
      }

      // Re-fetch with the JOIN so the response carries the artefact
      // title/category just like POST /items does.
      const joinedRes = await db.query<WorkingSetItemWithArtefactRow>(
        `SELECT wsi.id, wsi.working_set_id, wsi.collective_id,
                wsi.artefact_space_uri, wsi.note, wsi.order_index, wsi.added_at,
                sp.title AS artefact_title,
                sp.category AS artefact_category
           FROM working_set_items wsi
           LEFT JOIN synthesis_pages sp ON sp.uri = wsi.artefact_space_uri
          WHERE wsi.id = $1`,
        [itemId],
      );
      return reply.send({ item: shapeItem(joinedRes.rows[0]) });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to update item' });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/working-sets/:id/items/:itemId — remove
  // -------------------------------------------------------------------------
  server.delete('/api/working-sets/:id/items/:itemId', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id, itemId } = request.params as { id: string; itemId: string };

      const res = await db.query(
        `DELETE FROM working_set_items
          WHERE id = $1 AND working_set_id = $2`,
        [itemId, id],
      );
      if (res.rowCount === 0) {
        return reply.code(404).send({ error: 'item not found' });
      }
      return reply.code(204).send();
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to remove item' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/working-sets/:id/items/reorder — full re-pack
  //
  // Renumbers order_index 0..N matching the array order. Done in a
  // transaction so partial failure (e.g. one id doesn't belong to the
  // set) leaves the order coherent rather than partly-renumbered.
  // -------------------------------------------------------------------------
  server.post('/api/working-sets/:id/items/reorder', async (request: AuthedRequest, reply: FastifyReply) => {
    try {
      const profileId = request.profileId;
      if (!profileId) return reply.code(401).send({ error: 'not authenticated' });
      const { id } = request.params as { id: string };

      const validated = validateReorderInput(request.body);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'invalid input', reason: validated.reason });
      }
      const { itemIds } = validated.value;

      // Verify the set exists in the active collective (RLS-scoped read).
      const setRes = await db.query<{ id: string }>(
        `SELECT id FROM working_sets WHERE id = $1`,
        [id],
      );
      if (setRes.rowCount === 0) {
        return reply.code(404).send({ error: 'working set not found' });
      }

      // Fetch current item ids — must be the exact set being reordered.
      // Mismatch (missing id, foreign id) → 400 reorder_mismatch, leaving
      // the current order untouched.
      const currentRes = await db.query<{ id: string }>(
        `SELECT id FROM working_set_items WHERE working_set_id = $1`,
        [id],
      );
      const currentIds = new Set(currentRes.rows.map(r => r.id));
      if (currentIds.size !== itemIds.length) {
        return reply.code(400).send({ error: 'reorder must list every item exactly once', reason: 'reorder_mismatch' });
      }
      for (const candidate of itemIds) {
        if (!currentIds.has(candidate)) {
          return reply.code(400).send({ error: 'unknown item id in reorder', reason: 'reorder_mismatch' });
        }
      }

      const reordered = await db.transaction(async (client) => {
        // Two-phase renumber to dodge the (absent today, plausible
        // tomorrow) unique constraint on (working_set_id, order_index):
        // first push every item to a large offset, then assign final
        // values. Safe even if the schema later adds the constraint.
        await client.query(
          `UPDATE working_set_items
              SET order_index = order_index + 1000000
            WHERE working_set_id = $1`,
          [id],
        );
        for (let i = 0; i < itemIds.length; i++) {
          await client.query(
            `UPDATE working_set_items
                SET order_index = $1
              WHERE id = $2 AND working_set_id = $3`,
            [i, itemIds[i], id],
          );
        }
        // Bump parent's updated_at so the set re-sorts in the list.
        await client.query(
          `UPDATE working_sets SET updated_at = NOW() WHERE id = $1`,
          [id],
        );

        const finalRes = await client.query<WorkingSetItemWithArtefactRow>(
          `SELECT wsi.id, wsi.working_set_id, wsi.collective_id,
                  wsi.artefact_space_uri, wsi.note, wsi.order_index, wsi.added_at,
                  sp.title AS artefact_title,
                  sp.category AS artefact_category
             FROM working_set_items wsi
             LEFT JOIN synthesis_pages sp ON sp.uri = wsi.artefact_space_uri
            WHERE wsi.working_set_id = $1
            ORDER BY wsi.order_index ASC`,
          [id],
        );
        return finalRes.rows;
      });

      return reply.send({ items: reordered.map(shapeItem) });
    } catch (err) {
      server.log.error(err);
      return reply.code(500).send({ error: 'failed to reorder items' });
    }
  });
}
