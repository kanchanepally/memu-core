/**
 * Build Spec 2 Phase R1 Story R1.5 — workspace templates.
 *
 * A template seeds the shape of a new workspace (type + display
 * metadata), not its content. Read-mostly from app code today; the
 * single seeded row (`research_blank`) carries the type for a new
 * research workspace and a pre-fill name pattern + icon.
 *
 * Lives on the workspace_templates table (migration 050). NOT
 * tenant-scoped — templates are global system records. The deferred
 * starter-content question (spec §4.R1.5) will extend the row shape
 * when/if it lands; today's listTemplates returns shape only.
 */

import { db } from '../db/tenant';

export interface WorkspaceTemplate {
  id: string;
  displayName: string;
  description: string;
  workspaceType: string;
  namePattern: string;
  icon: string;
}

interface TemplateRow {
  id: string;
  display_name: string;
  description: string;
  workspace_type: string;
  name_pattern: string;
  icon: string;
}

function toTemplate(row: TemplateRow): WorkspaceTemplate {
  return {
    id: row.id,
    displayName: row.display_name,
    description: row.description,
    workspaceType: row.workspace_type,
    namePattern: row.name_pattern,
    icon: row.icon,
  };
}

/**
 * Look up a single template by id. Returns null when the id is not
 * a real template (the route layer maps to 422). Bootstrap-read so
 * the lookup runs regardless of the caller's active RLS context —
 * templates are not tenant-scoped.
 */
export async function getTemplate(id: string): Promise<WorkspaceTemplate | null> {
  if (!id) return null;
  const res = await db.queryAsBootstrap<TemplateRow>(
    `SELECT id, display_name, description, workspace_type, name_pattern, icon
       FROM workspace_templates
       WHERE id = $1
       LIMIT 1`,
    [id],
  );
  return res.rowCount === 0 ? null : toTemplate(res.rows[0]);
}

/**
 * List every template the create-workspace picker should offer.
 * Optionally filter to a single workspace type. Order: alphabetical
 * by id for stable display; refine if/when curation becomes a
 * concern. Bootstrap-read for the same reason as getTemplate.
 */
export async function listTemplates(workspaceType?: string): Promise<WorkspaceTemplate[]> {
  const params: string[] = [];
  let where = '';
  if (workspaceType) {
    where = 'WHERE workspace_type = $1';
    params.push(workspaceType);
  }
  const res = await db.queryAsBootstrap<TemplateRow>(
    `SELECT id, display_name, description, workspace_type, name_pattern, icon
       FROM workspace_templates
       ${where}
       ORDER BY id ASC`,
    params,
  );
  return res.rows.map(toTemplate);
}
