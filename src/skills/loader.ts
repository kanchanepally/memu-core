import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export type SkillModel =
  | 'haiku'
  | 'sonnet'
  | 'sonnet-vision'
  | 'gemini-flash'
  | 'gemini-flash-lite'
  | 'local'
  | 'auto';

export type SkillCostTier = 'cheap' | 'standard' | 'premium';

export interface SkillFrontmatter {
  name: string;
  description: string;
  model: SkillModel;
  cost_tier?: SkillCostTier;
  requires_twin?: boolean;
  version?: number;
  [key: string]: unknown;
}

export interface Skill {
  name: string;
  frontmatter: SkillFrontmatter;
  body: string;
  path: string;
}

const SKILLS_DIR = process.env.MEMU_SKILLS_DIR
  ? path.resolve(process.env.MEMU_SKILLS_DIR)
  : path.resolve(__dirname, '..', '..', 'skills');

const VALID_MODELS: SkillModel[] = [
  'haiku',
  'sonnet',
  'sonnet-vision',
  'gemini-flash',
  'gemini-flash-lite',
  'local',
  'auto',
];

const VALID_COST_TIERS: SkillCostTier[] = ['cheap', 'standard', 'premium'];

let skillCache: Map<string, Skill> | null = null;

function extractPromptBody(body: string): string {
  const headers = [/^##\s+Prompt\s*$/mi, /^##\s+System prompt\s*$/mi, /^##\s+System\s*$/mi];
  for (const re of headers) {
    const m = body.match(re);
    if (m && m.index !== undefined) {
      const after = body.slice(m.index + m[0].length);
      return after.trim();
    }
  }
  return body.trim();
}

function validateFrontmatter(raw: Record<string, unknown>, filePath: string): SkillFrontmatter {
  const missing = (k: string) => {
    throw new Error(`Skill ${filePath} missing required frontmatter field: ${k}`);
  };
  const invalid = (k: string, got: unknown) => {
    throw new Error(`Skill ${filePath} has invalid ${k}: ${JSON.stringify(got)}`);
  };

  if (typeof raw.name !== 'string' || !raw.name) missing('name');
  if (typeof raw.description !== 'string' || !raw.description) missing('description');
  if (typeof raw.model !== 'string') missing('model');
  if (!VALID_MODELS.includes(raw.model as SkillModel)) invalid('model', raw.model);

  if (raw.cost_tier !== undefined) {
    if (typeof raw.cost_tier !== 'string' || !VALID_COST_TIERS.includes(raw.cost_tier as SkillCostTier)) {
      invalid('cost_tier', raw.cost_tier);
    }
  }
  if (raw.requires_twin !== undefined && typeof raw.requires_twin !== 'boolean') {
    invalid('requires_twin', raw.requires_twin);
  }
  if (raw.version !== undefined && typeof raw.version !== 'number') {
    invalid('version', raw.version);
  }

  return raw as SkillFrontmatter;
}

function loadSkillFromFile(filePath: string): Skill {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = matter(raw);
  const fm = validateFrontmatter(parsed.data, filePath);
  const body = extractPromptBody(parsed.content);
  if (!body) {
    throw new Error(`Skill ${filePath} has empty prompt body`);
  }
  return { name: fm.name, frontmatter: fm, body, path: filePath };
}

function loadAllSkills(): Map<string, Skill> {
  const map = new Map<string, Skill>();
  if (!fs.existsSync(SKILLS_DIR)) {
    throw new Error(`Skills directory not found at ${SKILLS_DIR}`);
  }
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const skill = loadSkillFromFile(skillFile);
    if (map.has(skill.name)) {
      throw new Error(`Duplicate skill name "${skill.name}" (second at ${skillFile})`);
    }
    if (skill.name !== entry.name) {
      throw new Error(
        `Skill name "${skill.name}" does not match directory "${entry.name}" at ${skillFile}`,
      );
    }
    map.set(skill.name, skill);
  }
  return map;
}

function ensureLoaded(): Map<string, Skill> {
  if (!skillCache) skillCache = loadAllSkills();
  return skillCache;
}

export function getSkill(name: string): Skill {
  const skill = ensureLoaded().get(name);
  if (!skill) {
    throw new Error(`Unknown skill: ${name}. Available: ${Array.from(ensureLoaded().keys()).join(', ')}`);
  }
  return skill;
}

export function listSkills(): Skill[] {
  return Array.from(ensureLoaded().values());
}

/**
 * Auto-inject the SOUL.md body as `{{soul}}` for any skill that uses
 * the variable. SOUL is a meta-skill that holds Memu's voice + behaviour
 * + emotional-register rules; interactive skills include `{{soul}}` at
 * the top of their system prompt to wear that personality.
 *
 * Defensive — if SOUL.md isn't present (custom MEMU_SKILLS_DIR for
 * tests, partial test fixtures), this returns undefined and we skip the
 * auto-injection. A skill body that uses `{{soul}}` will then throw via
 * renderTemplate's missing-variable guard, which is the correct UX.
 */
function getSoulBodyOrUndefined(): string | undefined {
  try {
    return ensureLoaded().get('soul')?.body;
  } catch {
    return undefined;
  }
}

export function renderSkill(name: string, vars: Record<string, string> = {}): string {
  const skill = getSkill(name);
  const soulBody = getSoulBodyOrUndefined();
  // soul is a default — explicit caller-provided vars win.
  const merged: Record<string, string> = soulBody !== undefined
    ? { soul: soulBody, ...vars }
    : vars;
  return renderTemplate(skill.body, merged);
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    throw new Error(`Missing template variable: ${key}`);
  });
}

export function validateAllSkills(): void {
  // Force a fresh load so validation covers the latest on-disk state.
  skillCache = loadAllSkills();
}

export function reloadSkills(): void {
  skillCache = null;
  ensureLoaded();
}

export const SKILLS_DIR_PATH = SKILLS_DIR;
