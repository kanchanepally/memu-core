/**
 * URL Source Ingestion — pure-helper tests.
 *
 * No external network calls. ingestUrlAsSource itself is DB-touching
 * (Twin registry, file storage, upsertSpace) — covered manually on the
 * Z2 per the same convention as documentIngestion / researchSourceIngestion.
 * These tests pin the SSRF guard, the HTML sanitiser, the HTML-to-markdown
 * converter, the main-content extractor, and the metadata-hint parser.
 */

import { describe, it, expect } from 'vitest';
import {
  validateUrl,
  isPrivateOrLocalHost,
  sanitiseHtml,
  extractMainContent,
  htmlToMarkdown,
  extractMetadataHints,
  decodeEntities,
  buildFrontmatter,
  deriveFilenameFromUrl,
  assembleMarkdown,
} from './urlIngestion';

// ---------------------------------------------------------------------------
// validateUrl
// ---------------------------------------------------------------------------

describe('validateUrl', () => {
  it('accepts a plain https URL', () => {
    const r = validateUrl('https://example.com/article');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe('https://example.com/article');
  });

  it('accepts a plain http URL', () => {
    const r = validateUrl('http://example.com');
    expect(r.ok).toBe(true);
  });

  it('rejects empty string', () => {
    expect(validateUrl('')).toEqual({ ok: false, reason: 'url_required' });
    expect(validateUrl('   ')).toEqual({ ok: false, reason: 'url_required' });
  });

  it('rejects non-string input', () => {
    // @ts-expect-error — runtime contract test
    expect(validateUrl(null)).toEqual({ ok: false, reason: 'url_required' });
    // @ts-expect-error — runtime contract test
    expect(validateUrl(undefined)).toEqual({ ok: false, reason: 'url_required' });
    // @ts-expect-error — runtime contract test
    expect(validateUrl(42)).toEqual({ ok: false, reason: 'url_required' });
  });

  it('rejects URLs longer than 2048 chars', () => {
    const long = 'https://example.com/' + 'a'.repeat(2050);
    expect(validateUrl(long)).toEqual({ ok: false, reason: 'url_too_long' });
  });

  it('rejects unparseable strings', () => {
    expect(validateUrl('not-a-url')).toEqual({ ok: false, reason: 'invalid_url' });
    expect(validateUrl('://broken')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('rejects javascript: scheme', () => {
    expect(validateUrl('javascript:alert(1)')).toEqual({ ok: false, reason: 'unsupported_scheme' });
  });

  it('rejects file:// scheme', () => {
    expect(validateUrl('file:///etc/passwd')).toEqual({ ok: false, reason: 'unsupported_scheme' });
  });

  it('rejects data: scheme', () => {
    expect(validateUrl('data:text/html,<h1>hi</h1>')).toEqual({ ok: false, reason: 'unsupported_scheme' });
  });

  it('rejects localhost variants', () => {
    expect(validateUrl('http://localhost/').ok).toBe(false);
    expect(validateUrl('http://localhost:8080/x').ok).toBe(false);
    expect(validateUrl('http://memu.localhost/').ok).toBe(false);
  });

  it('rejects loopback IPv4', () => {
    expect(validateUrl('http://127.0.0.1/').ok).toBe(false);
    expect(validateUrl('http://127.255.255.255/').ok).toBe(false);
  });

  it('rejects RFC1918 private ranges', () => {
    expect(validateUrl('http://10.0.0.1/').ok).toBe(false);
    expect(validateUrl('http://192.168.1.1/').ok).toBe(false);
    expect(validateUrl('http://172.16.0.5/').ok).toBe(false);
    expect(validateUrl('http://172.31.255.255/').ok).toBe(false);
  });

  it('rejects link-local 169.254.0.0/16', () => {
    expect(validateUrl('http://169.254.169.254/').ok).toBe(false); // AWS IMDS
  });

  it('rejects CGNAT 100.64.0.0/10', () => {
    expect(validateUrl('http://100.64.0.1/').ok).toBe(false);
  });

  it('rejects IPv6 loopback', () => {
    expect(validateUrl('http://[::1]/').ok).toBe(false);
  });

  it('accepts non-private addresses', () => {
    expect(validateUrl('http://172.32.0.1/').ok).toBe(true); // 172.32 is OUTSIDE RFC1918
    expect(validateUrl('http://8.8.8.8/').ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isPrivateOrLocalHost — direct unit coverage of the SSRF predicate
// ---------------------------------------------------------------------------

describe('isPrivateOrLocalHost', () => {
  it('flags empty hostname as private', () => {
    expect(isPrivateOrLocalHost('')).toBe(true);
  });

  it('flags the .local mDNS suffix', () => {
    expect(isPrivateOrLocalHost('memu.local')).toBe(true);
  });

  it('does not flag normal public hostnames', () => {
    expect(isPrivateOrLocalHost('example.com')).toBe(false);
    expect(isPrivateOrLocalHost('news.bbc.co.uk')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitiseHtml
// ---------------------------------------------------------------------------

describe('sanitiseHtml', () => {
  it('strips <script> blocks including contents', () => {
    const html = '<p>hello</p><script>alert(1)</script><p>world</p>';
    const out = sanitiseHtml(html);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  it('strips <style> blocks', () => {
    const html = '<style>body{color:red}</style><p>x</p>';
    expect(sanitiseHtml(html)).not.toContain('<style');
    expect(sanitiseHtml(html)).not.toContain('color:red');
  });

  it('strips <iframe>, <noscript>, <svg>, <form>', () => {
    const html = '<iframe src="x"></iframe><noscript>n</noscript><svg><circle/></svg><form><input/></form><p>k</p>';
    const out = sanitiseHtml(html);
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<noscript');
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('<form');
    expect(out).toContain('k');
  });

  it('strips HTML comments including conditional ones', () => {
    const html = '<!-- comment --><p>a</p><!--[if IE]>...<![endif]-->';
    const out = sanitiseHtml(html);
    expect(out).not.toContain('<!--');
    expect(out).toContain('a');
  });

  it('preserves <p>, <h1>, <a>, <strong>, <em>', () => {
    const html = '<h1>Title</h1><p>body <a href="/x">link</a> <strong>bold</strong> <em>i</em></p>';
    const out = sanitiseHtml(html);
    expect(out).toContain('<h1>');
    expect(out).toContain('<p>');
    expect(out).toContain('<a');
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
  });

  it('handles unclosed script tags by stripping the open tag', () => {
    const html = '<script src="x.js"><p>visible after</p>';
    const out = sanitiseHtml(html);
    expect(out).not.toContain('<script');
  });
});

// ---------------------------------------------------------------------------
// decodeEntities
// ---------------------------------------------------------------------------

describe('decodeEntities', () => {
  it('decodes the named entity set we care about', () => {
    expect(decodeEntities('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(decodeEntities('1 &lt; 2')).toBe('1 < 2');
    expect(decodeEntities('2 &gt; 1')).toBe('2 > 1');
    expect(decodeEntities('he said &quot;hi&quot;')).toBe('he said "hi"');
    expect(decodeEntities("don&#39;t")).toBe("don't");
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
  });

  it('decodes numeric decimal entities', () => {
    expect(decodeEntities('&#8212;')).toBe('—'); // em dash
  });

  it('decodes numeric hex entities', () => {
    expect(decodeEntities('&#x2014;')).toBe('—');
  });

  it('passes through plain text unchanged', () => {
    expect(decodeEntities('hello world')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// htmlToMarkdown
// ---------------------------------------------------------------------------

describe('htmlToMarkdown', () => {
  it('converts heading levels', () => {
    const md = htmlToMarkdown('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    expect(md).toContain('# One');
    expect(md).toContain('## Two');
    expect(md).toContain('### Three');
  });

  it('converts paragraphs to blocks with blank lines', () => {
    const md = htmlToMarkdown('<p>first</p><p>second</p>');
    expect(md).toBe('first\n\nsecond');
  });

  it('converts <br> to newlines', () => {
    const md = htmlToMarkdown('<p>line one<br>line two</p>');
    expect(md).toContain('line one');
    expect(md).toContain('line two');
  });

  it('preserves link text and href', () => {
    const md = htmlToMarkdown('<p>see <a href="https://example.com/x">the article</a></p>');
    expect(md).toContain('[the article](https://example.com/x)');
  });

  it('converts strong/b to **', () => {
    expect(htmlToMarkdown('<strong>bold</strong>')).toContain('**bold**');
    expect(htmlToMarkdown('<b>bold</b>')).toContain('**bold**');
  });

  it('converts em/i to *', () => {
    expect(htmlToMarkdown('<em>it</em>')).toContain('*it*');
    expect(htmlToMarkdown('<i>it</i>')).toContain('*it*');
  });

  it('converts inline <code> to backticks', () => {
    expect(htmlToMarkdown('<p>run <code>npm test</code></p>')).toContain('`npm test`');
  });

  it('converts <pre> blocks to triple-backtick blocks', () => {
    const md = htmlToMarkdown('<pre><code>const x = 1;\nconsole.log(x);</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
    expect(md).toContain('console.log(x);');
  });

  it('converts unordered lists to "- " items', () => {
    const md = htmlToMarkdown('<ul><li>alpha</li><li>beta</li></ul>');
    expect(md).toContain('- alpha');
    expect(md).toContain('- beta');
  });

  it('converts ordered lists to "1. " items with incrementing numbers', () => {
    const md = htmlToMarkdown('<ol><li>one</li><li>two</li><li>three</li></ol>');
    expect(md).toContain('1. one');
    expect(md).toContain('2. two');
    expect(md).toContain('3. three');
  });

  it('handles nested lists', () => {
    const md = htmlToMarkdown('<ul><li>outer<ul><li>inner</li></ul></li></ul>');
    expect(md).toContain('outer');
    expect(md).toContain('inner');
    // The inner item should be indented relative to outer.
    expect(md).toMatch(/-\s+outer[\s\S]*-\s+inner/);
  });

  it('converts blockquotes with "> " prefix', () => {
    const md = htmlToMarkdown('<blockquote><p>quoted</p></blockquote>');
    expect(md).toContain('> quoted');
  });

  it('decodes entities in body text', () => {
    const md = htmlToMarkdown('<p>Tom &amp; Jerry &mdash;ish</p>');
    expect(md).toContain('Tom & Jerry');
  });

  it('strips unknown tags but keeps inner text', () => {
    const md = htmlToMarkdown('<p>before <custom-tag>kept</custom-tag> after</p>');
    expect(md).toContain('before');
    expect(md).toContain('kept');
    expect(md).toContain('after');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractMainContent
// ---------------------------------------------------------------------------

describe('extractMainContent', () => {
  it('prefers <article> when present', () => {
    const html = `
      <html><head><title>Site</title></head>
      <body>
        <nav><a href="/x">menu</a></nav>
        <article><h1>Article H1</h1><p>article body text here</p></article>
        <footer>nope</footer>
      </body></html>`;
    const r = extractMainContent(sanitiseHtml(html));
    expect(r.title).toBe('Article H1');
    expect(r.bodyHtml).toContain('article body text here');
    expect(r.bodyHtml).not.toContain('menu');
    expect(r.bodyHtml).not.toContain('nope');
  });

  it('falls back to <body> when no <article> or <main>', () => {
    const html = `
      <html><head><title>NoArticle</title></head>
      <body><p>just a paragraph in body</p></body></html>`;
    const r = extractMainContent(sanitiseHtml(html));
    expect(r.bodyHtml).toContain('just a paragraph in body');
    // Title falls back to <title>.
    expect(r.title).toBe('NoArticle');
  });

  it('strips <nav>, <header>, <footer>, <aside> from the chosen body', () => {
    const html = `
      <html><body>
        <main>
          <nav>menu items here</nav>
          <header>header chrome</header>
          <h1>Real Title</h1>
          <p>real paragraph</p>
          <aside>sidebar</aside>
          <footer>foot</footer>
        </main>
      </body></html>`;
    const r = extractMainContent(sanitiseHtml(html));
    expect(r.bodyHtml).toContain('real paragraph');
    expect(r.bodyHtml).not.toContain('menu items here');
    expect(r.bodyHtml).not.toContain('header chrome');
    expect(r.bodyHtml).not.toContain('sidebar');
    expect(r.bodyHtml).not.toContain('foot');
  });

  it('picks the largest <article> when multiple are present', () => {
    const html = `
      <body>
        <article><p>tiny</p></article>
        <article><h1>Big</h1><p>${'word '.repeat(100)}</p></article>
      </body>`;
    const r = extractMainContent(sanitiseHtml(html));
    expect(r.title).toBe('Big');
    expect(r.bodyHtml.length).toBeGreaterThan(200);
  });

  it('falls back to og:title when no <h1>', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="OG Title Here"/>
        <title>Window Title</title>
      </head>
      <body><article><p>body</p></article></body></html>`;
    const r = extractMainContent(sanitiseHtml(html));
    expect(r.title).toBe('OG Title Here');
  });

  it('returns Untitled when no title source exists', () => {
    const html = '<body><article><p>just body</p></article></body>';
    const r = extractMainContent(sanitiseHtml(html));
    expect(r.title).toBe('Untitled');
  });
});

// ---------------------------------------------------------------------------
// extractMetadataHints
// ---------------------------------------------------------------------------

describe('extractMetadataHints', () => {
  it('parses author from <meta name="author">', () => {
    const html = '<head><meta name="author" content="Jane Doe"/></head>';
    expect(extractMetadataHints(html).author).toBe('Jane Doe');
  });

  it('parses article:published_time', () => {
    const html = '<head><meta property="article:published_time" content="2026-05-12T09:00:00Z"/></head>';
    expect(extractMetadataHints(html).publishedDate).toBe('2026-05-12T09:00:00Z');
  });

  it('falls back to <time datetime=""> for the published date', () => {
    const html = '<body><time datetime="2026-04-01">April 1</time></body>';
    expect(extractMetadataHints(html).publishedDate).toBe('2026-04-01');
  });

  it('parses og:site_name', () => {
    const html = '<head><meta property="og:site_name" content="The Guardian"/></head>';
    expect(extractMetadataHints(html).siteName).toBe('The Guardian');
  });

  it('handles meta tags with attributes in reverse order', () => {
    const html = '<head><meta content="Bob Smith" name="author"/></head>';
    expect(extractMetadataHints(html).author).toBe('Bob Smith');
  });

  it('returns empty object when no hints found', () => {
    expect(extractMetadataHints('<html><body><p>nothing</p></body></html>')).toEqual({});
  });

  it('prefers article:published_time over <time>', () => {
    const html = `
      <head><meta property="article:published_time" content="2026-05-01"/></head>
      <body><time datetime="2020-01-01">old</time></body>`;
    expect(extractMetadataHints(html).publishedDate).toBe('2026-05-01');
  });
});

// ---------------------------------------------------------------------------
// buildFrontmatter
// ---------------------------------------------------------------------------

describe('buildFrontmatter', () => {
  it('emits a minimal frontmatter block with title + source', () => {
    const fm = buildFrontmatter({ title: 'X', url: 'https://example.com/' });
    expect(fm.startsWith('---')).toBe(true);
    expect(fm.endsWith('---')).toBe(true);
    expect(fm).toContain('title: X');
    expect(fm).toContain('source: https://example.com/');
  });

  it('includes optional author / published / site fields', () => {
    const fm = buildFrontmatter({
      title: 'X',
      url: 'https://example.com/',
      author: 'Jane',
      publishedDate: '2026-01-01',
      siteName: 'The Site',
    });
    expect(fm).toContain('author: Jane');
    expect(fm).toContain('published: 2026-01-01');
    expect(fm).toContain('site: The Site');
  });

  it('collapses newlines in title to spaces', () => {
    const fm = buildFrontmatter({ title: 'Multi\nLine', url: 'https://x/' });
    expect(fm).toContain('title: Multi Line');
  });
});

// ---------------------------------------------------------------------------
// deriveFilenameFromUrl
// ---------------------------------------------------------------------------

describe('deriveFilenameFromUrl', () => {
  it('uses the last path segment', () => {
    expect(deriveFilenameFromUrl('https://example.com/blog/how-to-x')).toBe('how-to-x.md');
  });

  it('falls back to hostname when path is empty', () => {
    expect(deriveFilenameFromUrl('https://example.com/')).toBe('example.com.md');
  });

  it('strips file-extension suffixes (we write .md anyway)', () => {
    expect(deriveFilenameFromUrl('https://example.com/page.html')).toBe('page.md');
  });

  it('sanitises unsafe filename characters', () => {
    expect(deriveFilenameFromUrl('https://example.com/path/with spaces and?query=1'))
      .toMatch(/^with-spaces-and.*\.md$/);
  });

  it('returns a safe default for unparseable URLs', () => {
    expect(deriveFilenameFromUrl('not-a-url')).toBe('url-source.md');
  });
});

// ---------------------------------------------------------------------------
// assembleMarkdown — round-trip a known fixture
// ---------------------------------------------------------------------------

describe('assembleMarkdown', () => {
  it('emits frontmatter then # heading then body', () => {
    const out = assembleMarkdown({
      title: 'The Article',
      finalUrl: 'https://example.com/x',
      metadata: { author: 'Jane', publishedDate: '2026-01-01' },
      bodyMarkdown: 'paragraph one.\n\nparagraph two.',
    });
    expect(out.startsWith('---')).toBe(true);
    expect(out).toContain('title: The Article');
    expect(out).toContain('# The Article');
    expect(out).toContain('paragraph one.');
    expect(out).toContain('paragraph two.');
  });

  it('includes the caption as a blockquote when provided', () => {
    const out = assembleMarkdown({
      title: 'X',
      finalUrl: 'https://example.com/x',
      metadata: {},
      bodyMarkdown: 'body',
      caption: 'why I saved this',
    });
    expect(out).toContain('> why I saved this');
  });

  it('falls back to bylineHint when metadata.author is missing', () => {
    const out = assembleMarkdown({
      title: 'X',
      finalUrl: 'https://example.com/x',
      metadata: {},
      bodyMarkdown: 'b',
      bylineHint: 'Posted by Alex',
    });
    expect(out).toContain('author: Posted by Alex');
  });
});
