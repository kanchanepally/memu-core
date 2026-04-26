/**
 * Tool-call summary footer — Item 2 Slice 1 (2026-04-26).
 *
 * Purpose: when an `interactive_query` turn fires one or more tool calls,
 * append a small machine-rendered footer to the user-visible reply so the
 * user can see what actually happened, separately from whatever Claude
 * said in prose. Closes the "creation / updation seems distant" gap from
 * Hareesh's 2026-04-26 dogfood feedback — chat replies were terse-and-
 * lovely thanks to SOUL but didn't reliably name the concrete effect.
 *
 * This module is intentionally THIN — Tier 1:
 *   - No DB lookups. No real names. Structural counts/actions only.
 *   - Pure function, no side effects, easy to test.
 *   - Operates on `ToolCallLogEntry[]` from `dispatchResult.toolCalls`,
 *     which is already privacy-safe (executors return only structural
 *     output to the Claude loop).
 *
 * Tier 2 (deferred to next session): DB-lookup-enriched summaries that
 * name the actual list items, Space titles, and event summaries. Needs
 * a separate `userVisible` channel on `ToolExecutionResult` so real
 * names can flow into the footer without leaking back to Claude in
 * subsequent tool_result blocks.
 *
 * Voice: matches SOUL.md — terse, past-tense, leads with the action.
 * "Memu just:" framing makes it unambiguous that this is the system
 * speaking, not Claude.
 */

import type { ToolCallLogEntry } from '../skills/router';

/**
 * Build a single short clause describing one successful tool call.
 * Returns null if the tool call should not be surfaced to the user
 * (e.g. findSpaces — internal navigation, not a state change worth
 * announcing).
 */
function describeOk(call: ToolCallLogEntry): string | null {
  const out = call.output ?? {};
  switch (call.name) {
    case 'addToList': {
      const list = out.list === 'task' ? 'task list' : 'shopping list';
      const n = typeof out.added === 'number' ? out.added : 0;
      if (n <= 0) return null;
      return n === 1 ? `added 1 item to ${list}` : `added ${n} items to ${list}`;
    }
    case 'createSpace':
      return 'created a Space';
    case 'updateSpace': {
      const action = out.action;
      const linesAdded = typeof out.linesAdded === 'number' ? out.linesAdded : 0;
      if (action === 'replaced') {
        return 'replaced a Space — prior content is in git history';
      }
      // appended (default)
      if (linesAdded === 1) return 'appended 1 line to a Space';
      if (linesAdded > 1) return `appended ${linesAdded} lines to a Space`;
      return 'appended to a Space';
    }
    case 'addCalendarEvent':
      return 'added an event to your calendar';
    case 'webSearch':
      return 'searched the web';
    case 'findSpaces':
      // Internal navigation — Claude searched its own knowledge to dedup or
      // resolve a reference. Not a state change, not worth telling the user.
      return null;
    default:
      // Unknown tool — surface generically so we never silently swallow.
      return `ran ${call.name}`;
  }
}

/**
 * Describe a failed tool call. Always surfaced (failures matter even
 * when a successful version would be silent — e.g. a failed findSpaces
 * tells the user something Claude wanted to do didn't work).
 */
function describeFail(call: ToolCallLogEntry): string {
  const reason = call.error ? ` (${call.error})` : '';
  switch (call.name) {
    case 'addToList':
      return `couldn't add to your list${reason}`;
    case 'createSpace':
      return `couldn't create a Space${reason}`;
    case 'updateSpace':
      return `couldn't update a Space${reason}`;
    case 'addCalendarEvent':
      return `couldn't add the calendar event${reason}`;
    case 'webSearch':
      return `web search failed${reason}`;
    case 'findSpaces':
      return `Space search failed${reason}`;
    default:
      return `${call.name} failed${reason}`;
  }
}

/**
 * Format the footer for a turn's tool calls. Returns an empty string
 * (no separator, no nothing) when there are no surfaceable calls — so
 * the caller can blindly append the result without worrying about
 * trailing whitespace.
 *
 * Output shape:
 *   \n\n---\n_Memu just: <clause> · <clause> · <clause>_\n
 *
 * The horizontal-rule + italic framing makes it visually distinct from
 * Claude's prose. Mobile and PWA both render markdown; clients that
 * don't will still see "---" as the separator and the underscores as
 * literal — acceptable degradation.
 */
export function formatToolSummaryFooter(toolCalls: ToolCallLogEntry[] | undefined): string {
  if (!toolCalls || toolCalls.length === 0) return '';

  const okClauses: string[] = [];
  const failClauses: string[] = [];
  for (const call of toolCalls) {
    if (call.ok) {
      const clause = describeOk(call);
      if (clause) okClauses.push(clause);
    } else {
      failClauses.push(`⚠ ${describeFail(call)}`);
    }
  }

  if (okClauses.length === 0 && failClauses.length === 0) return '';

  const all = [...okClauses, ...failClauses];
  return `\n\n---\n_Memu just: ${all.join(' · ')}_\n`;
}
