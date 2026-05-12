/**
 * Ambient context for the morning briefing — weather + top news headlines.
 *
 * Both fetched from keyless public APIs:
 *   - Weather: Open-Meteo (open-meteo.com, EU-friendly, free, no key)
 *   - News: BBC top-stories RSS (no key)
 *
 * Cached per local-day so a briefing fetched at 07:00 and again at 13:00
 * (e.g. on-demand via /api/briefing/run-now) hit the same data. The cache
 * is process-local — fine for a single-instance Z2 deploy; revisit when
 * Hetzner deploys multiple replicas.
 *
 * Default location is London for v1. Override with the `MEMU_WEATHER_LAT`
 * and `MEMU_WEATHER_LON` env vars (decimal degrees). A future Settings
 * field will let users pick their own; not in this slice.
 *
 * The output of each function is a SHORT human-readable string ready to
 * drop into the briefing skill's `{{weather_line}}` and `{{news_brief}}`
 * template vars. The skill is responsible for deciding when/how to weave
 * them into the prose; these functions never return null on missing data
 * so the LLM doesn't see a literal "undefined" — they return a graceful
 * skip-string ("Weather unavailable.") that the prompt knows to ignore.
 */

const DEFAULT_LAT = 51.5074;   // London — central reference for v1
const DEFAULT_LON = -0.1278;
const DEFAULT_PLACE = 'London';

const DAY_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const weatherCache = new Map<string, CacheEntry<string>>();
const newsCache = new Map<string, CacheEntry<string>>();

function localDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

// Open-Meteo weather codes → short adjective. Truncated to the codes that
// matter for the morning brief; everything else falls back to the generic
// "mixed conditions" so we never emit a numeric code as user-facing text.
export function describeWeatherCode(code: number): string {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'mostly clear';
  if (code === 3) return 'overcast';
  if (code >= 45 && code <= 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzly';
  if (code >= 61 && code <= 67) return 'rainy';
  if (code >= 71 && code <= 77) return 'snowy';
  if (code >= 80 && code <= 82) return 'showery';
  if (code >= 85 && code <= 86) return 'snowy';
  if (code >= 95) return 'thundery';
  return 'mixed conditions';
}

interface OpenMeteoResponse {
  current_weather?: {
    temperature?: number;
    weathercode?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weathercode?: number[];
  };
}

export interface WeatherOptions {
  lat?: number;
  lon?: number;
  placeName?: string;
}

export async function fetchWeatherLine(opts: WeatherOptions = {}): Promise<string> {
  const lat = opts.lat ?? envFloat('MEMU_WEATHER_LAT', DEFAULT_LAT);
  const lon = opts.lon ?? envFloat('MEMU_WEATHER_LON', DEFAULT_LON);
  const place = opts.placeName || process.env.MEMU_WEATHER_PLACE || DEFAULT_PLACE;
  const cacheKey = `${lat},${lon},${localDayKey()}`;

  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('current_weather', 'true');
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weathercode');
    url.searchParams.set('timezone', 'auto');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as OpenMeteoResponse;

    const now = Math.round(data.current_weather?.temperature ?? NaN);
    const high = Math.round(data.daily?.temperature_2m_max?.[0] ?? NaN);
    const low = Math.round(data.daily?.temperature_2m_min?.[0] ?? NaN);
    const code = data.daily?.weathercode?.[0] ?? data.current_weather?.weathercode ?? -1;
    const phrase = describeWeatherCode(code);

    if (!Number.isFinite(now) || !Number.isFinite(high) || !Number.isFinite(low)) {
      throw new Error('missing temperature values');
    }

    const line = `${place}: ${now}°C now, ${phrase} (high ${high}°C, low ${low}°C).`;
    weatherCache.set(cacheKey, { value: line, expiresAt: nextLocalMidnight() });
    return line;
  } catch (err) {
    console.error('[AMBIENT] weather fetch failed:', err instanceof Error ? err.message : err);
    return 'Weather unavailable.';
  }
}

// Strip HTML/XML markup and decode the handful of XML entities BBC RSS uses.
// A full parser would be overkill — BBC's titles/descriptions are short
// plain-text strings with the occasional "&amp;" or "&apos;".
export function unescapeXmlText(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse <item><title>...</title></item> blocks out of the RSS feed. We
// only need titles for the briefing — descriptions can be added later if
// the prose feels thin, but headlines alone are typically enough for the
// "one-line news touch" the skill is asked to emit.
export function parseRssTitles(xml: string, max: number): string[] {
  const titles: string[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null && titles.length < max) {
    const block = m[1];
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(block);
    if (!titleMatch) continue;
    const title = unescapeXmlText(titleMatch[1]);
    if (title.length > 0 && title.length < 200) titles.push(title);
  }
  return titles;
}

// News-source catalogue. Each source has an id (the value the user toggles
// in Settings), a human-readable label, and either an `rssUrl` for the RSS
// path OR a custom `fetcher` for non-RSS sources (e.g. Hacker News' Firebase
// JSON endpoint). `regionalMatch` is a function that returns true if the
// source is the right match for a given UK place name — when the user
// selects the generic "regional" source id, we pick the actual feed by
// matching their place against this list.
export interface NewsSource {
  id: string;
  label: string;
  rssUrl?: string;
  fetcher?: (max: number) => Promise<string[]>;
  regionalMatch?: (placeName: string) => boolean;
}

const NEWS_SOURCES: Record<string, NewsSource> = {
  'bbc-news': {
    id: 'bbc-news',
    label: 'BBC News',
    rssUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
  },
  'bbc-tech': {
    id: 'bbc-tech',
    label: 'BBC Technology',
    rssUrl: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  },
  'guardian-uk': {
    id: 'guardian-uk',
    label: 'The Guardian (UK)',
    rssUrl: 'https://www.theguardian.com/uk/rss',
  },
  'hacker-news': {
    id: 'hacker-news',
    label: 'Hacker News',
    fetcher: fetchHackerNewsTitles,
  },
  'devon-live': {
    id: 'devon-live',
    label: 'Devon Live',
    rssUrl: 'https://www.devonlive.com/?service=rss',
    regionalMatch: (place: string) => {
      const p = place.toLowerCase();
      // South Hams + Plymouth + Exeter + surrounding villages all read Devon Live.
      return /\b(devon|ivybridge|plymouth|exeter|totnes|dartmoor|tavistock|okehampton|south hams|teignbridge|torbay|barnstaple|tiverton)\b/.test(p);
    },
  },
  'plymouth-live': {
    id: 'plymouth-live',
    label: 'Plymouth Live',
    rssUrl: 'https://www.plymouthherald.co.uk/?service=rss',
    regionalMatch: (place: string) => /\b(plymouth|plympton|plymstock|saltash)\b/.test(place.toLowerCase()),
  },
};

const DEFAULT_SOURCE_IDS = ['bbc-news', 'guardian-uk', 'hacker-news'];

export function listAvailableNewsSources(): NewsSource[] {
  return Object.values(NEWS_SOURCES);
}

// Resolve user-selected source ids into concrete NewsSource instances. The
// special id 'regional' resolves to whichever regional source matches the
// user's place name — Devon Live for Ivybridge, Plymouth Live for Plymouth,
// etc. When no regional source matches, 'regional' is silently dropped.
export function resolveNewsSources(sourceIds: string[], placeName?: string): NewsSource[] {
  const resolved: NewsSource[] = [];
  const seen = new Set<string>();
  for (const id of sourceIds) {
    if (id === 'regional' && placeName) {
      const regional = Object.values(NEWS_SOURCES).find(s =>
        s.regionalMatch && s.regionalMatch(placeName),
      );
      if (regional && !seen.has(regional.id)) {
        resolved.push(regional);
        seen.add(regional.id);
      }
      continue;
    }
    const src = NEWS_SOURCES[id];
    if (src && !seen.has(src.id)) {
      resolved.push(src);
      seen.add(src.id);
    }
  }
  return resolved;
}

// Hacker News doesn't expose RSS in the same shape; Algolia's HN search API
// returns front-page stories cleanly. Top 30, take the requested max.
async function fetchHackerNewsTitles(max: number): Promise<string[]> {
  try {
    const url = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { hits?: Array<{ title?: string }> };
    const titles = (data.hits || [])
      .map(h => (h.title || '').trim())
      .filter(t => t.length > 0 && t.length < 200)
      .slice(0, max);
    return titles;
  } catch (err) {
    console.error('[AMBIENT] HN fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function fetchSourceTitles(source: NewsSource, max: number): Promise<string[]> {
  if (source.fetcher) return source.fetcher(max);
  if (!source.rssUrl) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(source.rssUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseRssTitles(xml, max);
  } catch (err) {
    console.error(`[AMBIENT] news fetch failed (${source.id}):`, err instanceof Error ? err.message : err);
    return [];
  }
}

export interface NewsBriefOptions {
  sourceIds?: string[];   // selected by the user; falls back to DEFAULT_SOURCE_IDS
  placeName?: string;     // used to resolve the 'regional' meta-source
  perSourceMax?: number;  // headlines per source — default 3
}

export async function fetchNewsBrief(opts: NewsBriefOptions = {}): Promise<string> {
  const sourceIds = opts.sourceIds && opts.sourceIds.length > 0 ? opts.sourceIds : DEFAULT_SOURCE_IDS;
  const sources = resolveNewsSources(sourceIds, opts.placeName);
  const perSourceMax = opts.perSourceMax ?? 3;

  if (sources.length === 0) return 'News unavailable.';

  const cacheKey = `${sources.map(s => s.id).join(',')}|${perSourceMax}|${localDayKey()}`;
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const results = await Promise.all(sources.map(async s => ({
    source: s,
    titles: await fetchSourceTitles(s, perSourceMax),
  })));

  const blocks: string[] = [];
  let total = 0;
  for (const r of results) {
    if (r.titles.length === 0) continue;
    blocks.push(`${r.source.label}:\n${r.titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`);
    total += r.titles.length;
  }
  if (total === 0) return 'News unavailable.';

  const brief = blocks.join('\n\n');
  newsCache.set(cacheKey, { value: brief, expiresAt: nextLocalMidnight() });
  return brief;
}

function nextLocalMidnight(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

// Geocode a place name → lat/lon via Open-Meteo's keyless geocoding API.
// Returns null on miss; the caller falls back to whatever default they had.
//
// We intentionally pick the FIRST hit and the user can correct it from
// Settings if Open-Meteo returns the wrong "Plymouth". A future polish lets
// the user pick from the top-3 hits during onboarding.
export interface GeocodeResult {
  lat: number;
  lon: number;
  placeName: string;
  country: string;
  admin1?: string; // county / state — useful for the regional-source matcher
}

export async function geocodePlace(query: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', trimmed);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string; country: string; admin1?: string }>;
    };
    const hit = data.results?.[0];
    if (!hit) return null;
    return {
      lat: hit.latitude,
      lon: hit.longitude,
      placeName: hit.name,
      country: hit.country,
      admin1: hit.admin1,
    };
  } catch (err) {
    console.error('[AMBIENT] geocode failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Internal export so tests can clear caches between assertions.
export function _resetAmbientCachesForTests() {
  weatherCache.clear();
  newsCache.clear();
}
