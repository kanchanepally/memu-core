/**
 * Structured news feed for the Today screen and the PWA.
 *
 * Sibling to ambient.ts. Where ambient.fetchNewsBrief returns a plain string
 * for the morning briefing's LLM prompt, this returns typed NewsItem[] with
 * thumbnails + links + per-item metadata for a Google-Discover-shaped UI.
 *
 * Image source priority (best → fallback):
 *   1. `<media:thumbnail>` / `<media:content url=…>` already in the RSS
 *      feed (BBC always; some Reach plc papers too).
 *   2. `<enclosure type="image/…" url=…>` in the RSS feed.
 *   3. Open Graph image scraped from the article URL (24h cache per URL).
 *   4. None — the client renders a source-coloured letter tile.
 *
 * Each per-source fetch has a 5s timeout; OG scrapes have a 3s timeout. A
 * source that misses doesn't fail the whole feed — we return what we have.
 */

import { listAvailableNewsSources, resolveNewsSources, type NewsSource } from './ambient';

export interface NewsItem {
  /** Unique id for React keys — derived from source + url hash. */
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceLabel: string;
  thumbnailUrl?: string;
  publishedAt?: string; // ISO 8601 if the feed exposed it
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const feedCache = new Map<string, CacheEntry<NewsItem[]>>();
const ogImageCache = new Map<string, CacheEntry<string | null>>();

const FEED_TTL_MS = 30 * 60 * 1000;       // 30 min — fresh enough for "Discover"
const OG_IMAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24h per URL

function nowPlus(ms: number): number {
  return Date.now() + ms;
}

// Per-item RSS parser — pulls title, link, pubDate, and any embedded image
// reference from each <item>. Returns raw strings; downstream code handles
// thumbnail-URL resolution.
interface RssItem {
  title: string;
  link: string;
  pubDate?: string;
  imageUrl?: string;
}

export function parseRssItems(xml: string, max: number): RssItem[] {
  const out: RssItem[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;

  while ((m = itemRegex.exec(xml)) !== null && out.length < max) {
    const block = m[1];

    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(block);
    const title = titleMatch ? unescapeXmlText(titleMatch[1]) : '';
    if (!title || title.length > 250) continue;

    const linkMatch = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(block);
    const linkRaw = linkMatch ? linkMatch[1].trim() : '';
    // Some Atom feeds use <link href="…" /> instead of a text node.
    const linkAtom = /<link\b[^>]*href="([^"]+)"/i.exec(block);
    const link = (linkRaw && linkRaw.length > 0 ? linkRaw : linkAtom?.[1] || '').trim();
    if (!link || !/^https?:\/\//.test(link)) continue;

    const pubMatch = /<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i.exec(block);
    const pubDate = pubMatch ? pubMatch[1].trim() : undefined;

    // Image candidates, in priority order:
    let imageUrl: string | undefined;
    // media:thumbnail url="…"
    const thumbMatch = /<media:thumbnail\b[^>]*\burl="([^"]+)"/i.exec(block);
    if (thumbMatch) imageUrl = thumbMatch[1];
    // media:content url="…" type="image/…"
    if (!imageUrl) {
      const contentMatch = /<media:content\b[^>]*\burl="([^"]+)"[^>]*\btype="image\//i.exec(block);
      if (contentMatch) imageUrl = contentMatch[1];
    }
    // <enclosure type="image/…" url="…" />
    if (!imageUrl) {
      const encMatch = /<enclosure\b[^>]*\btype="image\/[^"]+"[^>]*\burl="([^"]+)"/i.exec(block);
      if (encMatch) imageUrl = encMatch[1];
    }
    // Alternative attribute order — url before type.
    if (!imageUrl) {
      const encMatch = /<enclosure\b[^>]*\burl="([^"]+)"[^>]*\btype="image\//i.exec(block);
      if (encMatch) imageUrl = encMatch[1];
    }

    out.push({ title, link, pubDate, imageUrl });
  }
  return out;
}

// Local copy — ambient.ts exports the same helper. Duplicated here to keep
// this file independent of the ambient string-shape API and avoid a circular
// dep risk down the line.
function unescapeXmlText(text: string): string {
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

// Open Graph image scrape — for sources that don't include image metadata
// in the feed itself (Hacker News). Returns null on miss; cached either way
// for 24h so a popular HN story doesn't trigger a refetch every request.
export async function scrapeOgImage(url: string): Promise<string | null> {
  const cached = ogImageCache.get(url);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Memu)' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      ogImageCache.set(url, { value: null, expiresAt: nowPlus(OG_IMAGE_TTL_MS) });
      return null;
    }
    const html = await res.text();
    // og:image first, twitter:image fallback. Both attribute orders.
    const candidates = [
      /<meta\b[^>]*\bproperty="og:image"[^>]*\bcontent="([^"]+)"/i,
      /<meta\b[^>]*\bcontent="([^"]+)"[^>]*\bproperty="og:image"/i,
      /<meta\b[^>]*\bname="twitter:image"[^>]*\bcontent="([^"]+)"/i,
      /<meta\b[^>]*\bcontent="([^"]+)"[^>]*\bname="twitter:image"/i,
    ];
    let found: string | null = null;
    for (const re of candidates) {
      const m = re.exec(html);
      if (m && m[1]) {
        found = m[1];
        break;
      }
    }
    // Resolve relative URLs against the article URL.
    if (found && !/^https?:\/\//.test(found)) {
      try {
        found = new URL(found, url).toString();
      } catch {
        found = null;
      }
    }
    ogImageCache.set(url, { value: found, expiresAt: nowPlus(OG_IMAGE_TTL_MS) });
    return found;
  } catch (err) {
    // Cache the miss too — a slow article isn't going to suddenly be fast
    // for the rest of the day. 24h is fine.
    ogImageCache.set(url, { value: null, expiresAt: nowPlus(OG_IMAGE_TTL_MS) });
    return null;
  }
}

// Hash a string to a short stable id — used as the React key prefix.
function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

async function fetchSourceItems(source: NewsSource, perSourceMax: number): Promise<NewsItem[]> {
  // Hacker News has its own JSON path — no RSS items, no per-item images.
  if (source.id === 'hacker-news') {
    return fetchHackerNewsItems(source, perSourceMax);
  }

  if (!source.rssUrl) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(source.rssUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRssItems(xml, perSourceMax);

    return items.map(it => ({
      id: `${source.id}-${shortHash(it.link)}`,
      title: it.title,
      url: it.link,
      sourceId: source.id,
      sourceLabel: source.label,
      thumbnailUrl: it.imageUrl,
      publishedAt: parsePubDate(it.pubDate),
    }));
  } catch (err) {
    console.error(`[NEWS] feed fetch failed (${source.id}):`, err instanceof Error ? err.message : err);
    return [];
  }
}

// HN: Algolia front_page returns title + url + created_at_i (unix). No image.
// We scrape OG images in parallel for the top N items.
async function fetchHackerNewsItems(source: NewsSource, max: number): Promise<NewsItem[]> {
  try {
    const url = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      hits?: Array<{ title?: string; url?: string; objectID?: string; created_at_i?: number }>;
    };
    const candidates = (data.hits || [])
      .filter(h => h.title && h.url && /^https?:\/\//.test(h.url))
      .slice(0, max);

    // Scrape OG images in parallel — each is 3s-bounded, so worst case the
    // whole batch resolves in ~3s rather than serial 3s × N.
    const withImages = await Promise.all(candidates.map(async h => {
      const thumbnailUrl = await scrapeOgImage(h.url!);
      return {
        id: `hacker-news-${shortHash(h.url!)}`,
        title: (h.title || '').trim(),
        url: h.url!,
        sourceId: source.id,
        sourceLabel: source.label,
        thumbnailUrl: thumbnailUrl || undefined,
        publishedAt: h.created_at_i ? new Date(h.created_at_i * 1000).toISOString() : undefined,
      } satisfies NewsItem;
    }));

    return withImages;
  } catch (err) {
    console.error('[NEWS] HN fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

function parsePubDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

export interface NewsFeedOptions {
  sourceIds?: string[];   // user-selected — falls back to defaults via resolveNewsSources
  placeName?: string;     // for 'regional' meta-source resolution
  perSourceMax?: number;  // headlines per source — default 3
}

export interface NewsFeed {
  items: NewsItem[];
  fetchedAt: string;
  sources: Array<{ id: string; label: string; count: number }>;
}

const DEFAULT_SOURCE_IDS = ['bbc-news', 'guardian-uk', 'hacker-news', 'regional'];

export async function fetchNewsFeed(opts: NewsFeedOptions = {}): Promise<NewsFeed> {
  const sourceIds = opts.sourceIds && opts.sourceIds.length > 0 ? opts.sourceIds : DEFAULT_SOURCE_IDS;
  const sources = resolveNewsSources(sourceIds, opts.placeName);
  const perSourceMax = opts.perSourceMax ?? 3;

  const cacheKey = `${sources.map(s => s.id).join(',')}|${perSourceMax}|${opts.placeName || ''}`;
  const cached = feedCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return summariseFeed(cached.value);
  }

  if (sources.length === 0) {
    return { items: [], fetchedAt: new Date().toISOString(), sources: [] };
  }

  const perSource = await Promise.all(sources.map(s => fetchSourceItems(s, perSourceMax)));
  const items = interleaveItems(perSource);

  feedCache.set(cacheKey, { value: items, expiresAt: nowPlus(FEED_TTL_MS) });
  return summariseFeed(items);
}

// Round-robin merge keeps the feed visually diverse — instead of "5 BBC then
// 3 HN then 2 Guardian", the user sees BBC-HN-Guardian-BBC-HN-Guardian-… so
// no single source dominates the first impression.
function interleaveItems(perSource: NewsItem[][]): NewsItem[] {
  const out: NewsItem[] = [];
  const indexes = perSource.map(() => 0);
  let remaining = perSource.reduce((acc, arr) => acc + arr.length, 0);
  while (remaining > 0) {
    for (let i = 0; i < perSource.length; i++) {
      const idx = indexes[i];
      if (idx < perSource[i].length) {
        out.push(perSource[i][idx]);
        indexes[i] = idx + 1;
        remaining--;
      }
    }
  }
  return out;
}

function summariseFeed(items: NewsItem[]): NewsFeed {
  const counts = new Map<string, { id: string; label: string; count: number }>();
  for (const it of items) {
    const entry = counts.get(it.sourceId) || { id: it.sourceId, label: it.sourceLabel, count: 0 };
    entry.count++;
    counts.set(it.sourceId, entry);
  }
  return {
    items,
    fetchedAt: new Date().toISOString(),
    sources: Array.from(counts.values()),
  };
}

export function _resetNewsCachesForTests() {
  feedCache.clear();
  ogImageCache.clear();
}

// Re-export the source catalogue helper so callers don't need two imports.
export { listAvailableNewsSources };
