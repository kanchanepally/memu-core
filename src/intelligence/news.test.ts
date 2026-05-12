import { describe, it, expect } from 'vitest';
import { parseRssItems } from './news';

describe('parseRssItems', () => {
  it('extracts title, link, pubDate, and media:thumbnail from BBC-shape RSS', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
        <channel>
          <item>
            <title>King visits Devon farms</title>
            <link>https://example.com/devon-farms</link>
            <pubDate>Mon, 12 May 2026 09:00:00 GMT</pubDate>
            <media:thumbnail url="https://example.com/img/devon.jpg" width="800" height="600"/>
          </item>
        </channel>
      </rss>`;
    const items = parseRssItems(xml, 10);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('King visits Devon farms');
    expect(items[0].link).toBe('https://example.com/devon-farms');
    expect(items[0].pubDate).toBe('Mon, 12 May 2026 09:00:00 GMT');
    expect(items[0].imageUrl).toBe('https://example.com/img/devon.jpg');
  });

  it('falls back to media:content image when no media:thumbnail', () => {
    const xml = `<rss><channel><item>
      <title>Rates likely cut</title>
      <link>https://example.com/rates</link>
      <media:content url="https://example.com/img/rates.jpg" type="image/jpeg"/>
    </item></channel></rss>`;
    const items = parseRssItems(xml, 10);
    expect(items[0].imageUrl).toBe('https://example.com/img/rates.jpg');
  });

  it('falls back to enclosure tag (image/* type)', () => {
    const xml = `<rss><channel><item>
      <title>Local headline</title>
      <link>https://example.com/local</link>
      <enclosure url="https://example.com/img/local.png" type="image/png" length="123"/>
    </item></channel></rss>`;
    expect(parseRssItems(xml, 10)[0].imageUrl).toBe('https://example.com/img/local.png');
  });

  it('handles enclosure with type-then-url attribute order', () => {
    const xml = `<rss><channel><item>
      <title>Reverse order</title>
      <link>https://example.com/reverse</link>
      <enclosure type="image/jpeg" url="https://example.com/img/reverse.jpg"/>
    </item></channel></rss>`;
    expect(parseRssItems(xml, 10)[0].imageUrl).toBe('https://example.com/img/reverse.jpg');
  });

  it('decodes XML entities and CDATA in titles', () => {
    const xml = `<rss><channel><item>
      <title><![CDATA[News &amp; weather: it's drizzly]]></title>
      <link>https://example.com/x</link>
    </item></channel></rss>`;
    expect(parseRssItems(xml, 10)[0].title).toBe("News & weather: it's drizzly");
  });

  it('drops items with no link or invalid (non-https) link', () => {
    const xml = `<rss><channel>
      <item><title>No link</title></item>
      <item><title>Bad link</title><link>not-a-url</link></item>
      <item><title>Good link</title><link>https://example.com/ok</link></item>
    </channel></rss>`;
    const items = parseRssItems(xml, 10);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Good link');
  });

  it('respects the max parameter', () => {
    const xml = `<rss><channel>
      <item><title>One</title><link>https://example.com/1</link></item>
      <item><title>Two</title><link>https://example.com/2</link></item>
      <item><title>Three</title><link>https://example.com/3</link></item>
    </channel></rss>`;
    expect(parseRssItems(xml, 2)).toHaveLength(2);
    expect(parseRssItems(xml, 10)).toHaveLength(3);
  });

  it('handles Atom-style <link href="..." /> elements', () => {
    const xml = `<feed><entry>
      <title>Atom item</title>
      <link href="https://example.com/atom" rel="alternate"/>
    </entry></feed>`;
    // Atom uses <entry> not <item> — so this regex shouldn't match.
    expect(parseRssItems(xml, 10)).toHaveLength(0);

    // But within an <item>, the Atom-shaped href fallback should work.
    const mixed = `<rss><channel><item>
      <title>Mixed</title>
      <link href="https://example.com/mixed"/>
    </item></channel></rss>`;
    expect(parseRssItems(mixed, 10)[0].link).toBe('https://example.com/mixed');
  });

  it('returns empty array for malformed / non-RSS input', () => {
    expect(parseRssItems('', 10)).toEqual([]);
    expect(parseRssItems('<not-rss/>', 10)).toEqual([]);
    expect(parseRssItems('plain text', 10)).toEqual([]);
  });

  it('skips items with titles >250 chars (likely parser garbage)', () => {
    const longTitle = 'a'.repeat(260);
    const xml = `<rss><channel>
      <item><title>${longTitle}</title><link>https://example.com/long</link></item>
      <item><title>Normal</title><link>https://example.com/normal</link></item>
    </channel></rss>`;
    const items = parseRssItems(xml, 10);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Normal');
  });
});
