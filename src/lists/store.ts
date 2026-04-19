import { pool } from '../db/connection';

export type ListType = 'shopping' | 'task' | 'custom';
export type ListStatus = 'pending' | 'done';

export interface ListItem {
  id: string;
  family_id: string;
  list_type: ListType;
  list_name: string | null;
  item_text: string;
  note: string | null;
  status: ListStatus;
  source: string | null;
  source_message_id: string | null;
  source_stream_card_id: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AddItemInput {
  familyId: string;
  listType: ListType;
  itemText: string;
  note?: string | null;
  listName?: string | null;
  source?: string | null;
  sourceMessageId?: string | null;
  sourceStreamCardId?: string | null;
  createdBy?: string | null;
}

export async function addItem(input: AddItemInput): Promise<ListItem> {
  const { rows } = await pool.query<ListItem>(
    `INSERT INTO list_items
       (family_id, list_type, list_name, item_text, note, source, source_message_id, source_stream_card_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.familyId,
      input.listType,
      input.listName ?? null,
      input.itemText,
      input.note ?? null,
      input.source ?? null,
      input.sourceMessageId ?? null,
      input.sourceStreamCardId ?? null,
      input.createdBy ?? null,
    ],
  );
  return rows[0];
}

export interface ListFilter {
  familyId: string;
  listType?: ListType;
  status?: ListStatus;
  limit?: number;
}

export async function listItems(filter: ListFilter): Promise<ListItem[]> {
  const clauses = ['family_id = $1'];
  const params: unknown[] = [filter.familyId];
  if (filter.listType) {
    params.push(filter.listType);
    clauses.push(`list_type = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    clauses.push(`status = $${params.length}`);
  }
  const limit = filter.limit ?? 200;
  params.push(limit);
  const { rows } = await pool.query<ListItem>(
    `SELECT * FROM list_items
     WHERE ${clauses.join(' AND ')}
     ORDER BY status ASC, created_at ASC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function completeItem(id: string, familyId: string): Promise<ListItem | null> {
  const { rows } = await pool.query<ListItem>(
    `UPDATE list_items
     SET status = 'done', completed_at = NOW()
     WHERE id = $1 AND family_id = $2
     RETURNING *`,
    [id, familyId],
  );
  return rows[0] ?? null;
}

export async function reopenItem(id: string, familyId: string): Promise<ListItem | null> {
  const { rows } = await pool.query<ListItem>(
    `UPDATE list_items
     SET status = 'pending', completed_at = NULL
     WHERE id = $1 AND family_id = $2
     RETURNING *`,
    [id, familyId],
  );
  return rows[0] ?? null;
}

export async function deleteItem(id: string, familyId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM list_items WHERE id = $1 AND family_id = $2`,
    [id, familyId],
  );
  return (rowCount ?? 0) > 0;
}

export async function updateItem(
  id: string,
  familyId: string,
  patch: { itemText?: string; note?: string | null },
): Promise<ListItem | null> {
  const sets: string[] = [];
  const params: unknown[] = [id, familyId];
  if (patch.itemText !== undefined) {
    params.push(patch.itemText);
    sets.push(`item_text = $${params.length}`);
  }
  if (patch.note !== undefined) {
    params.push(patch.note);
    sets.push(`note = $${params.length}`);
  }
  if (sets.length === 0) {
    const { rows } = await pool.query<ListItem>(
      `SELECT * FROM list_items WHERE id = $1 AND family_id = $2`,
      [id, familyId],
    );
    return rows[0] ?? null;
  }
  const { rows } = await pool.query<ListItem>(
    `UPDATE list_items SET ${sets.join(', ')} WHERE id = $1 AND family_id = $2 RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}
