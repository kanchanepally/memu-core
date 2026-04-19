import { pool } from '../db/connection';

export type ListKind = 'shopping' | 'task';

export interface ListCommandResult {
  kind: ListKind;
  items: string[];
  response: string;
}

const SHOPPING_WORDS = '(?:shopping|grocery|groceries|market)';
const TASK_WORDS = '(?:task|todo|to-do|to\\s?do|jobs?)';

const PATTERNS: Array<{ kind: ListKind; re: RegExp }> = [
  { kind: 'shopping', re: new RegExp(`^\\s*(?:please\\s+)?(?:can you\\s+)?(?:add|put|get)\\s+(.+?)\\s+(?:to|on|onto)\\s+(?:the|my|our)?\\s*${SHOPPING_WORDS}\\s*(?:list)?\\s*\\.?\\s*$`, 'i') },
  { kind: 'task',     re: new RegExp(`^\\s*(?:please\\s+)?(?:can you\\s+)?(?:add|put)\\s+(.+?)\\s+(?:to|on|onto)\\s+(?:the|my|our)?\\s*${TASK_WORDS}\\s*(?:list)?\\s*\\.?\\s*$`, 'i') },
  { kind: 'task',     re: /^\s*(?:please\s+)?remind me to\s+(.+?)\s*\.?\s*$/i },
  { kind: 'shopping', re: /^\s*(?:please\s+)?(?:i\s+)?need(?:s)?\s+(?:to\s+(?:buy|get|pick up)\s+)?(.+?)\s+(?:from|at)\s+(?:the\s+)?(?:shop|store|supermarket)\s*\.?\s*$/i },
];

function splitItems(raw: string): string[] {
  const cleaned = raw
    .replace(/\s+and\s+/gi, ',')
    .replace(/\s*&\s*/g, ',')
    .replace(/\s+plus\s+/gi, ',');
  return cleaned
    .split(',')
    .map(s => s.trim().replace(/^(?:some|a|an|the)\s+/i, ''))
    .filter(s => s.length > 0 && s.length <= 120);
}

function titleCase(s: string): string {
  const body = s === s.toUpperCase() ? s.toLowerCase() : s;
  return body.charAt(0).toUpperCase() + body.slice(1);
}

function humanJoin(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function detectListCommand(content: string): { kind: ListKind; items: string[] } | null {
  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > 400) return null;

  for (const { kind, re } of PATTERNS) {
    const m = trimmed.match(re);
    if (m && m[1]) {
      const items = splitItems(m[1]).map(titleCase);
      if (items.length > 0) return { kind, items };
    }
  }
  return null;
}

export async function handleListCommand(
  profileId: string,
  content: string,
  channel: string,
  messageId: string,
): Promise<ListCommandResult | null> {
  const parsed = detectListCommand(content);
  if (!parsed) return null;

  const { kind, items } = parsed;
  const cardType = kind === 'shopping' ? 'shopping' : 'extraction';

  for (let i = 0; i < items.length; i++) {
    await pool.query(
      `INSERT INTO stream_cards (family_id, card_type, title, body, source, source_message_id, actions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        profileId,
        cardType,
        items[i],
        '',
        channel === 'mobile' || channel === 'pwa' ? 'manual' : channel,
        `${messageId}-li-${i}`,
        JSON.stringify([]),
      ],
    );
  }

  const listLabel = kind === 'shopping' ? 'shopping list' : 'task list';
  const verb = items.length === 1 ? 'Added' : 'Added';
  const response = `${verb} ${humanJoin(items)} to your ${listLabel}.`;

  return { kind, items, response };
}
