/**
 * Brief preferences — per-profile customisation of the morning briefing.
 *
 * Backed by `profiles.brief_preferences JSONB` (migration 030). The shape
 * is documented at the top of that migration; this module is the typed
 * read/write surface so callers don't reach into raw JSON.
 *
 * Defaults are applied at read time so a brand-new profile with `{}` gets
 * sensible behaviour (London weather, BBC + Guardian + Hacker News,
 * thinking prompt on) without a backfill or migration data-touch.
 */

import { db } from '../db/tenant';

export interface BriefLocation {
  lat: number;
  lon: number;
  placeName: string;
}

export interface BriefPreferences {
  /** Resolved location for weather + regional-news matching. */
  location?: BriefLocation;
  /** News source IDs to include — see ambient.ts NEWS_SOURCES catalogue. */
  newsSources: string[];
  /** Free-text topics the user cares about (used by future weighting). */
  topics: string[];
  /** Whether to generate a "thinking prompt" inside the brief. */
  thinkingPromptEnabled: boolean;
}

const DEFAULT_PREFERENCES: BriefPreferences = {
  newsSources: ['bbc-news', 'guardian-uk', 'hacker-news', 'regional'],
  topics: [],
  thinkingPromptEnabled: true,
};

export async function getBriefPreferences(profileId: string): Promise<BriefPreferences> {
  const res = await db.query<{ brief_preferences: unknown }>(
    `SELECT brief_preferences FROM profiles WHERE id = $1`,
    [profileId],
  );
  const raw = res.rows[0]?.brief_preferences;
  return normalisePreferences(raw);
}

export async function updateBriefPreferences(
  profileId: string,
  patch: Partial<BriefPreferences>,
): Promise<BriefPreferences> {
  // Read–merge–write so a partial PATCH from the client doesn't blow away
  // fields the user hasn't touched.
  const current = await getBriefPreferences(profileId);
  const next: BriefPreferences = {
    location: patch.location !== undefined ? patch.location : current.location,
    newsSources: patch.newsSources !== undefined ? patch.newsSources : current.newsSources,
    topics: patch.topics !== undefined ? patch.topics : current.topics,
    thinkingPromptEnabled: patch.thinkingPromptEnabled !== undefined
      ? patch.thinkingPromptEnabled
      : current.thinkingPromptEnabled,
  };

  // Strip undefined / null location so we don't persist {location: null}.
  const persistShape: Record<string, unknown> = {
    newsSources: next.newsSources,
    topics: next.topics,
    thinkingPromptEnabled: next.thinkingPromptEnabled,
  };
  if (next.location) persistShape.location = next.location;

  await db.query(
    `UPDATE profiles SET brief_preferences = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(persistShape), profileId],
  );
  return next;
}

// Coerce raw JSONB into the typed shape, with defaults for missing fields
// and validation that drops malformed entries (e.g. NaN coords, non-string
// source ids). Never throws — read should always return something usable.
export function normalisePreferences(raw: unknown): BriefPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFERENCES };

  const obj = raw as Record<string, unknown>;

  let location: BriefLocation | undefined;
  if (obj.location && typeof obj.location === 'object') {
    const loc = obj.location as Record<string, unknown>;
    const lat = typeof loc.lat === 'number' ? loc.lat : NaN;
    const lon = typeof loc.lon === 'number' ? loc.lon : NaN;
    const placeName = typeof loc.placeName === 'string' ? loc.placeName.trim() : '';
    if (Number.isFinite(lat) && Number.isFinite(lon) && placeName.length > 0) {
      location = { lat, lon, placeName };
    }
  }

  const newsSources = Array.isArray(obj.newsSources)
    ? obj.newsSources.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : DEFAULT_PREFERENCES.newsSources;

  const topics = Array.isArray(obj.topics)
    ? obj.topics.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : DEFAULT_PREFERENCES.topics;

  const thinkingPromptEnabled = typeof obj.thinkingPromptEnabled === 'boolean'
    ? obj.thinkingPromptEnabled
    : DEFAULT_PREFERENCES.thinkingPromptEnabled;

  return {
    location,
    newsSources: newsSources.length > 0 ? newsSources : DEFAULT_PREFERENCES.newsSources,
    topics,
    thinkingPromptEnabled,
  };
}
