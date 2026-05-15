/**
 * Build Spec 2 Phase Z — Story Z.2 tests.
 *
 * The assignPassageIds contract is the load-bearing one — every later
 * story (active-reading toolbar, inbound-connections, theme codings)
 * depends on pids being present and stable. These tests pin:
 *   - every block-level element gets a pid
 *   - existing pids are preserved across re-runs
 *   - reordering blocks preserves their pids
 *   - text edits inside a block preserve the pid
 *   - collision avoidance does what it says
 *   - empty input is a no-op
 *   - stripPassageIds is a clean inverse for renumber semantics
 */

import { describe, it, expect } from 'vitest';
import { assignPassageIds, stripPassageIds, listPassageIds } from './passageIds';

describe('assignPassageIds', () => {
  it('returns input unchanged for empty / whitespace-only body', () => {
    expect(assignPassageIds('')).toBe('');
    expect(assignPassageIds('   \n  \n  ')).toBe('   \n  \n  ');
  });

  it('assigns a pid to a single paragraph', () => {
    const result = assignPassageIds('Hello world.');
    expect(result).toMatch(/<!-- pid:[0123456789abcdefghjkmnpqrstvwxyz]{4,6} -->\nHello world\./);
    expect(listPassageIds(result)).toHaveLength(1);
  });

  it('assigns one pid per paragraph in a multi-paragraph body', () => {
    const body = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const result = assignPassageIds(body);
    expect(listPassageIds(result)).toHaveLength(3);
    // Order preserved.
    expect(result.indexOf('First paragraph')).toBeLessThan(result.indexOf('Second paragraph'));
    expect(result.indexOf('Second paragraph')).toBeLessThan(result.indexOf('Third paragraph'));
  });

  it('assigns pids to headings, paragraphs, and blockquotes together', () => {
    const body = `# Title

Intro paragraph.

> A quote from a participant.

Closing paragraph.`;
    const result = assignPassageIds(body);
    expect(listPassageIds(result)).toHaveLength(4);
  });

  it('treats an entire list as a single block (granularity refinement deferred)', () => {
    const body = `Some items:

- first item
- second item
- third item`;
    const result = assignPassageIds(body);
    // 1 paragraph + 1 list = 2 pids. Per-item granularity is deferred
    // to a Z.2 refinement story; the active-reading layer (R3) doesn't
    // exist yet so we don't know whether per-item is load-bearing or
    // overkill for the prose researchers actually mark up. Treat the
    // whole list as one passage for now.
    expect(listPassageIds(result)).toHaveLength(2);
  });

  it('treats fenced code blocks as a single block', () => {
    const body = "Setup:\n\n```python\ndef foo():\n    return 42\n```\n\nDone.";
    const result = assignPassageIds(body);
    expect(listPassageIds(result)).toHaveLength(3);
    // The pid for the code block lands ABOVE the fence, never inside.
    expect(result).not.toMatch(/```[\s\S]*pid:[\s\S]*```/);
  });

  it('preserves existing pids across a no-op rerun', () => {
    const body = 'Paragraph one.\n\nParagraph two.';
    const first = assignPassageIds(body);
    const second = assignPassageIds(first);
    expect(second).toBe(first);
    expect(listPassageIds(second)).toEqual(listPassageIds(first));
  });

  it('preserves pids when text inside a block changes', () => {
    const original = 'Original text.\n\nUnchanged tail.';
    const tagged = assignPassageIds(original);
    const originalPids = listPassageIds(tagged);
    // Edit the FIRST paragraph's text only — the pid above it
    // travels with the block, so it should be preserved.
    const edited = tagged.replace('Original text.', 'Edited text.');
    const reAssigned = assignPassageIds(edited);
    const newPids = listPassageIds(reAssigned);
    expect(newPids).toEqual(originalPids);
  });

  it('preserves pids when blocks are reordered', () => {
    const original = 'First.\n\nSecond.\n\nThird.';
    const tagged = assignPassageIds(original);
    const pidsBefore = listPassageIds(tagged);
    // Swap blocks 1 and 3 by reassembling the source — comments
    // travel with their blocks.
    const blocks = tagged.split(/\n\n+/);
    expect(blocks.length).toBe(3);
    const swapped = [blocks[2], blocks[1], blocks[0]].join('\n\n');
    const reAssigned = assignPassageIds(swapped);
    const pidsAfter = listPassageIds(reAssigned);
    // Same set of pids, just in different order.
    expect(new Set(pidsAfter)).toEqual(new Set(pidsBefore));
    expect(pidsAfter.length).toBe(pidsBefore.length);
  });

  it('mints a fresh pid for a newly-added block', () => {
    const original = 'Para one.\n\nPara two.';
    const tagged = assignPassageIds(original);
    const beforePids = listPassageIds(tagged);
    // Splice a new paragraph between them.
    const expanded = tagged.replace('Para two.', 'Brand new paragraph.\n\nPara two.');
    const reAssigned = assignPassageIds(expanded);
    const afterPids = listPassageIds(reAssigned);
    expect(afterPids.length).toBe(beforePids.length + 1);
    // Every original pid is still present.
    for (const pid of beforePids) expect(afterPids).toContain(pid);
  });

  it('avoids collision with existing pids', () => {
    // Pre-seed the body with an explicit pid that already exists, then
    // add a new block — the new pid must differ.
    const seeded = '<!-- pid:abcd -->\nFirst block, deliberately pidded.\n\nSecond block, will mint.';
    const result = assignPassageIds(seeded);
    const pids = listPassageIds(result);
    expect(pids).toHaveLength(2);
    expect(pids).toContain('abcd');
    expect(pids[0]).not.toBe(pids[1]);
  });

  it('generates pids in the documented Crockford base32 alphabet (no i/l/o/u)', () => {
    const body = Array.from({ length: 50 }, (_, i) => `Para ${i}.`).join('\n\n');
    const result = assignPassageIds(body);
    for (const pid of listPassageIds(result)) {
      expect(pid).toMatch(/^[0123456789abcdefghjkmnpqrstvwxyz]+$/);
      expect(pid.length).toBeGreaterThanOrEqual(4);
      expect(pid.length).toBeLessThanOrEqual(6);
    }
  });

  it('is idempotent on bodies it has already augmented', () => {
    const body = '# Heading\n\nFirst paragraph.\n\n- item one\n- item two\n\nClosing.';
    const onePass = assignPassageIds(body);
    const twoPass = assignPassageIds(onePass);
    const threePass = assignPassageIds(twoPass);
    expect(twoPass).toBe(onePass);
    expect(threePass).toBe(onePass);
  });

  it('preserves non-pid HTML comments', () => {
    // Inline comments that are NOT pid markers must round-trip untouched —
    // researchers might use them for their own annotations.
    const body = '<!-- TODO: revise -->\n\nFirst para.\n\nSecond.';
    const result = assignPassageIds(body);
    expect(result).toContain('<!-- TODO: revise -->');
    expect(listPassageIds(result)).toHaveLength(2);
  });
});

describe('stripPassageIds', () => {
  it('removes every pid comment cleanly', () => {
    const tagged = assignPassageIds('First.\n\nSecond.\n\nThird.');
    expect(listPassageIds(tagged)).toHaveLength(3);
    const stripped = stripPassageIds(tagged);
    expect(listPassageIds(stripped)).toHaveLength(0);
    expect(stripped).toContain('First.');
    expect(stripped).toContain('Second.');
    expect(stripped).toContain('Third.');
  });

  it('leaves non-pid HTML comments alone', () => {
    const body = '<!-- pid:abcd -->\nKeep me out.\n\n<!-- NOT a pid -->\n\nPara.';
    const stripped = stripPassageIds(body);
    expect(stripped).not.toContain('pid:abcd');
    expect(stripped).toContain('<!-- NOT a pid -->');
  });

  it('is a clean inverse for the renumber-then-reassign flow', () => {
    const original = 'A.\n\nB.\n\nC.';
    const tagged = assignPassageIds(original);
    const renumbered = assignPassageIds(stripPassageIds(tagged));
    expect(listPassageIds(renumbered)).toHaveLength(3);
    // Pids are fresh after a renumber (by design).
    const oldPids = new Set(listPassageIds(tagged));
    const newPids = new Set(listPassageIds(renumbered));
    // Almost-always disjoint at length 4 / 1M-space — assert no
    // overlap because if it ever collides this test will flag the
    // generator entropy regression. Vanishingly improbable in
    // practice (3 ids drawn from 1M).
    for (const p of newPids) expect(oldPids.has(p)).toBe(false);
  });
});
