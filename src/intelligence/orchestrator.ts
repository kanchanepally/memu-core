import { WASocket, proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import { translateToAnonymous, translateToReal } from '../twin/translator';
import { detectAndRegisterNovelEntities } from '../twin/novel';
import type { ConversationMessage } from './claude';
import { dispatch } from '../skills/router';
import { type Visibility } from './context';
import { processGroupMessageExtraction } from './extraction';
import { processVisualDocumentExtraction } from './vision';
import { extractAndStoreFacts } from './autolearn';
import { handleListCommand } from './listCommands';
import { reconcileListMentions } from './listReconciler';
import { interactiveQueryTools, interactiveQueryServerTools } from './tools';
import { formatToolSummaryFooter } from './toolSummary';
import { scrapeUrlContent } from './browser';
import { pool } from '../db/connection';
import { processSynthesisUpdate } from './synthesis';
import { retrieveForQuery, buildContextBlock } from '../spaces/retrieval';
import { recordRetrievalProvenance } from '../spaces/provenance';

const HISTORY_LIMIT = 10; // Last N message pairs for multi-turn conversation
const CONVERSATION_GAP_MS = 30 * 60 * 1000; // 30 minutes — start new conversation after this gap

// Fetch recent conversation history for a profile, already in anonymous form
async function getConversationHistory(profileId: string): Promise<ConversationMessage[]> {
  try {
    const convRes = await pool.query(
      'SELECT id FROM conversations WHERE profile_id = $1 ORDER BY started_at DESC LIMIT 1',
      [profileId]
    );
    if (convRes.rows.length === 0) return [];

    const convId = convRes.rows[0].id;

    const msgRes = await pool.query(
      `SELECT content_translated, content_response_raw
       FROM messages
       WHERE conversation_id = $1
         AND content_translated IS NOT NULL
         AND content_response_raw IS NOT NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [convId, HISTORY_LIMIT]
    );

    if (msgRes.rows.length === 0) return [];

    // Reverse to chronological order, then flatten into user/assistant pairs
    const history: ConversationMessage[] = [];
    const rows = msgRes.rows.reverse();
    for (const row of rows) {
      history.push({ role: 'user', content: row.content_translated });
      history.push({ role: 'assistant', content: row.content_response_raw });
    }
    return history;
  } catch (err) {
    console.error('Error fetching conversation history:', err);
    return [];
  }
}

// Get or create a conversation, starting a new one if the last message was >30 min ago
async function getOrCreateConversation(profileId: string): Promise<string> {
  const convRes = await pool.query(
    'SELECT id FROM conversations WHERE profile_id = $1 ORDER BY started_at DESC LIMIT 1',
    [profileId]
  );

  if (convRes.rows.length > 0) {
    const convId = convRes.rows[0].id;

    // Check if the last message in this conversation is recent enough
    const lastMsg = await pool.query(
      'SELECT created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [convId]
    );

    if (lastMsg.rows.length > 0) {
      const lastTime = new Date(lastMsg.rows[0].created_at).getTime();
      const now = Date.now();
      if (now - lastTime < CONVERSATION_GAP_MS) {
        return convId; // Continue existing conversation
      }
    } else {
      // Empty conversation — reuse it
      return convId;
    }
  }

  // Start a new conversation
  const newConv = await pool.query(
    'INSERT INTO conversations (profile_id) VALUES ($1) RETURNING id',
    [profileId]
  );
  return newConv.rows[0].id;
}

// Shared pipeline for both WhatsApp and mobile app
export async function processIntelligencePipeline(
  profileId: string,
  content: string,
  channel: string,
  messageId: string = 'unknown',
  visibility: Visibility = 'family',
): Promise<string> {
  // 0. Novel-entity detection — register any unseen proper nouns so step 1
  // can anonymise them on the subsequent pass. Fire-and-forget safe: on
  // failure the function logs + returns [], and the regex translator proceeds
  // with whatever is already in the registry.
  await detectAndRegisterNovelEntities(content);

  // 1. Twin Translation (Real -> Anonymous)
  const anonymousMsg = await translateToAnonymous(content);
  console.log(`[IN -> Translated]: ${anonymousMsg}`);

  // 1.5 Deterministic list-command fast path. "Add milk to the shopping list"
  // and friends skip retrieval/LLM — the LLM was inventing "added it" replies
  // while extraction sometimes missed the user-directed command. Audit is
  // preserved: the synthetic assistant response is anonymised and stored
  // exactly like a real Claude reply so the Privacy Ledger and conversation
  // history stay consistent.
  const listResult = await handleListCommand(profileId, content, channel, messageId);
  if (listResult) {
    console.log(`[LIST -> ${listResult.kind}]: ${listResult.items.length} item(s)`);
    const anonymousResponse = await translateToAnonymous(listResult.response);
    await storeMessageAudit(profileId, content, anonymousMsg, anonymousResponse, listResult.response, channel, messageId);
    return listResult.response;
  }

  // 2. Synthesis-first retrieval — Story 2.1. Direct addressing and
  // catalogue matching pull from compiled Spaces; we only fall back to
  // embedding recall when nothing else fits. Everything coming back is
  // run through the Twin before it reaches the LLM.
  const retrieval = await retrieveForQuery({
    familyId: profileId,
    viewerProfileId: profileId,
    query: content,
    embeddingVisibility: visibility,
  });
  const anonymousSpaces = await Promise.all(
    retrieval.spaces.map(async s => ({
      ...s,
      bodyMarkdown: await translateToAnonymous(s.bodyMarkdown),
      description: await translateToAnonymous(s.description),
      name: await translateToAnonymous(s.name),
    })),
  );
  const anonymousEmbeddings: string[] = [];
  for (const ctx of retrieval.embeddingContexts) {
    anonymousEmbeddings.push(await translateToAnonymous(ctx));
  }
  const anonymousRetrieval = {
    ...retrieval,
    spaces: anonymousSpaces,
    embeddingContexts: anonymousEmbeddings,
  };
  console.log(
    `[RETRIEVAL -> ${retrieval.provenance.path}]: spaces=${retrieval.provenance.spaceUris.length} embeddings=${retrieval.provenance.embeddingHits}`,
  );

  // 3. Fetch conversation history (already anonymous from prior audit storage)
  const history = await getConversationHistory(profileId);
  if (history.length > 0) {
    console.log(`[HISTORY -> Loaded]: ${history.length / 2} previous exchanges.`);
  }

  // 4. LLM call — routed through the model router per skill frontmatter.
  // Digital Twin guarantees anonymity regardless of which provider handles the call.
  //
  // Tool-use: interactive_query dispatches with the local tool registry
  // (`addToList`, `createSpace`, `updateSpace`). Claude can invoke these
  // mid-turn to actually modify state, so a "I've added X" confirmation
  // is the result of a successful tool call, not a post-hoc reconciliation.
  // The listReconciler below stays as a safety net for the pre-tool flow.
  const contextBlock = buildContextBlock(anonymousRetrieval);
  const dispatchResult = await dispatch({
    skill: 'interactive_query',
    templateVars: { context_block: contextBlock },
    userMessage: anonymousMsg,
    history,
    profileId,
    familyId: profileId,
    useBYOK: true,
    tools: interactiveQueryTools,
    serverTools: interactiveQueryServerTools,
    // 4096 instead of the 1024 default. Server-side web_search injects
    // search results (~5-15k input tokens after a couple of searches);
    // 1024 output tokens isn't enough for Claude to synthesise a real
    // answer afterwards — replies were truncating mid-sentence in
    // Hareesh's 2026-04-26 dogfood (raised-bed search). 4096 gives
    // breathing room without unbounded cost.
    maxTokens: 4096,
    toolContext: {
      familyId: profileId,
      profileId,
      channel,
      messageId,
    },
  });
  const claudeResponse = dispatchResult.text;
  if (dispatchResult.toolCalls && dispatchResult.toolCalls.length > 0) {
    const summary = dispatchResult.toolCalls
      .map(c => `${c.name}:${c.ok ? 'ok' : 'fail'}`)
      .join(' ');
    console.log(`[TOOL-USE]: ${summary}`);
  }
  console.log(`[LLM -> Raw]: ${claudeResponse}`);

  // 5. Reverse Translation (Anonymous -> Real)
  const realResponseBase = await translateToReal(claudeResponse);

  // 5b. List-mention reconciliation. The interactive_query skill instructs
  // Claude to confirm list additions confidently ("Done, I've added that").
  // When the regex fast path at step 1.5 missed the phrasing, Claude's
  // confirmation would otherwise be a lie — items never reach `list_items`.
  // Scan Claude's real-names reply for explicit "added X to your shopping/
  // task list" confirmations and persist the items. Idempotent against
  // duplicates via pending-item dedup.
  //
  // Runs against `realResponseBase` (NOT the footer-augmented response)
  // so the reconciler can never accidentally trip on the auto-generated
  // tool-summary footer's wording. Today's footer doesn't match the
  // reconciler regex but the coupling is fragile — keep the inputs
  // separate.
  try {
    const reconciled = await reconcileListMentions(profileId, realResponseBase, channel, messageId);
    if (reconciled.addedShopping.length + reconciled.addedTask.length > 0) {
      console.log(
        `[LIST RECONCILE]: shopping=${reconciled.addedShopping.length} task=${reconciled.addedTask.length}`,
      );
    }
  } catch (err) {
    console.error('[LIST RECONCILE] failed:', err);
  }

  // 5c. Tool-call summary footer (Item 2 Slice 1, 2026-04-26).
  // Append a small machine-rendered line to the user-visible reply
  // describing what tools fired. Closes the "creation/updation seems
  // distant" gap — Claude's prose can be terse (per SOUL.md) without
  // hiding the concrete effect. The footer is structural-only (no real
  // names, no DB lookups) and goes ONLY into the user-facing channel:
  //   - realResponse (returned to client + stored as
  //     content_response_translated) → user sees it
  //   - claudeResponse (anonymous, stored as content_response_raw +
  //     replayed in next turn's history) → unchanged → footer NEVER
  //     enters Claude's context window. Important: keeps the footer
  //     from looping back into the prompt and confusing future turns.
  const toolFooter = formatToolSummaryFooter(dispatchResult.toolCalls);
  const realResponse = toolFooter ? `${realResponseBase}${toolFooter}` : realResponseBase;

  // 6. Immutable Message Storage (Audit Trail)
  await storeMessageAudit(profileId, content, anonymousMsg, claudeResponse, realResponse, channel, messageId);

  // 6b. Provenance record — what retrieval path answered this message.
  // Helps debugging and feeds the Spaces-tab "recent queries" UI.
  recordRetrievalProvenance(profileId, messageId, retrieval.provenance).catch(err => {
    console.error('[SPACES] provenance record failed:', err);
  });

  // 7. Auto-learning: extract durable facts in the background (fire-and-forget)
  extractAndStoreFacts(profileId, anonymousMsg, claudeResponse, visibility).catch(err => {
    console.error('[AUTO-LEARN] Background extraction failed:', err);
  });

  // 8. Stream card extraction from chat messages (fire-and-forget)
  processGroupMessageExtraction(profileId, content, channel, messageId).catch(err => {
    console.error('[EXTRACTION] Background extraction failed:', err);
  });

  // 9. Synthesis Page Update (fire-and-forget)
  processSynthesisUpdate(profileId, anonymousMsg, claudeResponse).catch(err => {
    console.error('[SYNTHESIS] Background synthesis update failed:', err);
  });

  return realResponse;
}

export async function handleIncomingMessage(sock: WASocket, msg: proto.IWebMessageInfo) {
  const senderJid = msg.key?.remoteJid;

  const isImage = !!msg.message?.imageMessage;
  const imageMessage = msg.message?.imageMessage;
  let content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || (isImage ? imageMessage?.caption || '' : '');

  if (!senderJid) return;
  if (!content && !isImage) return;

  // Intercept URLs and inject scraped context implicitly
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = content.match(urlRegex);
  if (urls && urls.length > 0) {
    for (const url of urls) {
      const scraped = await scrapeUrlContent(url);
      if (scraped) {
        content += `\n${scraped}`;
      }
    }
  }

  try {
    const participantJid = msg.key?.participant || senderJid;
    const profileId = await lookupOrCreateProfile(participantJid);

    // Document Ingestion (Vision)
    if (isImage) {

      const buffer = await downloadMediaMessage(
        msg as import('@whiskeysockets/baileys').WAMessage,
        'buffer',
        {},
        {
          logger: console as any,
          reuploadRequest: sock.updateMediaMessage
        }
      );

      if (buffer) {
        const mimeType = imageMessage?.mimetype || 'image/jpeg';
        const itemsFound = await processVisualDocumentExtraction(profileId, buffer as Buffer, mimeType, content, msg.key?.id || 'unknown');

        if (itemsFound && itemsFound > 0) {
          console.log(`[VISION] Extracted ${itemsFound} action item(s) from image`);
        } else {
          console.log(`[VISION] Couldn't find actionable deadlines in image`);
        }
      }
      return;
    }

    // WhatsApp Group Observer — extract but don't reply
    if (senderJid.endsWith('@g.us')) {
      await processGroupMessageExtraction(profileId, content, senderJid, msg.key?.id || 'unknown');
      return;
    }

    // Phase 1: Omnivorous Batched Ingestion
    // We log the raw message to the new inbox queue. The batched Chief of Staff engine will process it later.
    const messageId = msg.key?.id || `msg-${Date.now()}`;
    await pool.query(
      `INSERT INTO inbox_messages (id, profile_id, channel, sender_jid, content, is_image) 
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [messageId, profileId, 'whatsapp', senderJid, content, isImage]
    );
    console.log(`[INBOX] Logged message ${messageId} from ${senderJid} for batched processing.`);

    // Fast-path: We still run the regex list extractor so direct commands ("add milk to shopping") work instantly
    const listResult = await handleListCommand(profileId, content, 'whatsapp', messageId);
    if (listResult) {
      console.log(`[LIST FAST-PATH]: Extracted ${listResult.items.length} items directly.`);
    }
  } catch (err) {
    console.error('Error handling incoming message:', err);
  }
}

async function lookupOrCreateProfile(jid: string): Promise<string> {
  // PERSONAL ASSISTANT OVERRIDE:
  // Since Memu is connected to the user's personal WhatsApp (not a generic bot number),
  // we do not want to create separate isolated dashboards for every person who texts them.
  // We route all intercepted intelligence directly to the primary Hub Owner's dashboard
  // so they can actually see the tasks, stream cards, and drafts.
  
  try {
    const ownerRes = await pool.query('SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1');
    if (ownerRes.rows.length > 0) {
      return ownerRes.rows[0].id;
    }
  } catch (err) {
    console.error('Error finding primary profile:', err);
  }

  // Fallback if DB is empty (should not happen in a running hub)
  console.log(`Creating test profile for new number: ${jid}`);
  const idRes = await pool.query('INSERT INTO profiles (display_name, role) VALUES ($1, $2) RETURNING id', ['Hub Owner', 'adult']);
  const newProfileId = idRes.rows[0].id;

  await pool.query('INSERT INTO profile_channels (profile_id, channel, channel_identifier) VALUES ($1, $2, $3)', [newProfileId, 'whatsapp', jid]);
  await pool.query('INSERT INTO personas (id, profile_id, persona_label) VALUES ($1, $2, $3)', [`adult-${Date.now()}`, newProfileId, 'Adult-1']);

  return newProfileId;
}

async function storeMessageAudit(
  profileId: string,
  original: string,
  translated: string,
  claudeRaw: string,
  realResp: string,
  channel: string,
  messageId: string
) {
  const convId = await getOrCreateConversation(profileId);

  await pool.query(
    `INSERT INTO messages
    (id, conversation_id, profile_id, role, content_original, content_translated, content_response_raw, content_response_translated, channel)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [messageId, convId, profileId, 'user', original, translated, claudeRaw, realResp, channel]
  );

  // Update conversation message count
  await pool.query(
    'UPDATE conversations SET message_count = message_count + 1 WHERE id = $1',
    [convId]
  );
}
