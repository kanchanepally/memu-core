/**
 * The Canvas timeline — single source of surface truth.
 *
 * Memu's UX target (see memu-platform/docs/memu-layer-zero-ux-brief.md) is
 * one adaptive surface: the conversation IS the canvas. Every user-facing
 * thing — chat replies, briefings, action nudges, news tiles, prompt chips —
 * flows through `messages` as a single timeline, polymorphic on
 * `metadata.type`. Stream cards remain the action-state-of-truth for
 * individual items (open/done/dismissed); they're no longer a parallel feed.
 *
 * This module is the seed of that spine. As Phase A progresses it grows:
 *
 *   A.1 (this slice)  — postCardAsMessage: atomically insert a stream_card
 *                       AND its surface message in one transaction
 *   A.2               — extraction/reflection/document-ingestion producers
 *                       call postCardAsMessage instead of raw card inserts
 *   A.3               — postBriefingAsMessage (lifts current code in
 *                       briefing.ts to live here alongside its siblings)
 *   A.5               — chat renderer dispatches on metadata.type for the
 *                       inline-action-nudge component
 *   later             — postNewsTileMessage, postPromptChipMessage,
 *                       adaptive-surface "what should be shown right now"
 *                       backend logic (Phase D in the brief)
 *
 * Design notes:
 *
 *   - Direction of FK is messages → stream_cards (renderer iterates
 *     messages and dispatches on stream_card_id presence; card resolution
 *     can update the surface message in place without a reverse lookup)
 *   - 1:1 enforced by uniq_message_per_stream_card. Re-surfacing a card
 *     later (escalation pattern) would be a separate message that
 *     references the same card; that lifts this constraint and is
 *     deliberately deferred until the UX demands it.
 *   - All writes go through db.transaction so the card + message commit
 *     atomically. Caller is expected to be inside a tenant context (the
 *     wrapper picks up ALS automatically); enterCollectiveContext at the
 *     edge (cron, WhatsApp ingest) before calling this.
 */

import { db } from '../db/tenant';

/**
 * stream_cards.card_type — kept in lockstep with the SQL CHECK from
 * migration 019_briefing_card_type.sql. If you add a new card type:
 *   1. Drop + recreate the CHECK in a new migration
 *   2. Add the value here
 */
export type StreamCardType =
  | 'collision'
  | 'extraction'
  | 'unfinished_business'
  | 'reminder'
  | 'document_extracted'
  | 'calendar_added'
  | 'proactive_nudge'
  | 'weekly_digest'
  | 'contradiction'
  | 'stale_fact'
  | 'pattern'
  | 'care_standard_lapsed'
  | 'shopping'
  | 'briefing';

/**
 * stream_cards.source — kept in lockstep with migration 020 (channel
 * extension). 'briefing' for cards produced by the briefing's
 * suggested_actions; 'mobile'/'pwa' for chat-extracted cards; the
 * whatsapp_* values for WhatsApp-ingested.
 */
export type StreamCardSource =
  | 'whatsapp_group'
  | 'whatsapp_dm'
  | 'calendar'
  | 'email'
  | 'document'
  | 'manual'
  | 'proactive'
  | 'mobile'
  | 'pwa'
  | 'briefing';

/**
 * messages.metadata.type — the render-dispatch discriminator.
 *
 *   - 'briefing'     — server-generated morning brief (elevated AI-Insight
 *                      render). Set today by briefing.ts; surfaced here
 *                      so all timeline producers share one type space.
 *   - 'action_nudge' — a card surface message. Renderer shows inline
 *                      action UI (act / dismiss) within the bubble.
 *
 *   Future:
 *   - 'news_tile'    — Phase B onwards
 *   - 'prompt_chip'  — Phase C (these don't actually live as messages,
 *                      but the type slot is reserved for symmetry)
 */
export type CanvasMessageType = 'briefing' | 'action_nudge';

/**
 * A stream_card.actions entry. Two historical shapes coexist in the
 * codebase and both are accepted by the existing /api/stream/* endpoints,
 * so we model both here too:
 *
 *   - Legacy: { type: 'dismiss' | 'standard_complete' | 'open_space',
 *               label: string, ...kind-specific fields }
 *   - Briefing-action: { kind: 'reply_draft' | 'add_to_list' |
 *                              'add_calendar_event' | 'update_space',
 *                        label: string, payload: {...} }
 */
export type StreamCardAction = {
  label: string;
  type?: string;
  kind?: string;
  [key: string]: unknown;
};

export interface PostCardAsMessageInput {
  /** Tenant scope. Required even though RLS would also enforce it. */
  familyId: string;
  /**
   * The conversation that surfaces this card. Caller decides — typically
   * the user's active conversation (so the nudge lands in their current
   * thread) or a fresh briefing conversation (for the 7am push). Use
   * `getOrCreateActiveConversation(profileId)` if unsure.
   */
  conversationId: string;
  /** The recipient. */
  profileId: string;
  /** Where the card came from — 'mobile', 'pwa', 'briefing', etc. */
  channel: string;
  card: {
    type: StreamCardType;
    title: string;
    body: string;
    source: StreamCardSource;
    /** Optional FK to the upstream message (extraction's source message). */
    sourceMessageId?: string;
    actions?: StreamCardAction[];
  };
  /**
   * Render type. Defaults to 'action_nudge' — the chat renderer will show
   * the inline action UI. Use 'briefing' when posting briefing-shaped
   * messages through this helper (rare; briefing.ts has its own path
   * today, will migrate in A.3).
   */
  messageType?: CanvasMessageType;
}

export interface PostCardAsMessageResult {
  cardId: string;
  messageId: string;
}

/**
 * Atomic dual-write: create the stream_card AND its surface message,
 * linked. Either both succeed or neither does — no orphan cards on the
 * Today feed, no orphan messages with broken card refs.
 *
 * Caller responsibility:
 *   - Real names go in (`card.title`, `card.body`). The Twin invariant
 *     applies to LLM-bound text, not user-visible text. If the caller
 *     received the strings from a Twin-anonymised dispatch, it must
 *     translate back to real names before invoking this helper.
 *   - Caller must be inside an active tenant context (typical: inside
 *     a Fastify request that went through requireCollective, or inside
 *     enterCollectiveContext for cron / WhatsApp ingest paths).
 */
export async function postCardAsMessage(
  input: PostCardAsMessageInput,
): Promise<PostCardAsMessageResult> {
  return await db.transaction(async (client) => {
    const cardRes = await client.query<{ id: string }>(
      `INSERT INTO stream_cards
         (family_id, card_type, title, body, source, source_message_id, actions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.familyId,
        input.card.type,
        input.card.title,
        input.card.body,
        input.card.source,
        input.card.sourceMessageId ?? null,
        JSON.stringify(input.card.actions ?? []),
      ],
    );
    const cardId = cardRes.rows[0].id;

    const messageType = input.messageType ?? 'action_nudge';
    const messageId = `card-${cardId}`;
    // Body for the chat renderer. Cards have title + body; messages have a
    // single response_translated field. Concat with a blank line so the
    // renderer can split if it wants visual separation (it doesn't, today;
    // A.5 may treat them distinctly). Conservative: preserve both as
    // structured fields too via metadata so renderers don't have to parse.
    const renderBody = `${input.card.title}\n\n${input.card.body}`.trim();
    const metadata: Record<string, unknown> = {
      type: messageType,
      cardTitle: input.card.title,
      cardBody: input.card.body,
      cardActions: input.card.actions ?? [],
    };

    await client.query(
      `INSERT INTO messages
         (id, conversation_id, profile_id, role,
          content_response_translated, channel, metadata, stream_card_id)
       VALUES ($1, $2, $3, 'assistant', $4, $5, $6, $7)`,
      [
        messageId,
        input.conversationId,
        input.profileId,
        renderBody,
        input.channel,
        JSON.stringify(metadata),
        cardId,
      ],
    );

    await client.query(
      `UPDATE conversations SET message_count = message_count + 1 WHERE id = $1`,
      [input.conversationId],
    );

    return { cardId, messageId };
  });
}

/**
 * Find or create a conversation suitable for posting timeline messages.
 * Reuses the most recent conversation if it's still "active" by the
 * existing 30-minute gap rule used elsewhere (orchestrator.ts:
 * CONVERSATION_GAP_MS); otherwise creates a fresh one.
 *
 * Lifted out of orchestrator.ts so card producers (extraction, reflection,
 * briefing) can share the same conversation-resolution logic without
 * pulling in the chat pipeline. Source-of-truth for the 30-min window
 * lives here now; orchestrator.ts will defer to this in A.2.
 */
const CONVERSATION_GAP_MS = 30 * 60 * 1000;

export async function getOrCreateActiveConversation(profileId: string): Promise<string> {
  const convRes = await db.query<{ id: string }>(
    'SELECT id FROM conversations WHERE profile_id = $1 ORDER BY started_at DESC LIMIT 1',
    [profileId],
  );

  if (convRes.rows.length > 0) {
    const convId = convRes.rows[0].id;
    const lastMsg = await db.query<{ created_at: Date }>(
      'SELECT created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [convId],
    );
    if (lastMsg.rows.length === 0) return convId; // empty — reuse
    const lastTime = new Date(lastMsg.rows[0].created_at).getTime();
    if (Date.now() - lastTime < CONVERSATION_GAP_MS) return convId;
  }

  const fresh = await db.query<{ id: string }>(
    'INSERT INTO conversations (profile_id) VALUES ($1) RETURNING id',
    [profileId],
  );
  return fresh.rows[0].id;
}
