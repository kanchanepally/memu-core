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

### From 2026-04-20 dogfood session

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
