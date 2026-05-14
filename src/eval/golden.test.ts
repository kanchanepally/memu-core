import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadGoldenQueries, parseGoldenQuery } from './golden';

const FIXTURES = resolve(__dirname, '__fixtures__');

describe('parseGoldenQuery', () => {
  it('parses a well-formed query file', () => {
    const raw = [
      '---',
      'expected_space_uris:',
      '  - memu://x/person/a',
      '  - memu://x/person/b',
      'expected_retrieval_state: catalogue',
      'notes: hello',
      '---',
      'Body text here.',
      'Across two lines.',
      '',
    ].join('\n');

    const q = parseGoldenQuery('q1', raw);
    expect(q.id).toBe('q1');
    expect(q.query).toBe('Body text here.\nAcross two lines.');
    expect(q.expectedSpaceUris).toEqual([
      'memu://x/person/a',
      'memu://x/person/b',
    ]);
    expect(q.expectedRetrievalState).toBe('catalogue');
    expect(q.notes).toBe('hello');
  });

  it('rejects an unknown expected_retrieval_state', () => {
    const raw = [
      '---',
      'expected_space_uris: []',
      'expected_retrieval_state: garbage',
      '---',
      'q',
      '',
    ].join('\n');
    expect(() => parseGoldenQuery('q1', raw)).toThrow(/expected_retrieval_state/);
  });

  it('rejects a missing query body', () => {
    const raw = [
      '---',
      'expected_space_uris: []',
      'expected_retrieval_state: empty',
      '---',
      '',
    ].join('\n');
    expect(() => parseGoldenQuery('q1', raw)).toThrow(/query body/);
  });
});

describe('loadGoldenQueries', () => {
  it('loads the fixture directory', () => {
    const queries = loadGoldenQueries(FIXTURES);
    expect(queries).toHaveLength(1);
    expect(queries[0].id).toBe('sample-query');
    expect(queries[0].expectedRetrievalState).toBe('direct');
  });

  it('skips README.md, dot-files, and underscore-prefixed files', () => {
    // Real directory has README.md alongside query files — loader must
    // not try to parse the docs as a query.
    const real = resolve(__dirname, '..', '..', 'eval', 'golden');
    const queries = loadGoldenQueries(real);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every(q => q.id !== 'README')).toBe(true);
    expect(queries.every(q => !q.id.startsWith('_'))).toBe(true);
    expect(queries.every(q => !q.id.startsWith('.'))).toBe(true);
  });
});
