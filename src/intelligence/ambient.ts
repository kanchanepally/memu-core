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

export async function fetchWeatherLine(): Promise<string> {
  const lat = envFloat('MEMU_WEATHER_LAT', DEFAULT_LAT);
  const lon = envFloat('MEMU_WEATHER_LON', DEFAULT_LON);
  const place = process.env.MEMU_WEATHER_PLACE || DEFAULT_PLACE;
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

const DEFAULT_RSS_URL = 'https://feeds.bbci.co.uk/news/rss.xml';

export async function fetchNewsBrief(): Promise<string> {
  const url = process.env.MEMU_NEWS_RSS_URL || DEFAULT_RSS_URL;
  const cacheKey = `${url}|${localDayKey()}`;

  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const titles = parseRssTitles(xml, 5);
    if (titles.length === 0) throw new Error('no headlines parsed');

    const lines = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const brief = `Top headlines (BBC):\n${lines}`;
    newsCache.set(cacheKey, { value: brief, expiresAt: nextLocalMidnight() });
    return brief;
  } catch (err) {
    console.error('[AMBIENT] news fetch failed:', err instanceof Error ? err.message : err);
    return 'News unavailable.';
  }
}

function nextLocalMidnight(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

// Internal export so tests can clear caches between assertions.
export function _resetAmbientCachesForTests() {
  weatherCache.clear();
  newsCache.clear();
}
