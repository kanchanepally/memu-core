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

  it('extraction skill resolves to haiku (fixes the Sonnet bug)', () => {
    expect(getSkill('extraction').frontmatter.model).toBe('haiku');
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
});
