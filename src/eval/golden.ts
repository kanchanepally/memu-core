import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import { isExpectedRetrievalState, type GoldenQuery } from './types';

export function parseGoldenQuery(id: string, raw: string): GoldenQuery {
  const parsed = matter(raw);
  const fm = parsed.data ?? {};
  const body = (parsed.content ?? '').trim();
  if (!body) {
    throw new Error(`[eval] golden query ${id}: missing query body`);
  }
  const uris = fm.expected_space_uris;
  if (!Array.isArray(uris) || uris.some(u => typeof u !== 'string')) {
    throw new Error(`[eval] golden query ${id}: expected_space_uris must be string[]`);
  }
  const state = fm.expected_retrieval_state;
  if (!isExpectedRetrievalState(state)) {
    throw new Error(`[eval] golden query ${id}: expected_retrieval_state '${state}' invalid`);
  }
  return {
    id,
    query: body,
    expectedSpaceUris: uris as string[],
    expectedRetrievalState: state,
    notes: typeof fm.notes === 'string' ? fm.notes : undefined,
  };
}

export function loadGoldenQueries(dir: string): GoldenQuery[] {
  const entries = readdirSync(dir).filter(f => f.endsWith('.md'));
  return entries.map(f => {
    const id = f.replace(/\.md$/, '');
    const raw = readFileSync(resolve(dir, f), 'utf8');
    return parseGoldenQuery(id, raw);
  });
}
