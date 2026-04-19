import { addItem, listItems, type ListType } from '../lists/store';

// Post-reply reconciliation. The `interactive_query` skill tells Claude to
// confirm confidently when the user asks to add to a list ("Done, I've added
// that"). If the deterministic regex fast path in `listCommands.ts` missed
// the phrasing, Claude's confirmation would be a lie. This scans the final
// real-names reply for "added/put X to your shopping/task list" and ensures
// X is actually persisted.
//
// One combined regex with alternation at the list-type classifier so both
// classes share the same non-greedy `.+?` boundary — prevents one class's
// scan from walking past the other class's match.
//
// Verbs allowed:
//   - past tense "added" / "put"      (self-confirming, safe without pronoun)
//   - future tense "add"              (only when prefixed by "I'll / I will")
// Everything else (e.g. "you could add X to your coffee") is rejected.
const COMBINED_RE =
  /(?:^|[.!?]\s*|,\s*|\s)(?:done,?\s*)?(?:(?:I(?:'ve| have)\s+(?:also\s+|just\s+)?)?(?:added|put)|(?:I(?:'ll|\s+will|\s+would)\s+(?:also\s+)?)add)\s+(.+?)\s+(?:to|on|onto)\s+(?:the|your|our)\s+(?:(shopping|grocery|groceries|market)|(task|to-?do|todo))(?:\s+list)?\b/gi;

function splitItems(raw: string): string[] {
  const cleaned = raw
    .replace(/\s+and\s+/gi, ',')
    .replace(/\s*&\s*/g, ',')
    .replace(/\s+plus\s+/gi, ',');
  return cleaned
    .split(',')
    .map(s =>
      s
        .trim()
        .replace(/^(?:some|a|an|the)\s+/i, '')
        .replace(/[.,;:!?]+$/, '')
        .trim(),
    )
    .filter(s => s.length > 0 && s.length <= 120);
}

function titleCase(s: string): string {
  const body = s === s.toUpperCase() ? s.toLowerCase() : s;
  return body.charAt(0).toUpperCase() + body.slice(1);
}

export interface ReconcileResult {
  addedShopping: string[];
  addedTask: string[];
}

export function detectListMentions(reply: string): {
  shopping: string[];
  task: string[];
} {
  const shopping: string[] = [];
  const task: string[] = [];
  const rx = new RegExp(COMBINED_RE.source, COMBINED_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = rx.exec(reply)) !== null) {
    const itemsRaw = m[1];
    if (!itemsRaw) continue;
    const items = splitItems(itemsRaw).map(titleCase);
    if (m[2]) {
      shopping.push(...items);
    } else if (m[3]) {
      task.push(...items);
    }
  }
  return { shopping, task };
}

export async function reconcileListMentions(
  profileId: string,
  claudeResponseReal: string,
  channel: string,
  messageId: string,
): Promise<ReconcileResult> {
  const mentioned = detectListMentions(claudeResponseReal);
  if (mentioned.shopping.length === 0 && mentioned.task.length === 0) {
    return { addedShopping: [], addedTask: [] };
  }

  const [pendingShopping, pendingTask] = await Promise.all([
    mentioned.shopping.length > 0
      ? listItems({ familyId: profileId, listType: 'shopping', status: 'pending' })
      : Promise.resolve([]),
    mentioned.task.length > 0
      ? listItems({ familyId: profileId, listType: 'task', status: 'pending' })
      : Promise.resolve([]),
  ]);

  const shoppingSet = new Set(pendingShopping.map(i => i.item_text.toLowerCase()));
  const taskSet = new Set(pendingTask.map(i => i.item_text.toLowerCase()));

  const source = channel === 'mobile' || channel === 'pwa' ? 'chat' : channel;
  const addedShopping: string[] = [];
  const addedTask: string[] = [];

  let idx = 0;
  for (const item of mentioned.shopping) {
    if (shoppingSet.has(item.toLowerCase())) continue;
    await addItem({
      familyId: profileId,
      listType: 'shopping',
      itemText: item,
      source,
      sourceMessageId: `${messageId}-rc-s-${idx++}`,
      createdBy: profileId,
    });
    shoppingSet.add(item.toLowerCase());
    addedShopping.push(item);
  }
  idx = 0;
  for (const item of mentioned.task) {
    if (taskSet.has(item.toLowerCase())) continue;
    await addItem({
      familyId: profileId,
      listType: 'task',
      itemText: item,
      source,
      sourceMessageId: `${messageId}-rc-t-${idx++}`,
      createdBy: profileId,
    });
    taskSet.add(item.toLowerCase());
    addedTask.push(item);
  }

  return { addedShopping, addedTask };
}
