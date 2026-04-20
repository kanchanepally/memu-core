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

### From 2026-04-20 dogfood running list (afternoon)

Tool-use cluster (items 1 + 3 + 4 + the capabilities half of item 2) shipped
2026-04-20 evening in commit `3e038b5`. See the Shipped section below for
the resolution. The Anthropic `web_search_20250305` half of the split is
queued as Session 2 — re-add here once deploy validates that Session 1
delivers the behaviour improvement Hareesh flagged.

- 2026-04-20 (H, feature): chat history incomplete + uncurated. Memu chat
  doesn't hold full history; no way to label/group chats like named
  conversations; no search across chat history. Thin slice candidate:
  chat-session labels + search over `messages` (full-text + pgvector). Fits
  Part 11 v1.5 "semantic search across Spaces" in shape — may extend that
  work to cover messages too.

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
