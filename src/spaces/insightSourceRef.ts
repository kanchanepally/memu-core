/**
 * Build Spec 2 Phase R3 — PDF active-reading source-ref helpers.
 *
 * Insights (Memo / Quote / Code / Question Spaces) carry a source
 * reference back to the passage they were captured from. Two anchor
 * shapes:
 *
 *   1. Body-text passage (Z.2 stable pids):
 *        source:<spaceUri>#pid:<pid>
 *
 *   2. PDF passage (R3 — this module):
 *        source:<spaceUri>#page=<n>&rect=<x>,<y>,<w>,<h>
 *
 *   3. Free-form (no passage anchor — bottom-composer capture):
 *        source:<spaceUri>
 *
 * The fragment after `#` is the only difference. Pure parse/format
 * helpers so the route layer and the client both share one truth
 * about the wire shape.
 *
 * `<x>,<y>,<w>,<h>` is the bounding rect in CSS-pixel coordinates
 * relative to the page element (NOT the viewport — page-relative so
 * the same coords land on the same passage regardless of scroll
 * position when the user clicks to jump back). The PDF viewer mounts
 * pages stacked vertically, so page-local coords are stable across
 * window resize too.
 */

export type InsightAnchor =
  | { kind: 'body'; pid: string }
  | { kind: 'pdf'; pageNumber: number; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'none' };

export interface InsightSourceRef {
  spaceUri: string;
  anchor: InsightAnchor;
}

/**
 * Format a source reference. Returns the canonical string form used
 * on the wire and in `synthesis_pages.source_references[]`.
 */
export function formatInsightSourceRef(ref: InsightSourceRef): string {
  const head = `source:${ref.spaceUri}`;
  switch (ref.anchor.kind) {
    case 'body':
      return `${head}#pid:${ref.anchor.pid}`;
    case 'pdf': {
      const { pageNumber, rect } = ref.anchor;
      // Round to 2dp so we don't bloat the ref with floating-point
      // noise from getBoundingClientRect. 2dp is sub-pixel precision
      // — good enough to redraw the highlight in the right spot.
      const fmt = (n: number) => Math.round(n * 100) / 100;
      return `${head}#page=${pageNumber}&rect=${fmt(rect.x)},${fmt(rect.y)},${fmt(rect.w)},${fmt(rect.h)}`;
    }
    case 'none':
      return head;
  }
}

/**
 * Parse a source reference. Returns null for anything that doesn't
 * start with `source:` — caller decides how to handle unknown
 * schemes. Returns kind='none' when the source: prefix is present
 * but no fragment is — i.e. a free-form capture against the Space
 * itself.
 */
export function parseInsightSourceRef(ref: string): InsightSourceRef | null {
  if (typeof ref !== 'string') return null;
  if (!ref.startsWith('source:')) return null;
  const rest = ref.slice('source:'.length);
  const hashIdx = rest.indexOf('#');
  if (hashIdx < 0) {
    return { spaceUri: rest, anchor: { kind: 'none' } };
  }
  const spaceUri = rest.slice(0, hashIdx);
  const fragment = rest.slice(hashIdx + 1);
  // Body-text pid form: `pid:<pid>` (single component, no `=`).
  if (fragment.startsWith('pid:')) {
    const pid = fragment.slice('pid:'.length);
    if (!pid) return null;
    return { spaceUri, anchor: { kind: 'body', pid } };
  }
  // PDF form: `page=<n>&rect=<x>,<y>,<w>,<h>`.
  if (fragment.startsWith('page=')) {
    const params = new Map<string, string>();
    for (const part of fragment.split('&')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      params.set(part.slice(0, eq), part.slice(eq + 1));
    }
    const pageStr = params.get('page');
    const rectStr = params.get('rect');
    if (!pageStr) return null;
    const pageNumber = parseInt(pageStr, 10);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) return null;
    if (!rectStr) {
      // Page-only anchor — valid (jump to page, no highlight).
      return { spaceUri, anchor: { kind: 'pdf', pageNumber, rect: { x: 0, y: 0, w: 0, h: 0 } } };
    }
    const parts = rectStr.split(',').map(s => Number(s));
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return null;
    return {
      spaceUri,
      anchor: { kind: 'pdf', pageNumber, rect: { x: parts[0], y: parts[1], w: parts[2], h: parts[3] } },
    };
  }
  // Unknown fragment shape — treat as free-form (still a valid
  // source: ref, just no anchor we understand).
  return { spaceUri, anchor: { kind: 'none' } };
}

/**
 * True iff `ref` looks like a `source:<thisSpaceUri>...` reference
 * pointing at the given source Space. Used by the insights-panel
 * query to filter Spaces whose source_references mention the
 * currently-open Space.
 *
 * Matches both anchored (`#pid:` / `#page=`) and free-form refs.
 */
export function refTargetsSpace(ref: string, sourceSpaceUri: string): boolean {
  const parsed = parseInsightSourceRef(ref);
  if (!parsed) return false;
  return parsed.spaceUri === sourceSpaceUri;
}
