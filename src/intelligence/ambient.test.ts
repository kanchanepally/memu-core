import { describe, expect, it } from 'vitest';
import { describeWeatherCode, parseRssTitles, unescapeXmlText } from './ambient';

describe('describeWeatherCode', () => {
  it('maps clear sky code 0 to "clear"', () => {
    expect(describeWeatherCode(0)).toBe('clear');
  });

  it('maps mostly clear codes 1–2', () => {
    expect(describeWeatherCode(1)).toBe('mostly clear');
    expect(describeWeatherCode(2)).toBe('mostly clear');
  });

  it('maps overcast (3)', () => {
    expect(describeWeatherCode(3)).toBe('overcast');
  });

  it('maps fog range 45–48', () => {
    expect(describeWeatherCode(45)).toBe('foggy');
    expect(describeWeatherCode(48)).toBe('foggy');
  });

  it('maps drizzle range 51–57', () => {
    expect(describeWeatherCode(51)).toBe('drizzly');
    expect(describeWeatherCode(57)).toBe('drizzly');
  });

  it('maps rain range 61–67', () => {
    expect(describeWeatherCode(63)).toBe('rainy');
  });

  it('maps shower range 80–82', () => {
    expect(describeWeatherCode(81)).toBe('showery');
  });

  it('maps thunderstorm 95+', () => {
    expect(describeWeatherCode(95)).toBe('thundery');
    expect(describeWeatherCode(99)).toBe('thundery');
  });

  it('falls back gracefully on unknown codes', () => {
    expect(describeWeatherCode(-1)).toBe('mixed conditions');
    expect(describeWeatherCode(60)).toBe('mixed conditions');
    expect(describeWeatherCode(90)).toBe('mixed conditions');
  });
});

describe('unescapeXmlText', () => {
  it('strips XML tags', () => {
    expect(unescapeXmlText('<b>Hello</b> <i>World</i>')).toBe('Hello World');
  });

  it('decodes the basic entity set', () => {
    expect(unescapeXmlText('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(unescapeXmlText('&quot;quoted&quot;')).toBe('"quoted"');
    expect(unescapeXmlText('it&apos;s here')).toBe("it's here");
    expect(unescapeXmlText('it&#039;s here')).toBe("it's here");
  });

  it('unwraps CDATA blocks', () => {
    expect(unescapeXmlText('<![CDATA[Breaking: news happened]]>')).toBe('Breaking: news happened');
  });

  it('collapses whitespace', () => {
    expect(unescapeXmlText('a    b\n\nc')).toBe('a b c');
  });

  it('trims leading/trailing whitespace', () => {
    expect(unescapeXmlText('   hello   ')).toBe('hello');
  });
});

describe('parseRssTitles', () => {
  const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BBC News</title>
    <item>
      <title>UK weather: storms expected this weekend</title>
      <link>https://example.com/1</link>
    </item>
    <item>
      <title><![CDATA[PM responds to economic forecast]]></title>
      <link>https://example.com/2</link>
    </item>
    <item>
      <title>Tom &amp; Jerry: who said what</title>
      <link>https://example.com/3</link>
    </item>
  </channel>
</rss>`;

  it('extracts up to N titles', () => {
    const titles = parseRssTitles(sampleRss, 5);
    expect(titles).toHaveLength(3);
    expect(titles[0]).toBe('UK weather: storms expected this weekend');
    expect(titles[1]).toBe('PM responds to economic forecast');
    expect(titles[2]).toBe('Tom & Jerry: who said what');
  });

  it('respects the max limit', () => {
    const titles = parseRssTitles(sampleRss, 2);
    expect(titles).toHaveLength(2);
    expect(titles[0]).toBe('UK weather: storms expected this weekend');
    expect(titles[1]).toBe('PM responds to economic forecast');
  });

  it('returns empty array on malformed feed', () => {
    expect(parseRssTitles('<not-rss/>', 5)).toEqual([]);
    expect(parseRssTitles('', 5)).toEqual([]);
  });

  it('skips empty or absurdly long titles (likely parser noise)', () => {
    const xml = `
      <item><title></title></item>
      <item><title>${'a'.repeat(250)}</title></item>
      <item><title>Real headline</title></item>
    `;
    const titles = parseRssTitles(xml, 5);
    expect(titles).toEqual(['Real headline']);
  });
});
