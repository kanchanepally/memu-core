import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildWebId,
  buildProfileDocUrl,
  buildStorageUri,
  resolveWebIdBaseUrl,
  serializeTurtle,
  serializeJsonLd,
  negotiateContentType,
  type WebIdProfile,
} from './webid';

const hareesh: WebIdProfile = {
  id: 'e6a4...-internal',
  slug: 'hareesh',
  displayName: 'Hareesh Kanchanepally',
  role: 'adult',
  email: 'hareesh@example.com',
};

describe('resolveWebIdBaseUrl', () => {
  const originalEnv = process.env.MEMU_WEBID_BASE_URL;
  const originalPublic = process.env.PUBLIC_BASE_URL;

  afterEach(() => {
    process.env.MEMU_WEBID_BASE_URL = originalEnv;
    process.env.PUBLIC_BASE_URL = originalPublic;
  });

  it('prefers MEMU_WEBID_BASE_URL and strips trailing slash', () => {
    process.env.MEMU_WEBID_BASE_URL = 'https://memu-hub.local/';
    expect(resolveWebIdBaseUrl()).toBe('https://memu-hub.local');
  });

  it('falls back to PUBLIC_BASE_URL', () => {
    process.env.MEMU_WEBID_BASE_URL = '';
    process.env.PUBLIC_BASE_URL = 'https://hareesh.memu.digital';
    expect(resolveWebIdBaseUrl()).toBe('https://hareesh.memu.digital');
  });

  it('defaults to localhost in development', () => {
    delete process.env.MEMU_WEBID_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    const resolved = resolveWebIdBaseUrl();
    expect(resolved.startsWith('http://localhost:')).toBe(true);
  });
});

describe('URL builders', () => {
  const base = 'https://memu-hub.local';

  it('builds a WebID with #me fragment', () => {
    expect(buildWebId('hareesh', base)).toBe('https://memu-hub.local/people/hareesh#me');
  });

  it('builds the profile document URL without fragment', () => {
    expect(buildProfileDocUrl('hareesh', base)).toBe('https://memu-hub.local/people/hareesh');
  });

  it('builds a storage pointer with trailing slash', () => {
    expect(buildStorageUri('hareesh', base)).toBe('https://memu-hub.local/spaces/hareesh/');
  });

  it('url-encodes slugs with special chars', () => {
    // Shouldn't happen in practice — slugs are alnum+dash — but be safe.
    expect(buildWebId('a b', base)).toContain('a%20b');
  });
});

describe('serializeTurtle', () => {
  const base = 'https://memu-hub.local';

  it('produces a valid document with required Solid fields', () => {
    const ttl = serializeTurtle(hareesh, { baseUrlOverride: base });
    expect(ttl).toContain('@prefix foaf: <http://xmlns.com/foaf/0.1/>');
    expect(ttl).toContain('@prefix solid: <http://www.w3.org/ns/solid/terms#>');
    expect(ttl).toContain('foaf:PersonalProfileDocument');
    expect(ttl).toContain('foaf:primaryTopic :me');
    expect(ttl).toContain('foaf:name "Hareesh Kanchanepally"');
    expect(ttl).toContain('solid:oidcIssuer <https://memu-hub.local>');
    expect(ttl).toContain('solid:storage <https://memu-hub.local/spaces/hareesh/>');
    expect(ttl).toContain('pim:storage <https://memu-hub.local/spaces/hareesh/>');
    expect(ttl).toContain('solid:publicTypeIndex <https://memu-hub.local/typeIndex>');
  });

  it('ends the :me block with a period, not a semicolon', () => {
    const ttl = serializeTurtle(hareesh, { baseUrlOverride: base });
    const lines = ttl.trimEnd().split('\n');
    const last = lines[lines.length - 1];
    expect(last.trim().endsWith('.')).toBe(true);
  });

  it('omits email when includePrivate is false', () => {
    const ttl = serializeTurtle(hareesh, { baseUrlOverride: base });
    expect(ttl).not.toContain('mailto:');
  });

  it('includes email when includePrivate is true', () => {
    const ttl = serializeTurtle(hareesh, { baseUrlOverride: base, includePrivate: true });
    expect(ttl).toContain('foaf:mbox <mailto:hareesh@example.com>');
  });

  it('escapes double quotes inside display names', () => {
    const quirky: WebIdProfile = { ...hareesh, displayName: 'A "Tricky" Name' };
    const ttl = serializeTurtle(quirky, { baseUrlOverride: base });
    expect(ttl).toContain('"A \\"Tricky\\" Name"');
  });
});

describe('serializeJsonLd', () => {
  const base = 'https://memu-hub.local';

  it('produces two nodes: the document and the subject', () => {
    const doc = serializeJsonLd(hareesh, { baseUrlOverride: base }) as any;
    expect(doc['@graph']).toHaveLength(2);

    const person = doc['@graph'].find((n: any) => n['@id'] === 'https://memu-hub.local/people/hareesh#me');
    expect(person).toBeTruthy();
    expect(person['http://xmlns.com/foaf/0.1/name']).toBe('Hareesh Kanchanepally');
    expect(person['http://www.w3.org/ns/solid/terms#oidcIssuer']).toEqual({ '@id': 'https://memu-hub.local' });
    expect(person['http://www.w3.org/ns/solid/terms#publicTypeIndex']).toEqual({ '@id': 'https://memu-hub.local/typeIndex' });
  });
});

describe('negotiateContentType', () => {
  it('returns turtle when no Accept header', () => {
    expect(negotiateContentType(undefined)).toBe('text/turtle');
  });

  it('honours explicit JSON-LD', () => {
    expect(negotiateContentType('application/ld+json')).toBe('application/ld+json');
  });

  it('returns turtle for bare application/json', () => {
    // Bare JSON doesn't imply JSON-LD awareness.
    expect(negotiateContentType('application/json')).toBe('text/turtle');
  });

  it('returns turtle for wildcard', () => {
    expect(negotiateContentType('*/*')).toBe('text/turtle');
  });

  it('honours text/turtle explicitly', () => {
    expect(negotiateContentType('text/turtle, text/html')).toBe('text/turtle');
  });
});
