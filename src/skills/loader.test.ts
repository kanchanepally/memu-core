import { describe, it, expect, beforeAll } from 'vitest';
import {
  getSkill,
  listSkills,
  renderSkill,
  renderTemplate,
  validateAllSkills,
} from './loader';

const EXPECTED = [
  'extraction',
  'synthesis_update',
  'synthesis_write',
  'reflection',
  'briefing',
  'vision',
  'twin_translate',
  'interactive_query',
  'autolearn',
  'import_extract',
  'soul',
];

describe('skills loader', () => {
  beforeAll(() => {
    validateAllSkills();
  });

  it('loads every expected skill', () => {
    const names = listSkills()
      .map(s => s.name)
      .sort();
    for (const name of EXPECTED) {
      expect(names).toContain(name);
    }
  });

  it('every skill has valid frontmatter', () => {
    for (const skill of listSkills()) {
      expect(skill.frontmatter.name).toBe(skill.name);
      expect(skill.frontmatter.description).toBeTruthy();
      expect(skill.frontmatter.model).toBeTruthy();
      expect(skill.body.length).toBeGreaterThan(50);
    }
  });

  it('extraction skill is authored as gemini-flash (Milestone A3)', () => {
    expect(getSkill('extraction').frontmatter.model).toBe('gemini-flash');
  });

  it('marks family-data skills as requires_twin', () => {
    for (const name of ['extraction', 'synthesis_update', 'briefing', 'vision', 'interactive_query', 'autolearn', 'reflection']) {
      expect(getSkill(name).frontmatter.requires_twin).toBe(true);
    }
  });

  it('twin_translate runs with requires_twin: false (operates pre-anonymisation, local only)', () => {
    const skill = getSkill('twin_translate');
    expect(skill.frontmatter.requires_twin).toBe(false);
    expect(skill.frontmatter.model).toBe('local');
  });

  it('renders template variables', () => {
    const out = renderTemplate('Hello {{name}}, today is {{day}}.', {
      name: 'Hareesh',
      day: 'Wednesday',
    });
    expect(out).toBe('Hello Hareesh, today is Wednesday.');
  });

  it('throws on missing template variable', () => {
    expect(() => renderTemplate('Hi {{missing}}', {})).toThrow(/missing/i);
  });

  it('throws on unknown skill', () => {
    expect(() => getSkill('does_not_exist')).toThrow(/unknown skill/i);
  });

  it('interpolates synthesis_update prompt cleanly', () => {
    const rendered = renderSkill('synthesis_update', {
      existing_pages: 'Page A',
      user_message: 'Robin has swim on Thursday',
      ai_response: 'Noted.',
      enabled_standards: 'std-1 — Dental check-up',
      now_iso: '2026-04-18T10:00:00.000Z',
    });
    expect(rendered).toContain('Page A');
    expect(rendered).toContain('Robin has swim on Thursday');
    expect(rendered).not.toContain('{{');
  });

  describe('soul auto-injection', () => {
    it('soul skill loads with model: local and is excluded from requires_twin set', () => {
      const soul = getSkill('soul');
      expect(soul.frontmatter.model).toBe('local');
      // SOUL is content-only — it doesn't dispatch — so requires_twin doesn't apply.
      // Either undefined or false is acceptable; presence of true would be wrong.
      expect(soul.frontmatter.requires_twin).not.toBe(true);
    });

    it('soul body strips the documentation intro and starts with "Who Memu is"', () => {
      const soul = getSkill('soul');
      // The "## Prompt" heading is the cut point; body begins with the first
      // sub-heading after it. The meta-intro paragraph is documentation and
      // must NOT appear in the injected body.
      expect(soul.body).not.toMatch(/This file is not a prompt by itself/);
      expect(soul.body).toMatch(/^##\s+Who Memu is/);
    });

    it('renderSkill auto-injects {{soul}} into interactive_query', () => {
      const rendered = renderSkill('interactive_query', { context_block: '' });
      // The "## Who Memu is" heading from SOUL.md should appear in the
      // rendered system prompt. If it does not, the wiring is broken.
      expect(rendered).toContain('## Who Memu is');
      // Voice rules from SOUL.md should be present too — pick one of the
      // load-bearing taboos.
      expect(rendered).toMatch(/Never open with an affirmation/);
      // No unresolved template markers.
      expect(rendered).not.toContain('{{');
    });

    it('renderSkill caller-provided soul overrides the auto-injected default', () => {
      const rendered = renderSkill('interactive_query', {
        context_block: '',
        soul: '## CUSTOM SOUL\n\nFor testing only.',
      });
      expect(rendered).toContain('## CUSTOM SOUL');
      expect(rendered).not.toContain('## Who Memu is');
    });
  });
});
