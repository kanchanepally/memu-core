/**
 * Story 2.1 — pure-logic tests for the retrieval module's parsers and
 * prompt-block builders. The full retrieveForQuery requires DB + LLM
 * and is covered by manual QA per the story DoD.
 */

import { describe, it, expect } from 'vitest';
import {
  parseMatcherResponse,
  renderSpacesForPrompt,
  renderEmbeddingsForPrompt,
  buildContextBlock,
} from './retrieval';
import type { Space } from './model';

describe('parseMatcherResponse', () => {
  it('parses a clean JSON object with uris', () => {
    expect(parseMatcherResponse('{"uris": ["memu://a/b/1", "memu://a/b/2"]}').uris)
      .toEqual(['memu://a/b/1', 'memu://a/b/2']);
  });

  it('parses despite ```json fences', () => {
    const text = '```json\n{"uris": ["memu://a/b/1"]}\n```';
    expect(parseMatcherResponse(text).uris).toEqual(['memu://a/b/1']);
  });

  it('returns empty on garbage', () => {
    expect(parseMatcherResponse('not json at all').uris).toEqual([]);
  });

  it('returns empty when uris key is missing', () => {
    expect(parseMatcherResponse('{"other": "thing"}').uris).toEqual([]);
  });

  it('drops non-string entries', () => {
    expect(parseMatcherResponse('{"uris": ["ok", 42, null, "ok2"]}').uris).toEqual(['ok', 'ok2']);
  });
});

const swimSpace: Space = {
  uri: 'memu://fam/routine/swim',
  id: 'swim',
  familyId: 'fam',
  category: 'routine',
  slug: 'swim',
  name: 'Swimming',
  description: 'Thursday pool',
  domains: ['health'],
  people: ['robin'],
  visibility: 'family',
  confidence: 0.9,
  sourceReferences: [],
  tags: [],
  bodyMarkdown: 'Thursday 4-5pm at the leisure centre.',
  lastUpdated: new Date('2026-04-15T10:00:00Z'),
};

describe('renderSpacesForPrompt', () => {
  it('returns empty string for no spaces', () => {
    expect(renderSpacesForPrompt([])).toBe('');
  });
  it('renders a Space with uri, confidence, and body', () => {
    const out = renderSpacesForPrompt([swimSpace]);
    expect(out).toContain('memu://fam/routine/swim');
    expect(out).toContain('confidence: 0.9');
    expect(out).toContain('Thursday 4-5pm');
    expect(out).toContain('=== END SPACE ===');
  });
});

describe('renderEmbeddingsForPrompt', () => {
  it('numbers contexts starting at 1', () => {
    const out = renderEmbeddingsForPrompt(['fact one', 'fact two']);
    expect(out).toBe('[1] fact one\n[2] fact two');
  });
});

describe('buildContextBlock', () => {
  it('prefers compiled Spaces when available', () => {
    const block = buildContextBlock({
      spaces: [swimSpace],
      embeddingContexts: ['stale fact'],
      provenance: { path: 'direct', spaceUris: [swimSpace.uri], embeddingHits: 0 },
    });
    expect(block).toContain('COMPILED FAMILY UNDERSTANDING');
    expect(block).not.toContain('stale fact');
  });

  it('falls back to embeddings when no Space matched', () => {
    const block = buildContextBlock({
      spaces: [],
      embeddingContexts: ['only fact'],
      provenance: { path: 'embedding', spaceUris: [], embeddingHits: 1 },
    });
    expect(block).toContain('raw recall');
    expect(block).toContain('only fact');
  });

  it('returns empty block when nothing was retrieved', () => {
    const block = buildContextBlock({
      spaces: [],
      embeddingContexts: [],
      provenance: { path: 'none', spaceUris: [], embeddingHits: 0 },
    });
    expect(block).toBe('');
  });
});
