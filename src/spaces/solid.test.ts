import { describe, it, expect } from 'vitest';
import {
  negotiateSpaceContentType,
  buildSpaceHttpUrl,
  buildSpaceAcpUrl,
  serializeSpaceTurtle,
  serializeSpaceJsonLd,
  serializeAcp,
  serializeContainer,
  serializeTypeIndex,
  defaultTypeIndexEntries,
  buildAcpLookup,
  deriveAllowedReaders,
  MEMU_VOCAB,
} from './solid';
import type { Space, FamilyRoster } from './model';

const BASE = 'https://family.test.memu.digital';

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    uri: 'memu://fam-1/person/uuid-abc',
    id: 'uuid-abc',
    familyId: 'fam-1',
    category: 'person',
    slug: 'robin',
    name: 'Robin',
    description: 'Seven-year-old, swims on Thursdays.',
    domains: ['caregiving', 'health'],
    people: ['profile-robin'],
    visibility: 'family',
    confidence: 0.82,
    sourceReferences: [],
    tags: ['child'],
    bodyMarkdown: '# Robin\n\nLikes lego.',
    lastUpdated: new Date('2026-04-18T09:00:00.000Z'),
    ...overrides,
  };
}

const ROSTER: FamilyRoster = {
  all: ['profile-hareesh', 'profile-rach', 'profile-robin'],
  adults: ['profile-hareesh', 'profile-rach'],
  partners: ['profile-hareesh', 'profile-rach'],
};

describe('negotiateSpaceContentType', () => {
  it('defaults to markdown when no Accept header', () => {
    expect(negotiateSpaceContentType(undefined)).toBe('text/markdown');
  });

  it('honours explicit text/turtle', () => {
    expect(negotiateSpaceContentType('text/turtle')).toBe('text/turtle');
  });

  it('honours explicit application/ld+json', () => {
    expect(negotiateSpaceContentType('application/ld+json')).toBe('application/ld+json');
  });

  it('treats text/n3 as turtle', () => {
    expect(negotiateSpaceContentType('text/n3')).toBe('text/turtle');
  });

  it('falls back to markdown for browser-style text/html', () => {
    expect(negotiateSpaceContentType('text/html,application/xhtml+xml')).toBe('text/markdown');
  });

  it('prefers JSON-LD when both are listed', () => {
    expect(negotiateSpaceContentType('application/ld+json, text/turtle;q=0.5')).toBe('application/ld+json');
  });
});

describe('URL builders', () => {
  it('builds the HTTPS Space URL with category and slug', () => {
    expect(buildSpaceHttpUrl('person', 'robin', BASE)).toBe(`${BASE}/spaces/person/robin`);
  });

  it('builds the ACP URL by appending ?ext=acp', () => {
    expect(buildSpaceAcpUrl('routine', 'morning', BASE)).toBe(`${BASE}/spaces/routine/morning?ext=acp`);
  });

  it('URL-encodes slug components', () => {
    expect(buildSpaceHttpUrl('person', 'name with space', BASE)).toBe(`${BASE}/spaces/person/name%20with%20space`);
  });
});

describe('serializeSpaceTurtle', () => {
  it('emits the standard prefixes and core triples', () => {
    const ttl = serializeSpaceTurtle(makeSpace(), BASE);
    expect(ttl).toContain('@prefix foaf:');
    expect(ttl).toContain('@prefix schema:');
    expect(ttl).toContain('@prefix memu:');
    expect(ttl).toContain('@prefix dcterms:');
    expect(ttl).toContain(`<${BASE}/spaces/person/robin>`);
    expect(ttl).toContain('a <http://schema.org/Person>');
    expect(ttl).toContain('schema:name "Robin"');
  });

  it('includes the bodyMarkdown literal and ACP pointer', () => {
    const ttl = serializeSpaceTurtle(makeSpace(), BASE);
    expect(ttl).toContain('memu:bodyMarkdown "# Robin\\n\\nLikes lego."');
    expect(ttl).toContain(`memu:acpResource <${BASE}/spaces/person/robin?ext=acp>`);
  });

  it('escapes embedded quotes and backslashes', () => {
    const ttl = serializeSpaceTurtle(makeSpace({ name: 'She said "hi" \\ fine' }), BASE);
    expect(ttl).toContain('schema:name "She said \\"hi\\" \\\\ fine"');
  });

  it('emits each domain and tag', () => {
    const ttl = serializeSpaceTurtle(makeSpace(), BASE);
    expect(ttl).toContain('memu:domain "caregiving"');
    expect(ttl).toContain('memu:domain "health"');
    expect(ttl).toContain('memu:tag "child"');
  });

  it('terminates the subject block with a dot', () => {
    const ttl = serializeSpaceTurtle(makeSpace(), BASE);
    expect(ttl.trim().endsWith('.')).toBe(true);
  });

  it('maps each category to the right RDF type', () => {
    expect(serializeSpaceTurtle(makeSpace({ category: 'routine', slug: 'r' }), BASE)).toContain(`a <${MEMU_VOCAB}Routine>`);
    expect(serializeSpaceTurtle(makeSpace({ category: 'household', slug: 'r' }), BASE)).toContain('a <http://schema.org/Place>');
    expect(serializeSpaceTurtle(makeSpace({ category: 'commitment', slug: 'r' }), BASE)).toContain(`a <${MEMU_VOCAB}Commitment>`);
    expect(serializeSpaceTurtle(makeSpace({ category: 'document', slug: 'r' }), BASE)).toContain(`a <${MEMU_VOCAB}Document>`);
  });
});

describe('serializeSpaceJsonLd', () => {
  it('returns a graph with the right @id and @type', () => {
    const jsonld = serializeSpaceJsonLd(makeSpace(), BASE) as any;
    expect(jsonld['@graph']).toHaveLength(1);
    expect(jsonld['@graph'][0]['@id']).toBe(`${BASE}/spaces/person/robin`);
    expect(jsonld['@graph'][0]['@type']).toBe('http://schema.org/Person');
  });

  it('exposes name, body, and ACP pointer', () => {
    const node = (serializeSpaceJsonLd(makeSpace(), BASE) as any)['@graph'][0];
    expect(node['http://schema.org/name']).toBe('Robin');
    expect(node[`${MEMU_VOCAB}bodyMarkdown`]).toBe('# Robin\n\nLikes lego.');
    expect(node[`${MEMU_VOCAB}acpResource`]).toEqual({ '@id': `${BASE}/spaces/person/robin?ext=acp` });
  });

  it('omits description when empty', () => {
    const node = (serializeSpaceJsonLd(makeSpace({ description: '' }), BASE) as any)['@graph'][0];
    expect(node['http://schema.org/description']).toBeUndefined();
  });
});

describe('buildAcpLookup', () => {
  it('maps profile id to WebID for rows with a slug', () => {
    const lookup = buildAcpLookup([
      { id: 'p1', webid_slug: 'hareesh' },
      { id: 'p2', webid_slug: null },
      { id: 'p3', webid_slug: 'robin' },
    ]);
    expect(lookup.webIdForProfileId('p1')).toMatch(/\/people\/hareesh#me$/);
    expect(lookup.webIdForProfileId('p2')).toBeNull();
    expect(lookup.webIdForProfileId('p3')).toMatch(/\/people\/robin#me$/);
    expect(lookup.webIdForProfileId('unknown')).toBeNull();
  });
});

describe('deriveAllowedReaders', () => {
  const lookup = buildAcpLookup([
    { id: 'profile-hareesh', webid_slug: 'hareesh' },
    { id: 'profile-rach', webid_slug: 'rach' },
    { id: 'profile-robin', webid_slug: 'robin' },
  ]);

  it('expands family visibility into every member WebID', () => {
    const out = deriveAllowedReaders(makeSpace({ visibility: 'family' }), ROSTER, lookup);
    expect(out).toHaveLength(3);
    expect(out.some(w => w.endsWith('/people/hareesh#me'))).toBe(true);
    expect(out.some(w => w.endsWith('/people/robin#me'))).toBe(true);
  });

  it('expands adults_only into adults', () => {
    const out = deriveAllowedReaders(makeSpace({ visibility: 'adults_only' }), ROSTER, lookup);
    expect(out).toHaveLength(2);
    expect(out.every(w => !w.endsWith('/people/robin#me'))).toBe(true);
  });

  it('passes explicit https:// URIs through verbatim', () => {
    const external = ['https://otherfamily.example.com/people/sam#me'];
    const out = deriveAllowedReaders(makeSpace({ visibility: external }), ROSTER, lookup);
    expect(out).toEqual(external);
  });

  it('drops profile ids that have no WebID (fail closed)', () => {
    const partialLookup = buildAcpLookup([{ id: 'profile-hareesh', webid_slug: 'hareesh' }]);
    const out = deriveAllowedReaders(makeSpace({ visibility: 'family' }), ROSTER, partialLookup);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/\/people\/hareesh#me$/);
  });

  it('returns an empty list for private with no people', () => {
    const out = deriveAllowedReaders(makeSpace({ visibility: 'private', people: [] }), ROSTER, lookup);
    expect(out).toEqual([]);
  });
});

describe('serializeContainer', () => {
  const containerUrl = `${BASE}/spaces/person/`;

  it('emits an empty BasicContainer when there are no entries', () => {
    const ttl = serializeContainer(containerUrl, []);
    expect(ttl).toContain('a ldp:Container, ldp:BasicContainer');
    expect(ttl).not.toContain('ldp:contains');
    expect(ttl.trim().endsWith('.')).toBe(true);
  });

  it('lists each entry under ldp:contains', () => {
    const ttl = serializeContainer(containerUrl, [
      { url: `${BASE}/spaces/person/robin`, title: 'Robin' },
      { url: `${BASE}/spaces/person/rach`, title: 'Rach' },
    ]);
    expect(ttl).toContain('ldp:contains');
    expect(ttl).toContain(`<${BASE}/spaces/person/robin>`);
    expect(ttl).toContain(`<${BASE}/spaces/person/rach>`);
    expect(ttl).toContain('schema:name "Robin"');
    expect(ttl).toContain('schema:name "Rach"');
  });

  it('terminates the contains list with a dot, not a comma', () => {
    const ttl = serializeContainer(containerUrl, [
      { url: `${BASE}/spaces/person/a` },
      { url: `${BASE}/spaces/person/b` },
    ]);
    expect(ttl).toMatch(/<https:\/\/family\.test\.memu\.digital\/spaces\/person\/b> \./);
  });

  it('includes the ACP pointer when provided', () => {
    const ttl = serializeContainer(containerUrl, [], { acpUrl: `${containerUrl}?ext=acp` });
    expect(ttl).toContain(`<https://memu.digital/vocab#acpResource> <${containerUrl}?ext=acp>`);
  });
});

describe('serializeTypeIndex', () => {
  const url = `${BASE}/typeIndex`;

  it('declares the document as solid:TypeIndex', () => {
    const ttl = serializeTypeIndex(url, defaultTypeIndexEntries(BASE));
    expect(ttl).toContain('a solid:TypeIndex, solid:ListedDocument');
  });

  it('emits one TypeRegistration per default entry', () => {
    const ttl = serializeTypeIndex(url, defaultTypeIndexEntries(BASE));
    for (const cat of ['person', 'routine', 'household', 'commitment', 'document']) {
      expect(ttl).toContain(`<${url}#${cat}>`);
      expect(ttl).toContain(`solid:instanceContainer <${BASE}/spaces/${cat}/>`);
    }
  });

  it('points each registration at the correct RDF class', () => {
    const ttl = serializeTypeIndex(url, defaultTypeIndexEntries(BASE));
    expect(ttl).toContain('solid:forClass <http://schema.org/Person>');
    expect(ttl).toContain('solid:forClass <http://schema.org/Place>');
    expect(ttl).toContain(`solid:forClass <${MEMU_VOCAB}Routine>`);
    expect(ttl).toContain(`solid:forClass <${MEMU_VOCAB}Commitment>`);
    expect(ttl).toContain(`solid:forClass <${MEMU_VOCAB}Document>`);
  });
});

describe('serializeAcp', () => {
  it('default-denies when no readers are allowed', () => {
    const ttl = serializeAcp('person', 'robin', [], BASE);
    expect(ttl).toContain('a acp:AccessControlResource');
    expect(ttl).toContain('memu:note "No agents are authorised');
    expect(ttl).not.toContain('acp:Matcher');
    expect(ttl).not.toContain('foaf:Agent');
  });

  it('emits a Matcher with each agent when populated', () => {
    const webids = ['https://x.test/people/a#me', 'https://x.test/people/b#me'];
    const ttl = serializeAcp('person', 'robin', webids, BASE);
    expect(ttl).toContain('a acp:Matcher');
    expect(ttl).toContain('acp:agent <https://x.test/people/a#me>');
    expect(ttl).toContain('acp:agent <https://x.test/people/b#me>');
    expect(ttl).toContain('acp:allow acl:Read');
  });

  it('terminates the matcher block with a dot, not a semicolon', () => {
    const webids = ['https://x.test/people/a#me'];
    const ttl = serializeAcp('person', 'robin', webids, BASE);
    expect(ttl).toMatch(/acp:agent <https:\/\/x\.test\/people\/a#me> \./);
  });

  it('points at the resource it controls', () => {
    const ttl = serializeAcp('routine', 'mornings', ['https://x.test/people/a#me'], BASE);
    expect(ttl).toContain(`acp:resource <${BASE}/spaces/routine/mornings>`);
  });
});
