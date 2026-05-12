import { describe, it, expect } from 'vitest';
import { normalisePreferences } from './brief';

describe('normalisePreferences', () => {
  it('returns defaults for empty / null / undefined input', () => {
    const defaults = normalisePreferences({});
    expect(defaults.location).toBeUndefined();
    expect(defaults.newsSources).toEqual(['bbc-news', 'guardian-uk', 'hacker-news', 'regional']);
    expect(defaults.topics).toEqual([]);
    expect(defaults.thinkingPromptEnabled).toBe(true);

    expect(normalisePreferences(null)).toEqual(defaults);
    expect(normalisePreferences(undefined)).toEqual(defaults);
    expect(normalisePreferences('not-an-object')).toEqual(defaults);
    expect(normalisePreferences(42)).toEqual(defaults);
  });

  it('preserves a fully-shaped preferences object', () => {
    const input = {
      location: { lat: 50.39, lon: -3.92, placeName: 'Ivybridge' },
      newsSources: ['bbc-news', 'devon-live'],
      topics: ['AI', 'gardening'],
      thinkingPromptEnabled: false,
    };
    const out = normalisePreferences(input);
    expect(out.location).toEqual({ lat: 50.39, lon: -3.92, placeName: 'Ivybridge' });
    expect(out.newsSources).toEqual(['bbc-news', 'devon-live']);
    expect(out.topics).toEqual(['AI', 'gardening']);
    expect(out.thinkingPromptEnabled).toBe(false);
  });

  it('drops malformed location (missing fields, NaN coords, empty place name)', () => {
    expect(normalisePreferences({ location: { lat: 1, lon: 2 } }).location).toBeUndefined();
    expect(normalisePreferences({ location: { lat: NaN, lon: 0, placeName: 'x' } }).location).toBeUndefined();
    expect(normalisePreferences({ location: { lat: 0, lon: NaN, placeName: 'x' } }).location).toBeUndefined();
    expect(normalisePreferences({ location: { lat: 0, lon: 0, placeName: '' } }).location).toBeUndefined();
    expect(normalisePreferences({ location: { lat: 0, lon: 0, placeName: '   ' } }).location).toBeUndefined();
    expect(normalisePreferences({ location: 'not-an-object' }).location).toBeUndefined();
  });

  it('trims placeName whitespace', () => {
    const out = normalisePreferences({ location: { lat: 1, lon: 2, placeName: '  Ivybridge  ' } });
    expect(out.location?.placeName).toBe('Ivybridge');
  });

  it('filters non-string entries from arrays', () => {
    const out = normalisePreferences({
      newsSources: ['bbc-news', 42, null, '', 'guardian-uk'],
      topics: ['AI', 99, false, 'gardening'],
    });
    expect(out.newsSources).toEqual(['bbc-news', 'guardian-uk']);
    expect(out.topics).toEqual(['AI', 'gardening']);
  });

  it('falls back to default sources when array is empty after filtering', () => {
    const out = normalisePreferences({ newsSources: [42, null, ''] });
    expect(out.newsSources).toEqual(['bbc-news', 'guardian-uk', 'hacker-news', 'regional']);
  });

  it('falls back to default topics (empty) when array is malformed', () => {
    expect(normalisePreferences({ topics: 'not-an-array' }).topics).toEqual([]);
    expect(normalisePreferences({ topics: null }).topics).toEqual([]);
  });

  it('only accepts boolean for thinkingPromptEnabled', () => {
    expect(normalisePreferences({ thinkingPromptEnabled: true }).thinkingPromptEnabled).toBe(true);
    expect(normalisePreferences({ thinkingPromptEnabled: false }).thinkingPromptEnabled).toBe(false);
    expect(normalisePreferences({ thinkingPromptEnabled: 'yes' }).thinkingPromptEnabled).toBe(true);
    expect(normalisePreferences({ thinkingPromptEnabled: 1 }).thinkingPromptEnabled).toBe(true);
  });

  it('treats arrays with all-invalid entries as empty + falls back where appropriate', () => {
    const out = normalisePreferences({
      newsSources: [null, undefined, {}, []],
      topics: [null, undefined, {}, []],
    });
    expect(out.newsSources).toEqual(['bbc-news', 'guardian-uk', 'hacker-news', 'regional']);
    expect(out.topics).toEqual([]);
  });
});
