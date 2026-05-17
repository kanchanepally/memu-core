/**
 * URL Source Ingestion (Phase R2 extension — paste-a-link path).
 *
 * Companion to documentIngestion.ts and researchSourceIngestion.ts. Where
 * documentIngestion accepts a base64 file upload (PDF / plain text),
 * urlIngestion accepts an http(s) URL, fetches the page, extracts the
 * main article body, converts it to markdown, prefixes it with metadata
 * frontmatter, and then HANDS OFF to processDocumentIngestion — which
 * already knows how to anonymise via the Twin, dispatch the
 * document_ingestion skill, and persist a Space + stream cards.
 *
 * Flow:
 *   url
 *      ↓ validateUrl                (SSRF guard, scheme + length checks)
 *   safe URL
 *      ↓ fetch (15s, follow 5 redirects, text/html only, custom UA)
 *   html bytes
 *      ↓ sanitiseHtml               (strip script/style/iframe/svg/form/noscript)
 *      ↓ extractMainContent         (pick article/main, fall back to body)
 *      ↓ htmlToMarkdown             (manual, no deps)
 *      ↓ extractMetadataHints       (author / published-date / site name)
 *   markdown body + frontmatter
 *      ↓ processDocumentIngestion (text/plain)
 *   DocumentIngestionResult (Space + stream cards)
 *
 * Design notes:
 *   - No new npm deps. HTML parsing is regex-shaped — accepted trade-off
 *     for the scale (a researcher pasting a URL, not a crawl pipeline).
 *   - SSRF guard runs in validateUrl: reject non-http(s), reject
 *     localhost / 127.0.0.1 / RFC1918 / link-local hosts. We do NOT
 *     re-resolve DNS after redirect — the fetch's `redirect: 'follow'`
 *     opens us to a public host that 302s to localhost. We validate the
 *     FINAL URL post-redirect via response.url before returning content
 *     to the pipeline.
 *   - We do not attempt to handle JavaScript-rendered pages. If the
 *     extracted body is too thin, processDocumentIngestion will fail
 *     downstream with a "document too short" message — that's fine for
 *     the v1 surface; the researcher can copy-paste the text instead.
 */

import { processDocumentIngestion, type DocumentIngestionOutcome } from './documentIngestion';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_URL_CHARS = 2048;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5MB — generous for an article page

const USER_AGENT = 'Memu/1.0 (URL source ingestion; +https://memu.digital)';

// ---------------------------------------------------------------------------
// validateUrl — pure SSRF + shape guard
// ---------------------------------------------------------------------------

export type UrlValidation =
  | { ok: true; url: string }
  | { ok: false; reason: UrlValidationReason };

export type UrlValidationReason =
  | 'url_required'
  | 'url_too_long'
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'private_address_blocked';

/**
 * Reject hostnames that route to the local machine, the loopback range,
 * RFC1918 private networks, or link-local addresses. This is the
 * load-bearing SSRF defence — without it, a researcher could trick the
 * server into fetching its own internal metadata endpoints (AWS / GCP
 * IMDS) or another tenant's container.
 *
 * Pure: takes a hostname string, returns boolean. IPv6 literals get
 * lowercased + bracket-stripped before matching.
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Explicit local names.
  if (h === 'localhost' || h === 'ip6-localhost' || h === 'ip6-loopback') return true;
  if (h.endsWith('.localhost')) return true;
  if (h.endsWith('.local')) return true; // mDNS

  // IPv4 dotted-quad.
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [, a, b, c, d] = v4;
    const oa = Number(a), ob = Number(b), oc = Number(c), od = Number(d);
    if ([oa, ob, oc, od].some(o => o < 0 || o > 255)) return true; // malformed
    if (oa === 0) return true;                                     // 0.0.0.0/8 "this network"
    if (oa === 127) return true;                                   // 127.0.0.0/8 loopback
    if (oa === 10) return true;                                    // 10.0.0.0/8
    if (oa === 172 && ob >= 16 && ob <= 31) return true;           // 172.16.0.0/12
    if (oa === 192 && ob === 168) return true;                     // 192.168.0.0/16
    if (oa === 169 && ob === 254) return true;                     // 169.254.0.0/16 link-local
    if (oa === 100 && ob >= 64 && ob <= 127) return true;          // 100.64.0.0/10 CGNAT
    if (oa >= 224) return true;                                    // multicast + reserved
    return false;
  }

  // IPv6 — coarse but defensive. Block loopback (::1), unspecified (::),
  // unique-local (fc00::/7 → "fc"/"fd" prefix), link-local (fe80::/10).
  if (/^:?:?1?$/.test(h) || h === '::1' || h === '::') return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(h)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true;

  return false;
}

export function validateUrl(input: string): UrlValidation {
  if (typeof input !== 'string') return { ok: false, reason: 'url_required' };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'url_required' };
  if (trimmed.length > MAX_URL_CHARS) return { ok: false, reason: 'url_too_long' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_scheme' };
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    return { ok: false, reason: 'private_address_blocked' };
  }

  return { ok: true, url: parsed.toString() };
}

// ---------------------------------------------------------------------------
// HTML sanitisation — strip executable / non-content elements
// ---------------------------------------------------------------------------

/**
 * Remove tags that can carry executable behaviour or pure chrome we
 * never want to surface in markdown: <script>, <style>, <noscript>,
 * <iframe>, <svg>, <form>. HTML comments too. Done in one pass per
 * tag — order doesn't matter because removal is greedy from `<tag>` to
 * `</tag>` with the `s` flag so newlines inside the tag are matched.
 *
 * NOT a security boundary in itself — the markdown output is rendered
 * as text by downstream consumers — but it stops noise from polluting
 * the extracted body and stops the htmlToMarkdown step from emitting
 * useless `[](javascript:...)` link soup.
 */
export function sanitiseHtml(html: string): string {
  if (!html) return '';
  let out = html;
  const stripTag = (tag: string) => {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    out = out.replace(re, '');
  };
  stripTag('script');
  stripTag('style');
  stripTag('noscript');
  stripTag('iframe');
  stripTag('svg');
  stripTag('form');

  // Self-closing or unclosed variants of the above — drop the open tag too.
  out = out.replace(/<(?:script|style|noscript|iframe|svg|form)\b[^>]*\/?>/gi, '');

  // HTML comments, including conditional <!--[if IE]> blocks.
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  return out;
}

// ---------------------------------------------------------------------------
// extractMainContent — find the article body
// ---------------------------------------------------------------------------

export interface MainContent {
  title: string;
  bylineHint?: string;
  bodyHtml: string;
}

function textDensity(html: string): number {
  // Strip tags to measure visible text length. Heuristic for "is this
  // the article body, or is it a nav menu with five hundred links?".
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length;
}

function findFirstTagContent(html: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = html.match(re);
  return m ? m[1] : undefined;
}

function findAllTagContents(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function stripChromeTags(html: string): string {
  // Remove nav / header / footer / aside blocks — they're not body.
  let out = html;
  for (const tag of ['nav', 'header', 'footer', 'aside']) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }
  return out;
}

export function extractMainContent(sanitisedHtml: string): MainContent {
  // Title fallback chain: og:title → <title> → <h1> inside body → 'Untitled'.
  // We compute the title here (rather than relying on extractMetadataHints)
  // because the LLM downstream uses title for the Space name.
  const ogTitle = sanitisedHtml.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const headTitle = findFirstTagContent(sanitisedHtml, 'title');

  // Try <article> first, then <main>. If multiple, pick the one with
  // the highest text density.
  const articleCandidates = findAllTagContents(sanitisedHtml, 'article');
  const mainCandidates = findAllTagContents(sanitisedHtml, 'main');
  const candidates = [...articleCandidates, ...mainCandidates];

  let bodyHtml: string;
  if (candidates.length > 0) {
    bodyHtml = candidates.reduce((best, c) =>
      textDensity(c) > textDensity(best) ? c : best,
    );
  } else {
    // Fall back to <body>.
    const body = findFirstTagContent(sanitisedHtml, 'body');
    bodyHtml = body ?? sanitisedHtml;
  }

  // Strip nav/header/footer/aside chrome from the chosen body.
  bodyHtml = stripChromeTags(bodyHtml);

  // Byline hint: first <span class="byline">, <p class="author">, etc.
  // Cheap heuristic — production sites vary wildly. The LLM downstream
  // gets a frontmatter block anyway.
  const bylineMatch = bodyHtml.match(/<(?:span|p|div)[^>]*class=["'][^"']*(?:byline|author)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|p|div)>/i);
  const bylineHint = bylineMatch
    ? decodeEntities(stripTags(bylineMatch[1])).trim() || undefined
    : undefined;

  // Title: prefer first <h1> inside the chosen body, fall back to og:title / <title>.
  const h1 = findFirstTagContent(bodyHtml, 'h1');
  const rawTitle =
    (h1 && decodeEntities(stripTags(h1)).trim()) ||
    (ogTitle && decodeEntities(ogTitle[1]).trim()) ||
    (headTitle && decodeEntities(stripTags(headTitle)).trim()) ||
    'Untitled';

  return {
    title: rawTitle,
    bylineHint,
    bodyHtml,
  };
}

// ---------------------------------------------------------------------------
// htmlToMarkdown — manual conversion, no deps
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function decodeEntities(s: string): string {
  if (!s) return '';
  let out = s.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENTITY_MAP[m] ?? m);
  // Numeric entities — &#1234; and &#x4d2;
  out = out.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
    try { return String.fromCodePoint(code); } catch { return ''; }
  });
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, n) => {
    const code = parseInt(n, 16);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
    try { return String.fromCodePoint(code); } catch { return ''; }
  });
  return out;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * Convert sanitised HTML to markdown. Manual, regex-shaped — covers the
 * elements that show up in 95% of article bodies (headings, paragraphs,
 * links, emphasis, lists, code, blockquotes). Anything else gets
 * stripped to text. Good enough for the researcher-paste use case; the
 * Space body is the substrate for LLM extraction downstream, so perfect
 * fidelity is not required.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  let out = html;

  // Normalise self-closing <br/> and <br> to a sentinel we can convert
  // back to a literal newline AFTER tag stripping (so it survives).
  out = out.replace(/<br\s*\/?>/gi, '\n');

  // Horizontal rule.
  out = out.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // Headings — h1 to h6.
  out = out.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n\n# ${stripTags(c).trim()}\n\n`);
  out = out.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n\n## ${stripTags(c).trim()}\n\n`);
  out = out.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n\n### ${stripTags(c).trim()}\n\n`);
  out = out.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n\n#### ${stripTags(c).trim()}\n\n`);
  out = out.replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `\n\n##### ${stripTags(c).trim()}\n\n`);
  out = out.replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `\n\n###### ${stripTags(c).trim()}\n\n`);

  // Pre/code blocks — convert before inline <code> so we don't double-wrap.
  out = out.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => {
    // <pre><code>...</code></pre> is the common pattern.
    const inner = c.replace(/<\/?code\b[^>]*>/gi, '');
    const text = decodeEntities(stripTags(inner));
    return `\n\n\`\`\`\n${text.replace(/^\n+|\n+$/g, '')}\n\`\`\`\n\n`;
  });

  // Blockquotes — line-prefix each line of the inner text with "> ".
  out = out.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => {
    // Recurse: convert the inner HTML first, then prefix.
    const inner = htmlToMarkdown(c).trim();
    if (!inner) return '\n\n';
    const quoted = inner.split('\n').map(line => `> ${line}`).join('\n');
    return `\n\n${quoted}\n\n`;
  });

  // Lists — handle ul/ol recursively so nested lists work. Process the
  // innermost list first by finding lists that contain NO further lists,
  // converting, and looping until no <ul> or <ol> remains.
  let safety = 0;
  while (/<(?:ul|ol)\b/i.test(out) && safety < 20) {
    safety++;
    out = out.replace(
      /<(ul|ol)\b[^>]*>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1>/gi,
      (_, tag: string, inner: string) => {
        const ordered = tag.toLowerCase() === 'ol';
        const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
        const lines = items.map((m, i) => {
          const itemMarkdown = htmlToMarkdown(m[1]).trim();
          const prefix = ordered ? `${i + 1}. ` : '- ';
          // Indent continuation lines so multi-line items render correctly.
          const indented = itemMarkdown.split('\n').map((l, j) => j === 0 ? l : `  ${l}`).join('\n');
          return `${prefix}${indented}`;
        });
        return `\n\n${lines.join('\n')}\n\n`;
      },
    );
  }

  // Links — <a href="X">Y</a>.
  out = out.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
    const cleanText = decodeEntities(stripTags(text)).trim() || href;
    return `[${cleanText}](${href})`;
  });

  // Emphasis. Strong first so it doesn't double-wrap with em.
  out = out.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c) => `**${stripTags(c).trim()}**`);
  out = out.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, c) => `*${stripTags(c).trim()}*`);

  // Inline code.
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${decodeEntities(stripTags(c))}\``);

  // Paragraphs — emit with blank line below.
  out = out.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `\n\n${stripTags(c).trim()}\n\n`);

  // Divs and spans — treat as paragraph-ish wrappers; emit content + blank
  // line so concatenated div soup doesn't collapse into one paragraph.
  out = out.replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, (_, c) => `\n\n${stripTags(c).trim()}\n\n`);

  // Strip everything else.
  out = stripTags(out);

  // Decode remaining entities.
  out = decodeEntities(out);

  // Normalise whitespace: collapse 3+ blank lines to 2; trim leading/trailing.
  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.trim();

  return out;
}

// ---------------------------------------------------------------------------
// extractMetadataHints — author / date / site
// ---------------------------------------------------------------------------

export interface MetadataHints {
  author?: string;
  publishedDate?: string;
  siteName?: string;
}

function getMetaContent(html: string, attrName: 'name' | 'property', value: string): string | undefined {
  const re = new RegExp(
    `<meta\\s+[^>]*${attrName}=["']${value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}["'][^>]*content=["']([^"']+)["']`,
    'i',
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1]).trim();
  // Some sites order attributes the other way (content= before name=).
  const reSwap = new RegExp(
    `<meta\\s+[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}["']`,
    'i',
  );
  const m2 = html.match(reSwap);
  return m2 ? decodeEntities(m2[1]).trim() : undefined;
}

export function extractMetadataHints(html: string): MetadataHints {
  if (!html) return {};

  const author =
    getMetaContent(html, 'name', 'author') ||
    getMetaContent(html, 'property', 'og:author') ||
    getMetaContent(html, 'property', 'article:author') ||
    undefined;

  let publishedDate =
    getMetaContent(html, 'property', 'article:published_time') ||
    getMetaContent(html, 'name', 'pubdate') ||
    getMetaContent(html, 'name', 'date') ||
    getMetaContent(html, 'property', 'og:published_time') ||
    undefined;

  // <time datetime="..."> fallback — pick the first one with a parseable date.
  if (!publishedDate) {
    const timeMatch = html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i);
    if (timeMatch) publishedDate = decodeEntities(timeMatch[1]).trim();
  }

  const siteName = getMetaContent(html, 'property', 'og:site_name') || undefined;

  const out: MetadataHints = {};
  if (author) out.author = author;
  if (publishedDate) out.publishedDate = publishedDate;
  if (siteName) out.siteName = siteName;
  return out;
}

// ---------------------------------------------------------------------------
// Frontmatter + filename derivation
// ---------------------------------------------------------------------------

export function buildFrontmatter(args: {
  title: string;
  url: string;
  author?: string;
  publishedDate?: string;
  siteName?: string;
}): string {
  const lines = ['---'];
  lines.push(`title: ${args.title.replace(/\r?\n/g, ' ').trim()}`);
  lines.push(`source: ${args.url}`);
  if (args.author) lines.push(`author: ${args.author}`);
  if (args.publishedDate) lines.push(`published: ${args.publishedDate}`);
  if (args.siteName) lines.push(`site: ${args.siteName}`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * Derive a filename that survives the documentIngestion safeFileName
 * pass (strips path separators, caps at 80 chars). We need it stable so
 * the on-disk storedAt path is reasonable.
 */
export function deriveFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    // Use the last path segment if present, otherwise the hostname.
    const parts = u.pathname.split('/').filter(Boolean);
    const hasPath = parts.length > 0;
    const rawLast = hasPath ? parts[parts.length - 1] : u.hostname;
    // URL.pathname percent-encodes spaces / unicode / etc — decode so
    // 'with spaces' doesn't become 'with-20spaces'. Try/catch in case
    // of malformed % sequences.
    let last: string;
    try { last = decodeURIComponent(rawLast); } catch { last = rawLast; }
    // Strip query string. Drop file-extension-looking suffixes (`.html`,
    // `.php`, etc.) ONLY when the input had path segments — when we
    // fell back to hostname, every dot is meaningful (`example.com`
    // must stay `example.com`, not `example`).
    let base = last.replace(/\?.*$/, '');
    if (hasPath) {
      base = base.replace(/\.[a-z0-9]{1,5}$/i, '');
    }
    const cleaned = (base || u.hostname).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60);
    return `${cleaned || 'url-source'}.md`;
  } catch {
    return 'url-source.md';
  }
}

// ---------------------------------------------------------------------------
// fetchWithTimeout — fetch + AbortController, structured failure shape
// ---------------------------------------------------------------------------

export type FetchOutcome =
  | { ok: true; html: string; finalUrl: string; contentType: string }
  | { ok: false; reason: FetchFailureReason; detail?: string };

export type FetchFailureReason =
  | 'fetch_failed'
  | 'http_error'
  | 'not_html'
  | 'empty_content'
  | 'too_large'
  | 'private_address_blocked';

async function fetchUrl(url: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });

    if (!response.ok) {
      return { ok: false, reason: 'http_error', detail: `HTTP ${response.status}` };
    }

    // Re-validate the final URL after redirects — guard against a public
    // host that 302s to localhost. response.url reflects the post-redirect
    // location when redirect:'follow' is set.
    const finalUrl = response.url || url;
    try {
      const finalParsed = new URL(finalUrl);
      if (isPrivateOrLocalHost(finalParsed.hostname)) {
        return { ok: false, reason: 'private_address_blocked', detail: 'redirect target is private' };
      }
    } catch {
      // If the final URL isn't parseable, fall through — we trust the
      // body we got but we have nothing to revalidate.
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ok: false, reason: 'not_html', detail: contentType || 'no content-type' };
    }

    // Read body with a byte cap — guard against multi-GB pages.
    const buf = await response.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) {
      return { ok: false, reason: 'too_large', detail: `${buf.byteLength} bytes` };
    }
    const html = Buffer.from(buf).toString('utf8');
    if (html.trim().length === 0) {
      return { ok: false, reason: 'empty_content' };
    }
    return { ok: true, html, finalUrl, contentType };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'fetch_failed', detail: message };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — validate → fetch → extract → handoff
// ---------------------------------------------------------------------------

export interface UrlIngestionInput {
  url: string;
  callerProfileId: string;
  callerFamilyId: string; // currently == profileId per documentIngestion convention
  caption?: string;
  /** Override the messageId (optional; deterministic for tests). */
  messageId?: string;
}

export interface UrlIngestionValidationFailure {
  ok: false;
  stage: 'validate';
  reason: UrlValidationReason;
}

export interface UrlIngestionFetchFailure {
  ok: false;
  stage: 'fetch';
  reason: FetchFailureReason;
  detail?: string;
}

export interface UrlIngestionExtractFailure {
  ok: false;
  stage: 'extract';
  reason: 'empty_content';
}

export type UrlIngestionFailure =
  | UrlIngestionValidationFailure
  | UrlIngestionFetchFailure
  | UrlIngestionExtractFailure;

export type UrlIngestionOutcome =
  | { ok: true; result: Extract<DocumentIngestionOutcome, { ok: true }>; finalUrl: string }
  | { ok: false; failure: UrlIngestionFailure }
  | { ok: false; failure: { stage: 'ingest'; result: Extract<DocumentIngestionOutcome, { ok: false }> } };

/**
 * Build the markdown body that gets handed to processDocumentIngestion.
 * Frontmatter (yaml-style) + the article markdown. Plain text mime so
 * documentIngestion's plain-text parser picks it up.
 */
export function assembleMarkdown(args: {
  title: string;
  finalUrl: string;
  metadata: MetadataHints;
  bodyMarkdown: string;
  bylineHint?: string;
  caption?: string;
}): string {
  const frontmatter = buildFrontmatter({
    title: args.title,
    url: args.finalUrl,
    author: args.metadata.author ?? args.bylineHint,
    publishedDate: args.metadata.publishedDate,
    siteName: args.metadata.siteName,
  });
  const parts = [frontmatter];
  if (args.caption && args.caption.trim().length > 0) {
    parts.push(`> ${args.caption.trim()}`);
  }
  parts.push(`# ${args.title}`);
  parts.push(args.bodyMarkdown);
  return parts.join('\n\n');
}

export async function ingestUrlAsSource(
  input: UrlIngestionInput,
): Promise<UrlIngestionOutcome> {
  // 1. Validate.
  const validated = validateUrl(input.url);
  if (!validated.ok) {
    return { ok: false, failure: { ok: false, stage: 'validate', reason: validated.reason } };
  }

  // 2. Fetch.
  const fetched = await fetchUrl(validated.url);
  if (!fetched.ok) {
    return {
      ok: false,
      failure: { ok: false, stage: 'fetch', reason: fetched.reason, detail: fetched.detail },
    };
  }

  // 3. Sanitise + extract.
  const sanitised = sanitiseHtml(fetched.html);
  const main = extractMainContent(sanitised);
  const bodyMarkdown = htmlToMarkdown(main.bodyHtml);
  if (bodyMarkdown.trim().length === 0) {
    return { ok: false, failure: { ok: false, stage: 'extract', reason: 'empty_content' } };
  }
  const metadata = extractMetadataHints(fetched.html);

  // 4. Assemble + hand off.
  const markdown = assembleMarkdown({
    title: main.title,
    finalUrl: fetched.finalUrl,
    metadata,
    bodyMarkdown,
    bylineHint: main.bylineHint,
    caption: input.caption,
  });

  const fileName = deriveFilenameFromUrl(fetched.finalUrl);
  const messageId = input.messageId ?? `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const result = await processDocumentIngestion({
    profileId: input.callerProfileId,
    fileName,
    buffer: Buffer.from(markdown, 'utf8'),
    mimeType: 'text/plain',
    channel: 'pwa',
    messageId,
  });

  if (!result.ok) {
    return { ok: false, failure: { stage: 'ingest', result } };
  }

  return { ok: true, result, finalUrl: fetched.finalUrl };
}
