# INBOX — Feature & Bug Capture

**Purpose.** Running list of observations, feature ideas, and bugs from
dogfooding Memu. Per Part 10 of `memu-platform/memu-build-plan.md`.

**Rule.** One line per item. Capture only. No discussion, no priority, no
estimate at intake. Format:

```
- YYYY-MM-DD (H|R|bug|obs): <one-liner>
```

- `H` — from Hareesh
- `R` — from Rach
- `bug` — behaviour that contradicts documented intent
- `obs` — Claude Code's own observation from code / logs / review

**Weekly triage** (Sunday evening). Each item →
*(a)* slice in the active milestone, *(b)* Part 11 deferred v-tier, or
*(c)* reject with a one-line reason. At triage end: INBOX is empty.

**Emergency break-glass.** Data loss or privacy violation skips triage → next
slice immediately. Still log here for the retrospective.

---

## Open items

### From 2026-04-26 dogfood (synthesis correctness + self-awareness)

- 2026-04-26 (H, bug, **urgent — data integrity**): Memu has overwritten
  multiple existing Spaces during chat-driven updates. Likely cause:
  `updateSpace` tool (commit `3e038b5`) replaces the Space body wholesale
  rather than merging / appending — `tools.ts` `updateSpace` executor
  passes the new body straight to `upsertSpace` with no awareness of
  prior content. Symptom Hareesh saw across multiple Spaces: a Space
  that previously held accumulated context now holds only the few
  lines from the most recent exchange. Investigate: (a) audit
  `src/intelligence/tools.ts` `updateSpace` — replacing or merging?
  (b) check `spaces_log` for `event=updated` entries in the last 7
  days to scope the blast radius; (c) recover lost content from git
  history under `/mnt/memu-data/memu-core-standalone/spaces/` (Spaces
  is a git repo per Story 3.1 — `git log` per file should restore).
  Fix likely needs: append-by-default semantics with explicit
  "replace" mode opt-in, plus user-visible diff/preview before
  commit, plus the SKILL.md v3 prompt nudged to prefer append over
  replace. **Gates all further `updateSpace` use until fixed** —
  emergency-break-glass per Part 10.

- 2026-04-26 (H, bug, **urgent — meta-cognition**): Memu's verbal
  self-model doesn't match its actual behaviour. Concrete patterns:
  (a) says "I can't do web search" but successfully fetches and
  summarises URLs the user pastes (URL ingest path is live, web
  search tool is not — Claude conflates the two); (b) says "I
  can't access your Spaces" but has just written to / overwritten
  them via `updateSpace` (interleaved in the same turn); (c)
  doesn't surface in chat that it created or modified a Space —
  user discovers it incidentally via the Spaces tab (also: chat
  doesn't surface space creation/update in any first-class way,
  Hareesh's "chat and space creation, updation seems distant"
  observation). Fix scope: (i) `interactive_query/SKILL.md`
  capabilities block must be authoritative + current — Claude
  should never deny a capability it has, and should distinguish
  URL-fetch (have) from web-search (not yet); (ii) tool-call
  results surfaced inline in chat as one-liners ("Updated Space
  'Robin' — 3 lines added", "Created Space 'Plumber' under
  household", "Added 'veg stock' to shopping"); (iii) consider an
  `introspect` tool Claude can call to fetch its own current
  capability list before answering "can you …?" questions —
  belt-and-braces over the static SKILL.md block; (iv) every
  tool-call success/failure logged to a `messages.tool_summary`
  column (or `privacy_ledger.tool_calls`) so the user can audit
  the turn. **Pairs with the Spaces-overwrite fix** — both are
  symptoms of "Memu doesn't know what it just did" and want
  shared scaffolding.

- 2026-04-26 (H, feature): Memu personality (SOUL.md). Jeeves-warm
  voice — competent, occasionally wry, never sycophantic, leads
  with action over analysis. Voice rules + behaviour rules +
  emotional register live in a top-level `skills/SOUL.md` (or
  `PERSONALITY.md`) included in every interactive system prompt.
  Source brief: this conversation + `memu-platform/memu-reimagined.md`
  Parts 1-2. Doesn't depend on synthesis fixes; can be drafted in
  parallel. → Part 11 v1.5.

- 2026-04-26 (H, feature): Conversational onboarding. First
  interaction IS the onboarding — no setup wizard, no forms, no
  "tell me about your family" prompt. Memu asks one question
  ("What's on your mind right now?"), handles it, introduces
  features progressively as the user is ready. Adding a partner
  / child happens via conversation, not a flow. Replaces /
  extends C-prod-2 (mobile app onboarding wizard). Source brief:
  this conversation. → Part 11 v1.5; revisit when C-prod-2 is
  reached in Milestone C.

- 2026-04-26 (obs): Skill-map expansion identified across three
  tiers: (Tier 1, pre-Founding-50 beta) **autolearn**,
  **proactive_check**, **document_ingestion**, **draft_communication**;
  (Tier 2, during beta) meal_planning, follow_up, recurring_task,
  pattern_insight, receipt_processing; (Tier 3, post-beta)
  anonymous_web_agent, email_ingestion, budget_tracking,
  homework_helper, health_tracking. document_ingestion is already
  tracked as Bug 6 / B-live-Bug6 — promotes to a fully-shaped skill
  on ship. Tiers 1+2+3 staged into Part 11. Source brief:
  `memu-platform/memu-reimagined.md` Parts 3-4 + this conversation.

### From 2026-04-25 dogfood (post-batch APK install)

- 2026-04-25 (H, bug): Lists tab — ticked-off items reappear after tab
  switch / refresh. Repro: Lists → tap checkbox on a task → item
  disappears optimistically → switch to another tab → switch back →
  item is back. Static read suggests one of three causes (need a live
  repro to narrow): (a) `completeListItemApi` failing silently and the
  optimistic `setTasks(prev => prev.filter(...))` masks it
  (`mobile/app/(tabs)/lists.tsx:140–144` doesn't check the response),
  (b) profile mismatch — item's `family_id` ≠ caller's `profileId` on
  the UPDATE (`src/lists/store.ts:88`), so 0 rows updated and the GET
  with `status=pending` keeps returning it, (c) `useFocusEffect` on
  line 124 fires a `loadItems` that overrides the optimistic state
  before the POST has finished. Diagnostic: `docker logs
  memu_core_standalone_api | grep "/api/lists"` during the repro to
  see whether the POST returns 200 + the row's status flips. Single
  evening fix once cause is known.

### From 2026-04-20 dogfood running list (afternoon)

Tool-use cluster (items 1 + 3 + 4 + the capabilities half of item 2) shipped
2026-04-20 evening in commit `3e038b5`. See the Shipped section below.
Session 1.5 (`findSpaces` + `addCalendarEvent` + SKILL.md v3) shipped
2026-04-21 — also in the Shipped section. The Anthropic
`web_search_20250305` half of the split is queued as Session 2 — re-add
here once deploy validates that Session 1 + 1.5 deliver the behaviour
improvements Hareesh flagged.

- 2026-04-21 (H, bug) [verify vs Session 1 deploy]: Item 5 in Hareesh's
  feedback log — LLM confirms task captures that have not actually landed
  in the To Do list. Session 1 tool-use was supposed to close this.
  Diagnostic questions: (a) did `addToList` actually fire? check
  `[TOOL-USE]: addToList:ok` in `docker logs memu_core_standalone_api`
  around the confirmation timestamp; (b) if tool fired ok, is the UI
  reading stale `list_items` — refresh behaviour; (c) if tool didn't fire,
  Claude is falling back to prose confirmation — prompt-level fix in
  SKILL.md needed. Needs one concrete repro to diagnose.

- 2026-04-21 (H, bug) [mobile UX]: cannot copy text from Memu's messages in the mobile chat. ✅ fixed (commit `86f5ffe`+) — added `selectable={true}` to bubble text.

- 2026-04-20 (H, feature): chat history incomplete + uncurated. Memu chat
  doesn't hold full history; no way to label/group chats like named
  conversations; no search across chat history. Thin slice candidate:
  chat-session labels + search over `messages` (full-text + pgvector). Fits
  Part 11 v1.5 "semantic search across Spaces" in shape — may extend that
  work to cover messages too.

- 2026-04-22 (H, feature): Autonomous Grocery Agent (`agent-browser`). Implement a Playwright-based microservice that can log into supermarket websites (e.g., Sainsbury's) and add items to a basket from the Memu Shopping List. Requires a "Vault" abstraction to handle credentials differently across deployment tiers (direct access on Tier 2/Z2, encryption/just-in-time RAM decryption on Tier 1/Hetzner).

### From 2026-04-20 dogfood session (morning)

- 2026-04-20 (H, bug, ✅ fixed same session): chat "buy some veg stock for the
  soup" — Claude replied "Done, I've added vegetable stock to your shopping
  list!" but nothing landed in the Lists tab. Root cause: regex fast path in
  `listCommands.ts` only catches explicit "add X to shopping list" phrasings;
  Claude was told by the skill prompt to confirm confidently so it confirmed
  a hallucinated add. Fix: post-reply reconciler (`listReconciler.ts`) scans
  Claude's real-names reply for "added/put X to your shopping/task list"
  patterns and actually inserts the items. 13 tests including the exact
  Hareesh phrasing.

### From first-use session 2026-04-19 (the evening after B-live-1 shipped)

Source: `memory/project_memu_first_use_bugs.md`. Six bugs surfaced; 4 shipped
same evening, 2 open.

- 2026-04-19 (bug): voice dictation — add mic button in chat. On-device STT
  preferred; Whisper sidecar as fallback. Not a new skill, an input modality
  into the existing pipeline. [first-use bug #5]
- 2026-04-19 (bug): PDF / document ingestion — chat document picker +
  `skills/document_ingestion/SKILL.md` + pdf-parse / mammoth extraction →
  Twin anonymise → extraction → synthesis Space. Full text to
  `context_entries`; Space holds structured summary. [first-use bug #6 —
  **next coding task**]
- 2026-04-19 (bug, deferred cosmetic): Twin label format — regenerate
  `entity_registry` labels from raw IDs (`Family-177661940667O-0`) to
  semantic tokens (`Adult-2`, `Partner-1`, `Child-1`). Cosmetic until a
  label leaks to a visible surface. [first-use bug #2]
- 2026-04-19 (bug, deferred-skill): `skills/list_management/SKILL.md` +
  Claude tool-use wire-up for NL patterns the regex fast-path in
  `listCommands.ts` misses.

### Operational gaps from the same session

- 2026-04-19 (bug): Google Sign-In on Android — "custom URI scheme is not
  enabled". Fix: enable custom URI schemes in GCP Android OAuth client
  (Google-discouraged but works) OR migrate from
  `expo-auth-session/providers/google` to
  `@react-native-google-signin/google-signin` (the right fix, uses Play
  Services natively, ~½ session).
- 2026-04-19 (bug): Calendar OAuth returns `missing required parameter:
  client_id`. Root cause: `.env` changes don't survive `docker restart` /
  `docker compose restart`; needs `docker compose down && up -d` to recreate
  the container with fresh env. Also verify `/opt/memu-core/.env` on Z2 has
  the current HTTPS `GOOGLE_REDIRECT_URI`
  (`https://memu-hub.tail5c57ce.ts.net:8443/...`), not the old
  `http://memu-hub:3100/...`.

### Onboarding UX gap (from bugs memo)

- 2026-04-19 (obs): empty state after manual profile creation feels like a
  blank page. Consider a 3-question onboarding (what matters / who's in your
  household / how Memu should talk to you) to seed context. Lower priority.

---

## Shipped — moved here only for the Sunday retrospective, cleared at triage

- ✅ 2026-04-24 → 25 (beta-readiness batch for Tier-2 Z2 standalone). Closes
  the "memu was creating more work for me" complaint from the first-use
  session by making stream-card actions actually execute their persisted
  payload instead of just dismissing. Backend (`src/index.ts`,
  `src/intelligence/briefing.ts`): four new endpoints under
  `/api/stream/action/*` — `add-to-list`, `add-calendar-event`,
  `update-space`, `reply-draft`. Each loads + validates the persisted
  briefing action, executes its payload (calls `addItem` /
  `insertCalendarEvent` / `upsertSpace` / clipboard-ack respectively), and
  resolves the card. `briefing.ts` now runs `deepTranslateToReal` on
  `suggested_actions` before persisting to `stream_cards.actions` so real
  names survive in the JSONB. `/api/briefing/run-now` accepts
  `{channel: 'app' | 'push'}` so the new mobile test button can hit the
  actual `pushMorningBriefingToMobile` path. Mobile
  (`mobile/lib/api.ts`, `mobile/app/(tabs)/index.tsx`,
  `mobile/app/(tabs)/settings.tsx`): `StreamCardAction` typed as 7-variant
  discriminated union (4 briefing kinds + 3 legacy types), Today tab's
  `mapCardActions` renders briefing actions when present and falls back
  to the Calendar/List/Done triplet for extraction-path cards;
  `reply_draft` opens an inline preview modal with Copy (clipboard +
  ack + remove + toast) and Skip (no ack so user can revisit); Settings
  → Morning briefing modal gets a "Send test" row that runs the full
  briefing pipeline through `pushMorningBriefingToMobile`. Reflection
  cron tightened in the same window: confidence threshold 0.7,
  concrete-next-step requirement, daily reflection cron dropped (kept
  weekly + per-message + standards). Verbose push logging added to
  `sendPush` + the briefing cron. Commit `5c0e304` on `origin/main`,
  deployed to Z2 standalone 2026-04-25 02:08 UTC. EAS APK build kicked
  off — verifying on-device with the new "Send test" button is the next
  physical step. [resolves the stream-card half of cluster-1
  ("LLM confirms captures that have not actually landed"); chat-driven
  `addToList` half stays open under the 2026-04-21 entry pending Session
  1 deploy verification]

- ✅ 2026-04-20 evening (tool-use cluster, INBOX items 1 + 3 + 4 + the
  capabilities gap in item 2): Claude tool-use wired into
  `interactive_query` with three local tools — `addToList({list, items})`,
  `createSpace({title, category, body})`, `updateSpace({uri | category+slug,
  body})`. Tool execution is the source of truth; translation to real names
  happens inside executors so structural responses never leak real names
  back into the Claude loop. `skills/interactive_query/SKILL.md` bumped to
  v2 with explicit capabilities section + new rule that tool-call success
  IS the confirmation (replaces the old "Confirm confidently" rule that
  caused the hallucinated-add regression). Session 2 of the split — adding
  `web_search_20250305` — is queued behind this. Commit `3e038b5`.
  Reconciler in `9beb97d` kept as a safety net during transition.
  [resolves cluster 1+3+4, partial on 2]
- ✅ 2026-04-19 (bug): Spaces stored anonymised content instead of real
  names. Fixed: synthesis write path now runs `translateFromAnonymous()`
  before persisting (commit `0e12460`); retro migration over existing
  Spaces ran (`5ed4810`). [first-use bug #1]
- ✅ 2026-04-19 (bug): chat-said items (shopping / tasks) not persisting to
  a queryable surface. Fixed: unified `list_items` table (migration 016),
  `/api/lists` REST, mobile Lists tab rewired, PWA Lists sidebar + view
  added (commit `18ec00d`). [first-use bug #3]
- ✅ 2026-04-19 (bug, verified): camera / vision input flow already shipped
  on both mobile (`app/(tabs)/chat.tsx` with expo-image-picker + camera/
  library action sheet + `sendVision` → `/api/vision`) and PWA (quick
  composer + chat bar). [first-use bug #4]
