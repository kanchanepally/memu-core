/**
 * Quick-add input parser for the Lists tab.
 *
 * Parses lightweight markup the user can type in the add-item input:
 *   - `#category` anywhere in the string → list_name
 *   - "by Friday" / "by tomorrow" / "next week" / "today" / "in 3 days" → due_at
 *
 * The parser is deliberately conservative — false positives that hijack
 * a user's literal text would feel hostile. Any pattern only matches
 * with an explicit lead-in word ("by", "on", "next", "in", "today",
 * "tomorrow") so plain item names like "buy gravel boards" stay intact.
 *
 * Pure module — no React, no fetch. Tested independently.
 */

export interface ParsedListInput {
  itemText: string;
  listName: string | null;
  dueAt: string | null; // ISO timestamp at end-of-day local time
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 0, 0);
  return out;
}

function startOfTomorrow(now: Date): Date {
  const out = new Date(now);
  out.setDate(out.getDate() + 1);
  out.setHours(23, 59, 0, 0);
  return out;
}

/**
 * Parse natural-language due-date phrases. Returns the matched substring
 * (so the caller can strip it) plus the resolved ISO date. Returns null
 * when no recognisable date phrase is present — most inputs.
 *
 * `now` is injected for testability.
 */
export function parseDuePhrase(text: string, now: Date = new Date()): { iso: string; matched: string } | null {
  const lower = text.toLowerCase();

  // "today" — case-insensitive, with or without "by"
  const todayMatch = lower.match(/\b(?:by\s+)?today\b/);
  if (todayMatch) {
    return { iso: endOfDay(now).toISOString(), matched: todayMatch[0] };
  }

  // "tomorrow"
  const tomorrowMatch = lower.match(/\b(?:by\s+)?tomorrow\b/);
  if (tomorrowMatch) {
    return { iso: startOfTomorrow(now).toISOString(), matched: tomorrowMatch[0] };
  }

  // "in N days" — "in 3 days" / "in 1 day"
  const inDaysMatch = lower.match(/\bin\s+(\d{1,3})\s+days?\b/);
  if (inDaysMatch) {
    const n = Math.min(365, parseInt(inDaysMatch[1], 10));
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    return { iso: endOfDay(d).toISOString(), matched: inDaysMatch[0] };
  }

  // "next week" — defaults to next Monday
  const nextWeekMatch = lower.match(/\b(?:by\s+)?next\s+week\b/);
  if (nextWeekMatch) {
    const d = new Date(now);
    const todayDow = d.getDay(); // 0=Sun, 1=Mon
    const daysToNextMon = todayDow === 0 ? 1 : (8 - todayDow);
    d.setDate(d.getDate() + daysToNextMon);
    return { iso: endOfDay(d).toISOString(), matched: nextWeekMatch[0] };
  }

  // Day of the week — "by Friday" / "on Monday" / "next Friday" / "Friday"
  // Only matches with a lead-in word OR as a standalone day at the end of
  // the input — we don't want "buy a Friday paper" to set a due date.
  const dayPattern = Object.keys(DAY_NAMES).join('|');
  const dayMatch = lower.match(new RegExp(`\\b(by|on|next)\\s+(${dayPattern})\\b`));
  if (dayMatch) {
    const isNext = dayMatch[1] === 'next';
    const targetDow = DAY_NAMES[dayMatch[2]];
    const d = new Date(now);
    const currentDow = d.getDay();
    let daysAhead = (targetDow - currentDow + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
    if (isNext && daysAhead < 7) daysAhead += 7;
    d.setDate(d.getDate() + daysAhead);
    return { iso: endOfDay(d).toISOString(), matched: dayMatch[0] };
  }

  return null;
}

/**
 * Parse the full quick-add input. Strips recognised markers from the item
 * text so the user's clean intent ("buy gravel boards") survives whatever
 * categorisation/scheduling sugar they appended.
 */
export function parseQuickInput(raw: string, now: Date = new Date()): ParsedListInput {
  let text = raw.trim();
  let listName: string | null = null;
  let dueAt: string | null = null;

  // Category: `#word` — a-z, 0-9, dash, underscore. Lower-cased on extract.
  const hashMatch = text.match(/(^|\s)#([a-zA-Z][a-zA-Z0-9_-]{0,32})(?=$|\s)/);
  if (hashMatch) {
    listName = hashMatch[2].toLowerCase();
    text = (text.slice(0, hashMatch.index!) + text.slice(hashMatch.index! + hashMatch[0].length)).trim();
  }

  // Due-date phrase. We replace the match TOGETHER WITH surrounding
  // punctuation + whitespace so "finish report, by Friday." cleans up to
  // "finish report" rather than "finish report,".
  const due = parseDuePhrase(text, now);
  if (due) {
    dueAt = due.iso;
    const escaped = due.matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text
      .replace(new RegExp(`[\\s,;.]*${escaped}[\\s,;.]*`, 'i'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // One more pass — if the phrase was at the end, the previous replace
    // may have left a stray trailing punct that wasn't adjacent to the
    // match (e.g. comma before the phrase, period after).
    text = text.replace(/[,.;]\s*$/, '').trim();
  }

  // Fall back to the raw input if stripping leaves nothing — protects against
  // someone typing only a date phrase and getting an empty item.
  if (text.length === 0) text = raw.trim();

  return { itemText: text, listName, dueAt };
}
