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

### Pickup for next session (added 2026-05-18 night close)

**Trigger phrase from Hareesh:** *"how did the dogfood go"* /
*"researcher walkthrough feedback"* / *"mobile PDF works"* /
*"mobile PDF broken"*. He said he'd report back on a separate chat
tomorrow.

**State at session close.** Three PRs merged to main tonight (#42
W1-lite, #43 W0+W2+W3+W6+multi-PDF, #44 mobile native PDF). EAS
Android preview build kicked. End-to-end test plan published at
`memu-platform/docs/researcher-walkthrough-2026-05-18.md`.

**What Hareesh will be testing tomorrow:**

1. PWA writing pipeline against the digital-sovereignty paper corpus —
   the 7-phase walkthrough doc has structured feedback boxes per phase
2. Multi-PDF drop (10 PDFs at once, concurrency 2)
3. URL-to-Source ingestion (paste a blog/article URL → Source Space)
4. Cite picker (deterministic ILIKE baseline — feedback should tell
   us whether W4 LLM rank is genuinely needed or whether the baseline
   is good enough to defer further)
5. 7-format export — markdown / substack / docx / latex / pandoc /
   bibtex / print. Drift detection + commit + audit log
6. Mobile native PDF (when EAS APK installs) — replaces the OCR-text
   `<Text>` fallback with real pages via react-native-pdf

**Likely first asks when feedback lands:**
- Polish on specific surfaces named in the walkthrough's
  "report-back template"
- Cite-picker UX tuning if ILIKE matches aren't surfacing well
  (this is the natural lead-in to W4)
- Set-drawer add-artefact picker (currently `prompt()` browser dialog
  — proper modal noted as W2 polish in the test plan)
- Title PATCH endpoint for Writing Spaces (TODO marker exists; title
  edits local-only until reload)
- Drag-reorder for Working Set items (arrow add/remove works)
- Artefact-detail back-ref UI panel (artefact_uses data exists,
  panel doesn't — this is W1.1 / task #64)

**What's deferred and visible to Hareesh:** W4 (LLM cite-rank),
W5 (ambient draft_companion / section_critic), W7 (draft_grounding
with research-mode Twin + at-rest encryption prerequisites). All
named explicitly in the walkthrough's "Honest gaps" section so he
isn't blindsided.

**Branch hygiene at close:** main only on local + remote. All
feature branches deleted post-merge. Clean tree.

See also: [[project_memu_session_close_2026_05_18]],
[[project_memu_bs3_w0_w6_shipped]],
[[project_memu_writing_pipeline_reframe]].

---

### Researcher writing pipeline — pickup point (added 2026-05-17 evening close)

**Trigger phrase from Hareesh:** "let's design the researcher experience"
or any reference to the writing pipeline / Workbench / Writing Spaces /
the strategic reframe from 2026-05-17.

**The strategic shift (captured 2026-05-17 morning).** Memu has been
scoped as Reader + per-Source notepad. Hareesh pushed back: a researcher
synthesises ACROSS sources, writes literature reviews, drafts chapters
and articles. That writing happens OUTSIDE Memu today (Word / Scrivener /
Notion / LaTeX) — meaning Memu becomes ANOTHER tool in the stack, not
the tool that replaces the stack. Newport's bottleneck lens applied
cleanly: we accelerated capture (the not-bottleneck) and didn't touch
writing (THE bottleneck).

**The three things that close the loop (elevated from "post-beta
strategic" to CORE researcher product):**

1. **R5 — Workbench (cross-corpus aggregation).** A dedicated surface
   per research workspace showing all memos / quotes / codes / questions
   / connections across all Source + Field Spaces. Filter by code,
   source, theme, date. Searchable. Themable. This is where the
   literature-review thinking happens BEFORE writing — when you need
   to see "all my codes around caste mobility" or "every quote I pulled
   from Ambedkar".

2. **R6 — Writing Spaces (citable writing).** A new first-class Space
   category alongside Source / Field / Memo / Code. Long-form editor
   (Newsreader serif, generous column). Right-hand panel of your
   workspace artefacts, draggable into the text. Inline citation
   insertion (`@` or `[[` → fuzzy-search across your captured artefacts
   → pick one → inserts as citation-with-quote, linked back to source
   page+rect). Live cross-references that update when source memos
   change. **Trial versions** (your "writing trials" — fork a draft,
   diff between versions, merge changes back). Multi-format export
   (DOCX, LaTeX, Pandoc Markdown, BibTeX). The literature review
   gets written IN Memu, citing YOUR captured work.

3. **R4.2 — Agentic grounding.** Local AI agent (routed through
   anonymisation + Twin) reasons over YOUR corpus + YOUR captured
   artefacts. Drafts paragraphs with inline citations to your memos.
   Surfaces patterns ("you've coded 4 sources as 'methodology gap' —
   want a paragraph?"). Identifies absences ("you have no memos on
   caste mobility in Northeast India — your literature is thin there").
   All outputs are DRAFTS the user edits or rejects — never auto-apply.
   This is what makes Memu a research COPILOT rather than a digital
   filing cabinet.

**The end-to-end researcher journey, restated:**

```
1. CAPTURE       Drop PDF/transcript → Source/Field Space        [SHIPPED]
2. READ          Highlight → memo/quote/code/question per Source [SHIPPED — PR awaiting test]
3. PER-SOURCE    Synthesis below source with backlinks            [SHIPPED — PR awaiting test]
4. AGGREGATE     Workbench: all artefacts cross-source            [R5 — NEXT]
5. WRITE         Writing Spaces with inline citations + trials   [R6 — NEXT]
6. AGENT-ASSIST  Local agent drafts grounded in YOUR corpus      [R4.2 — NEXT]
7. EXPORT        DOCX/LaTeX/Pandoc/BibTeX with citations         [R6 continued]
```

Phases 1-3 are the reading half (current PR). Phases 4-7 are the
writing half — and they're inseparable: Writing without aggregation is
a notepad; aggregation without writing is a dashboard; both without
agentic grounding is mechanical.

**Worked example end-to-end — "Caste in India" research:**

Day 1 — workspace setup
- Create research workspace `Caste in India`
- Pick a workspace template (when R1 templates are extended for
  research personas)
- Drop in 30 PDFs (Ambedkar's *Annihilation of Caste*, Dirks' *Castes
  of Mind*, Deshpande's *Contemporary India*, plus 27 others) → 30
  Source Spaces auto-created via the unified ingestion pipeline (R2),
  each with OCR'd `body_markdown` + the original PDF stored at
  `MEMU_DOCUMENTS_ROOT/<workspace>/<yyyy-mm>/<uuid>-file.pdf`
- Drop in interview transcripts from Hyderabad fieldwork → Field
  Spaces (likely a new category alongside Source)
- Drop in voice memo transcripts → also Field Spaces

Days 2-30 — reading phase (the bottleneck this PR supports)
- Open each Source one at a time. Three-column layout: nav | PDF |
  insights panel.
- Highlight passages → verb pills (Memo / Quote / Code / Question)
  arm at top right. Click Memo → composer with the passage quoted,
  type your noticing, save. Card appears in right panel.
- Codes are tags with autocomplete: as you code your 5th paper, "caste
  mobility" and "Dalit pedagogy" and "structural exclusion" auto-
  suggest from your accumulated taxonomy.
- Synthesis section below each PDF: you write per-paper analytical
  prose. Indigo-italic spans backlink to captured artefacts. The
  per-paper synthesis IS the per-paper view.

Day 31+ — the writing pipeline (R5 + R6 + R4.2, NEXT SPRINT)
- **Workbench** (R5): open the workspace-level Workbench surface.
  Search "caste mobility" → every memo / quote / code / question
  across all 30 Sources + the field data, filterable by source / date
  / verb. Discover that "structural exclusion" appears in 8 papers
  and 12 interviews. See contradictions surface as the agent flags
  them.
- **Writing Space — "Lit Review v1"** (R6): new Space category.
  Long-form editor (Newsreader serif, generous column, full markdown).
  Type "Caste mobility in contemporary urban India must be read
  against @" — `@` fuzzy-searches your captured artefacts. Pick three
  quotes from Ambedkar, Deshpande, and a Hyderabad interviewee. They
  insert as citations-with-quoted-passages, indigo italic spans
  linked back to source page+rect.
- **Agent grounding** (R4.2): "Memu, draft a paragraph on the
  contradictions between Dirks' colonial-construct argument and
  Ambedkar's intrinsic-religious argument, citing my captured
  quotes." → produces a DRAFT paragraph using YOUR quotes, YOUR
  memos, YOUR field codes. You edit it. Never auto-applied.
- "Methodology section" — another Writing Space. Cites your field
  procedure decisions captured as memos in your Hyderabad interview
  Sources.
- "Findings chapter v1, v2, v3" — three Writing Spaces (your
  "writing trials"). Fork v1 → v2 with a different argument
  structure. Diff between them. Merge changes back if useful.
- Export "Lit Review v3" as DOCX with footnote-style citations OR
  as LaTeX with auto-generated BibTeX bibliography, OR as Pandoc
  Markdown for a journal's submission system.

Compounding (the months-and-years dimension)
- 6 months in: codebook of 80 codes is a personal taxonomy. Reusable
  across new papers — you don't re-invent "caste mobility" coding
  scheme every time.
- "What did I think about caste mobility 4 months ago?" — searchable.
  Past memos stay surfaced via the agent.
- Memo-to-memo connections (when Connections artefact ships) build a
  personal knowledge graph. Themes emerge across years of work.
- The agent's grounding gets RICHER as your corpus grows — its
  draft-paragraphs improve as it has more of your prior thinking to
  cite.
- A new paper drops on caste mobility in Northeast India → import it
  → the agent surfaces "this argues against your captured memo from
  Deshpande p.144" within minutes of import. The corpus comes alive.

Public / publishing (the outward dimension — sister vision)
- Some Writing Spaces should be publishable. Finished literature
  review, methodology white paper, completed chapter, blog essay.
  Render as static HTML at a subdomain like
  `hareesh.memu.digital/caste-mobility-lit-review`.
- Citations preserved as hyperlinks (public-only links to public
  sources; auth-gated to the source memo for private work).
- Inspirations to study: Obsidian Publish, Notion published pages,
  TiddlyWiki, Quartz (open-source digital garden tool).
- Enables: sharing work-in-progress with collaborators, soft-
  publishing chapters before formal journal submission, building a
  personal academic website that's the LIVE output of your Memu
  workspace rather than a separate maintenance burden.
- Privacy posture: the publishable Writing Space is OPT-IN per
  Space; default is private-to-workspace. Anonymisation applied at
  publish time (your field interviewees stay anonymous in the public
  view). The Show-the-Work footer Memu uses elsewhere applies:
  "Compiled from N captured artefacts across N sources" with a
  link to the public methodology.

**Honest gaps to close before R4.2 agent-drafting can ship safely:**

1. **No at-rest encryption.** PDFs sit as plaintext bytes on the Z2
   under `MEMU_DOCUMENTS_ROOT`; `body_markdown` sits as plaintext in
   Postgres. The Twin only protects the LLM interface, not storage.
   Filesystem-level compromise = data compromise. Pod-drive vision
   (per-person LUKS USB) addresses this for Tier-2 future; today on
   standalone Z2 you rely on disk-level encryption you set up
   yourself.

2. **Twin guard is opt-in per skill.** Skills with `requires_twin:
   true` are protected; skills without that flag bypass the guard.
   A developer adding a new skill who forgets the flag = unprotected
   path. Belt-and-braces would be "default ON, opt-out for genuinely
   non-sensitive skills". Currently the other way around.

3. **Research-mode Twin destroys public-figure semantics.** The Twin
   was designed for family content (Mrs Patel the piano teacher →
   Person-N). Applied to research content, it would scramble
   Ambedkar / Dirks / Deshpande into `Person-7 argues that Person-3
   misread Person-12`. Public authors and historical figures must be
   exempt from auto-registration; only the researcher's own
   identifiers (the researcher's name, their interviewees) should be
   anonymised. **This is a prereq for R4.2 — the agent drafting
   paragraphs needs to write "Ambedkar argues...", not "Person-7
   argues...".**

4. **Cross-workspace identity smearing.** The Twin registry is
   `family_id` (workspace) scoped. The same real person mentioned in
   your research workspace AND your family workspace may get
   different anonymous labels. Not catastrophic, but means a
   workspace-internal LLM context can't safely be passed across
   workspaces without re-anonymisation.

5. **Local LLM (Ollama) not wired.** The ModelRouter knows about
   `provider: 'ollama'` but the dispatch throws explicitly with
   "not yet implemented — Story 1.5 / Tier 3 work". Tier-3
   sovereign-mode is therefore real today only for the surfaces that
   don't need LLM (capture, reading, the entire PDF workbench). The
   moment R4.2 ships agentic drafting, Tier 3 needs Ollama wired or
   the agent can only run on Tier 1/2 with cloud LLMs.

These five gaps don't block the writing-pipeline build, but each
needs an explicit decision in the design conversation. #3 is the most
pressing — without research-mode Twin semantics, R4.2 drafting is
unusable. #1 is the most user-facing privacy promise.

**What was demoted (still on roadmap, just no longer same tier):**

- R7 (cross-workspace compounding — research-to-family bridge) —
  strategic but secondary to the researcher experience itself.
- Founding-50 hosting backend items (DPIA polish, Hetzner deploy
  refinements, magic-link auth UX). Better to have 20 researcher-
  product-complete users than 50 fancy-reader users churning out.

**Reading recommended before the design session:** the three Cal
Newport pieces Hareesh shared 2026-05-17 morning — *Avoiding Digital
Productivity Traps*, *Easy is Overrated*, *On Bottlenecks and
Productivity*. They frame why this elevation is the right call.

**Companion memory:** `project_memu_writing_pipeline_reframe.md`
**Sister thread:** `project_memu_thinking_platform_shift.md` (2026-05-14)

**Additional surfaces from 2026-05-17 Z2 dogfood (fold into this sprint, NOT bolt-ons):**

These surfaced during PWA testing of the merged v3 polish + PDF reading
workbench. They are NOT polish — they're the gaps that prove the
writing-pipeline thesis. Fold each into the R5/R6/R4.2 design:

1. **Workspace "About" / Project-style harness.** Like ChatGPT
   Projects, Claude Projects, Gems. Each workspace has a long-form
   "what is this workspace about + what should Memu know" document
   that gets fed into every chat turn in that workspace's context.
   Hareesh's phrasing: *"If I said something like, I am planning to
   write a novel and one of the key themes is caste, it should
   update the particular workspace memory or something like that."*
   The agent grounding (R4.2) NEEDS this as input — without it the
   agent has no top-of-mind about what the workspace is for. Should
   live as a first-class Settings page per workspace + editable from
   the workspace pill dropdown.

2. **Save chat response as a Space / Source.** When Memu replies with
   something valuable in chat, the user must be able to one-click
   "Save as Memo in this workspace" / "Save as Source". Today the
   reply is conversational, ephemeral. The writing pipeline turns
   conversation into accumulating corpus. Implementation: a small
   pill on each Memu reply bubble — "Save → Memo / Quote / Code /
   Source" — that opens the same composer modal pre-filled with the
   reply text + chat turn provenance.

3. **Workspace-type-aware web search default.** For research
   workspaces, the default search target should be academic
   (Semantic Scholar, arXiv, Google Scholar, JSTOR), not generic web.
   Hareesh: *"For researchers specifically, how can we extend this
   search to be by default academic papers etc rather than just
   web?"* Implementation: extend `web_search` skill to consult the
   active workspace type; route accordingly. Could also surface a
   small selector in the search results UI to override per query.

4. **Chat thinking ticker — live updates while in-flight.** Today
   the tool-call summary footer ("Memu just: searched the web ·
   appended 3 lines to a Space") shows after completion. While the
   agent is mid-call, there are long silent pauses. Stream the
   tool-call lifecycle to the UI (SSE events already exist for
   thinking events) — show "searching web…", "checking Spaces…",
   "drafting reply…" as they happen. Reduces the "is it stuck?"
   anxiety on slow turns.

5. **Connections artefact (5th kind) + synthesis backlinks.** The
   PDF reading workbench shipped Memo / Quote / Code / Question but
   NOT Connections (explicit links between artefacts:
   `{from_id, to_id, relation}`). Also: synthesis section structure
   is in place but indigo-italic passage backlinks
   (`[[memo:abc123]]` → click-to-jump) aren't wired. Both are
   prerequisites for the citable writing experience (R6) — a
   citation in a Writing Space IS a connection between the prose
   and a captured artefact.

**Smaller polish items from 2026-05-17 Z2 dogfood (Pass 2 — already
in `fix/v3-z2-test-feedback` branch, NOT in this researcher sprint):**

- Canvas dark mode (add missing CSS var aliases)
- Lists Tasks/Shopping pill highlight (JS toggling class, styles
  were inline)
- Memo save "Cannot read properties of null (reading 'spaceUri')"
  + Code save modal not closing (snapshot activeSelection before
  await)
- Top-right action row scrolls away (sticky)
- Verb pills scroll away (sticky)
- PDF chrome scrolls away on page 2 (align-self stretch +
  full-width)
- Insights panel overlaps PDF (grid + page max-width)
- Calendar events squashed (removed bad grid inline)
- News refresh button just a dot (inlined refresh SVG)
- Lens: Family copy mismatch (clearer message + nudge to invite
  household members)
- PDF too small in focus mode + no zoom (focus expands main column
  to 1100px, added zoom +/- controls to PDF chrome)
- Manual Create Space modal too small + "Robin's piano lessons"
  family placeholder (modal expanded to 880px / 92vw, generic
  placeholder + Markdown wikilink hint + serif body editor)

**Still NOT addressed in Pass 2 (need their own investigation):**

- Conversation history wiping when starting a new chat — most likely
  a backend question (when does a conversation get persisted? Does
  it surface in GET /api/chat/conversations immediately?). Needs a
  deeper dig.
- Canvas view design not per brief (full canvas-page redesign — bigger
  slice).
- Dashboard "What I'm thinking" cards not wired (placeholder — will
  populate when R4.2 agent ships).
- Top-right Search is a stub (known; needs search infrastructure).

---

### v3 visual redesign — pickup point (added 2026-05-16 late-night close, **updated 2026-05-17**)

**Trigger phrase from Hareesh:** "let's pick up v3 redesign work" (or
any reference to the redesign / pwa-redesign / mobile-redesign folders).

**UPDATE 2026-05-17:** Original `feat/v3-redesign` MERGED to main via
PR #38 at `e71107b`. A follow-on polish + PDF reading sprint then
shipped to branch **`feat/v3-polish-combined` @ `29ad69e`**, awaiting
test + merge. That branch carries: dark-mode cascade fix, inline logo
SVG (so currentColor works), app-shell scroll model (sidebar stays
visible), chat composer rebuild + speaker avatars, font consistency,
modal + Workspaces + Import reskin, mobile per-screen content polish
(all 6 (tabs) screens to v3 shapes via useTokens), and the **PDF
reading workbench** per Hareesh's design mocks (three-column layout,
top-right action row, PDF viewer chrome, anchored verb pills,
redesigned composer modal, synthesis section below PDF, Passage/All
toggle, GET /api/spaces/:id/insights endpoint).

**Where we are.** Branch `feat/v3-redesign` at `9ed3809` carries the
full v3 visual redesign — design system foundation + 8 PWA per-screen
ports + mobile theme provider + mobile chrome reskin. Not merged to
main yet. Hareesh pulls + tests on the Z2 and EAS APK before merge.

**What landed (16 commits across 3 logical phases):**

Phase 1 — design system foundation (`92bfb66`):
- `css/memu-tokens.css` (light + dark + back-compat aliases for
  Indigo Sanctuary var names so style.css works through transition)
- `css/memu-components.css` (.eyebrow, .serif-display, .memu-card,
  .btn-pill, .status-pill, .mono-chip, .memu-glow-bg, .theme-toggle,
  +5 more)
- `js/theme-init.js` + `js/theme-toggle.js`
- `marks/` — 16 SVGs (logomark + 14 hand-drawn marks + icons.svg
  sprite with 28 named icons)
- dashboard.html `<head>` and body-end wired with all three

Phase 2 — PWA per-screen ports (`f8fab3b` → `e0972da`, 8 commits):
- Sidebar (with theme toggle button)
- Today (Dashboard)
- Chat
- Calendar
- Lists
- Privacy Ledger
- Settings (with Appearance section + second theme toggle)
- Spaces list view + canvas.html chrome refresh **+ chip-set bug fix
  for research workspaces** (item 1 from the researcher pickup
  absorbed into this commit per Hareesh's combine call)

Phase 3 — mobile theme + drawer (`ef6d208` → `1319c9a`, 6 commits):
- 5 deps installed (react-native-svg, AsyncStorage, 3 Google Font
  packages) — package-lock committed
- `lib/tokens.ts` replaced with v3 light/dark maps + back-compat
  shims at the bottom for ~41 existing files that import
  colors/typography/shadows/motion
- `lib/theme.tsx` (ThemeProvider + useTokens() + system-aware +
  AsyncStorage persistence)
- `lib/fonts.ts` (useMemuFonts hook for Inter + Newsreader +
  JetBrains Mono)
- `components/Marks.tsx` + `MobileHeader.tsx` + `ThemeToggle.tsx`
- `_layout.tsx` wraps the app in ThemeProvider + loads fonts
- `SideDrawer` re-skinned in place (not replaced) — existing wiring
  preserved, light mode renders v3, dark-mode parity refactor noted
  as TODO at `SideDrawer.tsx:20`
- Settings adds a ThemeToggle card above Privacy (`bee4314`)

**What Hareesh tests on first pull:**
1. PWA hard-refresh in Chrome on the Z2. Toggle theme via the icon in
   sidebar OR in Settings → Appearance — should swap light ↔ dark
   without a flash on reload. data-theme attribute on `<html>`.
2. Cycle through every tab (Chat, Spaces, Today, Calendar, Lists,
   Ledger, Settings) — verify no console errors and that all the
   interactive features still work: chat send, conversation switch,
   PDF upload, focus mode, Memo composer, calendar event open, list
   item check, etc. Most of the live wiring is JS-bound by id /
   onclick / data-* which the agents preserved.
3. Canvas page (Spaces graph view) — confirm chip strip varies per
   workspace type (research workspaces no longer show person/routine/
   household/commitment/document chips).
4. Mobile: rebuild EAS Android preview, install. Should see new font
   stack + theme toggle in Settings. Today/Chat/Spaces/Lists/Calendar
   render with v3 chrome (header + container colors come from
   `useTokens()`) but the per-screen content cards are still legacy
   shapes — the deep content port is a follow-on session.

**Known incomplete — for the follow-on session(s):**

**Resolved in the 2026-05-17 sprint (now on `feat/v3-polish-combined`):**
- ~~PWA modals + Workspaces/Import tabs reskin~~ — DONE
- ~~Mobile per-screen content ports~~ — DONE (all 6 (tabs) screens)
- ~~Mobile SideDrawer dark-mode parity~~ — DONE (TODO at SideDrawer.tsx:20 cleared)

**Still pending after the 2026-05-17 sprint:**
1. **PWA — Ledger four-up stats + provider filter + CSV export.**
   Two `<!-- TODO(v3) -->` markers in dashboard.html ledger section.
   Render as empty layout placeholders. Need a `/api/ledger/stats`
   endpoint + backend wiring for filter + export.
2. **PDF reading — Connections artefact type (5th kind).** Memo /
   Quote / Code / Question all shipped with persistence. Connection
   (`{from_id, to_id, relation}`) deferred — needs a schema design
   conversation (new table `space_connections` with relation enum,
   or a JSONB column on `synthesis_pages`) + endpoint + creation
   UI + graph-aware right-panel render.
3. **PDF reading — Synthesis backlinks.** The synthesis section
   structure is in place (`▼ YOUR SYNTHESIS` eyebrow, empty state,
   body container) but the markup convention for indigo-italic
   passage-backlinks (e.g. `[[memo:abc123]]` → click-to-jump) isn't
   wired. Body renders via existing `renderSpaceBody` which handles
   wikilinks generically; a memo-specific render pass is needed.
4. **PDF reading — Find-in-document.** Search icon in the PDF
   chrome is a stub button — pdf.js v4 findController integration
   is a multi-session feature on its own.

**(These four are smaller polish items. The strategic next move is
not closing these — it's the writing pipeline at the top of this
file.)**

**Test status at merge:** 786 backend tests passing (no regression
vs main), backend tsc clean, mobile tsc clean.

**Branch operations:**
- `feat/v3-redesign` is pushed. Sub-branches deleted local + remote.
- Worktrees cleaned up.
- Merge to main via PR when Hareesh is happy after his test pass.

---

### Researcher space — pickup point (added 2026-05-16 evening close)

**Trigger phrase from Hareesh:** "let's pick up researcher space work".

**Where we are.** Build Spec 2 Phase Z (reading surface) + Phase R1–R4
are all shipped, deployed to Z2, and verified by Hareesh tonight on a
research workspace with a real PDF upload. The researcher track is a
parallel thread to Milestone C (Founding-50 beta) — both are live;
neither blocks the other.

**Branch state.** Local repo is on `main` only (plus
`feat/pwa-workspace-switcher` kept by Hareesh's call). All R-cluster
and Phase-Z branches deleted from local + origin. `main` is at
`267ed68` — the boot deep-link + upload reply crash fixes (PR #37).

**What shipped today (2026-05-15 → 2026-05-16):**

- **Phase R1** — workspace_templates table, research_blank template,
  per-workspace category sets (Source / Memo / Question / Code /
  Synthesis / Output), Memo creator wired (PR #29/#30 family of merges).
- **Phase R2** — unified source ingestion: `/api/document` dispatches
  to `processResearchSourceIngestion` for research workspaces, raw
  text → Source-category Space, no LLM call (deterministic), Twin
  registration runs BEFORE storage. Family vs research truncation
  caps (50k vs 500k chars).
- **Phase R3** — active-reading toolbar (floating selection handler →
  data-pid ancestor walk → composer modal pre-populated with quoted
  passage + source ref). Memo + Quote verbs functional; Code +
  Question stubbed pending R4.2 agent runtime.
- **Phase R4** — three-tier AI + eval harness (deterministic services
  tier: `nearDuplicates.ts` cosine via pgvector, `walkConnections.ts`
  BFS over space_connections, with unit-test coverage).
- **Phase Z (reading)** — markdown-it + footnote/deflist/task-lists/
  abbr/sub/sup plugins, stable passage IDs via `<!-- pid:XYZ -->` HTML
  comments + custom plugin extracting to `data-pid` attrs, PDF inline
  rendering via pdf.js v4 ESM, reading state + Continue-reading,
  visible Focus mode button (was keyboard-only).
- **Workspace rename** — PATCH /api/workspaces/:id + PWA UI.
- **Three fix-branches** — migration 048 TEXT FK types; PDF auth +
  workspace headers across canvas/kids/onboarding; R2/R3 workspace-
  type dispatch via `currentCollectiveId()` + session GUC (the
  cascade fix that made R2/R3 actually work); boot deep-link skipping
  initWorkspaceSwitcher + upload reply crash on research responses.

**Open from today's dogfood — these are the actual next slices:**

1. **Canvas hardcoded family chips.** `canvas.html` still renders
   person / routine / household / commitment / document chips even
   when viewing a research workspace. Per-workspace-type rewiring
   needed — mirror dashboard.html's `getActiveCategorySet()` /
   `CATEGORY_DISPLAYS` / `FAMILY_SET` / `RESEARCH_SET` pattern.
   `canvas.html` already has `getActiveWorkspaceId()` + workspace
   header; just needs the chip-set lookup. Should be ~30 minutes.

2. **Duplicate Spaces on PDF upload.** Hareesh observed "Two
   'document' spaces created when i uploaded an article pdf. one
   with actual rendered pdf space." Two creation paths fire and
   neither dedups. Need to trace: `/api/document` (research path)
   vs whatever other path the PDF picker is hitting. The two have
   different shapes (one with `document:` source ref + inline PDF,
   one without).

3. **Family-shape AI summary in research workspace.** Hareesh: "Still
   keeps talking about family stuff." Some prompt/skill is still
   using family vocab in a research context. Probably the chat
   `interactive_query` skill — needs a per-workspace-type framing
   variant or a system-prompt extension that names the active
   workspace type and category set.

**Then the planned phases (in order):**

- **R3.2** — memo suggestion skill (Claude proposes a memo when
  the user dwells on a passage)
- **R3.3** — coding-proposal batch flow (Code verb — needs R4.2)
- **R3.4** — question linking (Question verb — needs R4.2)
- **R4.2** — agent runtime (background workers that consume the
  deterministic services from R4.1, gated by per-workspace budget)
- **R5** — cross-corpus intelligence (link findings across research
  workspaces — the compounding payoff)
- **R6** — citable export + output fan-out (PDF / DOCX / .bib /
  Markdown bundles with stable passage citations)
- **R7** — cross-workspace compounding (the family ↔ research
  bridge — e.g. parenting research informs a family decision)

**The researcher work and Milestone C run in parallel.** Don't merge
the two priority lists. The 2026-05-06 Founding-50 pickup below is
still live; the researcher track is its own line of work.

---

### Pickup for the next session (added 2026-05-06 evening close)

**Priority shift confirmed by Hareesh tonight: get Founding-50 beta
families onboarded ASAP.** Personal dogfood is in good enough shape
post-2026-05-06 deploy to not block beta. Further dogfood iteration
runs in parallel, not ahead of, Milestone C.

**Top of the list, in priority order:**

1. **Z2 + APK verification of tonight's deploy.** The 2026-05-06 PWA
   fixpass merged via `feat/sidebar-conversations` (commits `36cea29`,
   `7e68dd3`, `c8e987d`, `d85fe1c`). Hareesh pulled on the Z2 +
   kicked off EAS Android build. Verify on hard refresh: (a)
   browser console clean on first paint (no `addEventListener` null,
   no TDZ on `stagedAttachment`/`spacesState`); (b) chat send fires
   on Enter and click; (c) Spaces tab loads — if it doesn't, the
   new structured `[loadSpaces]` console messages name the failing
   branch (network / HTTP / parse / render); (d) canvas → click
   node → opens that Space (deep-link IIFE now runs); (e) switching
   conversations clears the composer (Bug F).

2. **Milestone C kick-off — Tier-1 hosted readiness for ~20
   Founding-50 beta families.** Per `memu-platform/memu-build-plan.md`
   Part 7 (C-Infrastructure + C-Product). Six slices, in rough order:
   real `family_id` audit (catch any remaining `profile_id`-scoped
   queries that block multi-family hosting); magic-link auth review
   (already shipped for invites — needs to be the primary path for
   Founding-50 sign-up too, not Google OAuth); conversational
   onboarding (per the 2026-04-26 feature note — replaces the
   form-based wizard); Hetzner deploy + secrets management; DPIA +
   Privacy-by-Design dossier (the wedge story documented for
   regulators); Stripe + Founding-50 grandfather (£2.99/month locked
   for life). The pricing strategy doc at
   `memu-platform/Pricing and economics/files/memu-gtm-pricing-funding-strategy.md`
   is the canonical source for tier pricing + billing logic.

3. **Investigate the container_id 400.** Still no second repro (the
   original was `req_011CaSsALet9nquWKrmnW8Vm` from 2026-04-26
   19:35:46). Likely a quirk of how `src/skills/router.ts:512+`
   reconstructs Claude's content array when the assistant response
   includes server-side `web_search_tool_result` blocks alongside
   text or local tool_use blocks. Don't fix blind — capture another
   repro with the request body logged. Add a request-body dump
   gated on `MEMU_DEBUG_TOOL_LOOP=true` env so we can flip it on
   when the symptom recurs without spamming logs in production.

4. **Autolearn → DeepSeek-V3 migration.** First skill to test on the
   new provider per the routing matrix below. Edit
   `skills/autolearn/SKILL.md` `model: haiku` → `model: deepseek-chat`.
   Run a week, compare ledger `latency_ms` + observation quality on
   real Hareesh + Rach traffic. If it holds, escalate to
   synthesis_update + synthesis_write together. **Defer until
   Milestone C ships** — provider economics are nice-to-have
   compared to actually having paying customers.

5. **CLAUDE.md sweep for "single-tenant" wording.** Multi-profile
   shipped 2026-04-26. The `auth.ts` doc-comments + the build plan
   still say "single-tenant MVP" in places. 5-10 minute pass to
   reflect reality. Worth bundling with the C-Infrastructure
   `family_id` audit since both touch the same scoping vocabulary.

6. **Pod-drive directory dry-run on Z2** (no hardware needed). Per
   `memu-platform/14-POD-DRIVES.md` closing section. Validates the
   data shape before any LUKS / udev / hardware lifecycle work. Not
   on the critical path for Founding-50 (Tier-1 hosted doesn't use
   per-person drives) — defer to Tier-2 work post-beta.

### From 2026-05-06 PWA fixpass session — root cause + scars

- 2026-05-06 (H, bug, ✅ **RESOLVED commit `c8e987d`**): "Pressing
  Enter or clicking the send button does nothing" plus
  "Couldn't load Spaces" plus canvas-click-goes-to-chat — all three
  were the same root cause. The Today quick composer was retired
  earlier in the week, but only its HTML was deleted; the matching
  JS block at `dashboard.html:2253` still called
  `document.getElementById('quick-input').addEventListener(...)`
  on elements that no longer existed. That single throw at script
  load aborted the rest of the inline `<script>`, leaving every
  `let` declaration after it (`stagedAttachment`, `spacesState`)
  in the temporal dead zone, AND skipping the deep-link IIFE at
  the bottom of the script that reads `?space=` from the URL. So
  canvas → Space lost its routing, chat send TDZ'd on
  `stagedAttachment`, Spaces tab TDZ'd on `spacesState`. Deleted
  the 39-line dead block; defensive null guards on
  `chatInput`/`chatSend`/`chatMessages` retained as belt-and-braces.

  **Lesson captured.** When "everything is broken at once" in a
  single inline-script PWA, look for one early-load throw before
  papering over each surface. The defensive guards I'd added in
  the earlier commit (`36cea29`) didn't fix the bug — they revealed
  it by surfacing the cascade in DevTools console where the original
  silent abort had hidden it. Worth keeping the structured-error
  branches in `loadSpaces()` for the same reason: future
  refactors will introduce future zombie listeners; surface fast.

- 2026-05-06 (obs, ✅ **RESOLVED commit `d85fe1c`**): Same class of
  refactor leftover on mobile, but RN's module isolation made it
  harmless rather than fatal. Strict typecheck
  (`tsc --noEmit --noUnusedLocals --noUnusedParameters`) found
  `chat.tsx` `activeConversationId` write-only state and
  `Toast.tsx` unused `View` import. Pure dead code, removed. No
  behaviour change. Worth running strict typecheck periodically
  to catch refactor zombies before they have a chance to grow.

- 2026-05-06 (obs): Pre-existing shimmed functions
  `setChatTitle(_title)`, `toggleChatHistory(_force)`,
  `closeChatHistoryOnNarrow` callsites guarded by
  `typeof === 'function'` — all from the pre-drawer history-modal
  era. Safe (they're no-ops or guarded), but worth a follow-up
  cleanup pass once Hareesh confirms tonight's deploy is stable
  (let the dust settle before sweeping). Tracked as nice-to-have.

### Routing matrix (decision pending — added 2026-04-26 evening)

DeepSeek is now wired as a routing provider (commit forthcoming in this
session). To migrate a skill, edit its `SKILL.md` frontmatter `model:`
field. Or use a global env override like
`MEMU_MODEL_OVERRIDE_SONNET=deepseek-chat`. **Current authored model is
the source of truth — nothing was moved automatically.**

| Skill | Today | Safe target | Why |
|---|---|---|---|
| `interactive_query` | sonnet | **stay** | Needs `web_search_20260209` (Anthropic-only) and tool-use chain |
| `vision` | sonnet-vision | **stay** | DeepSeek/Gemini vision dispatch path not wired |
| `extraction` | gemini-flash | **stay** | Already cheap |
| `twin_translate` | local (→haiku override) | gemini-flash-lite | Free tier; novel-NER works fine on small models |
| `autolearn` | haiku | **deepseek-chat** | Per-turn observation extraction; ~10× cheaper than Haiku |
| `synthesis_update` | sonnet | **deepseek-chat** | Text in, JSON out — V3 handles structured output well |
| `synthesis_write` | sonnet | **deepseek-chat** | Text generation; minimal quality loss expected |
| `briefing` | sonnet | **deepseek-chat** or **gemini-flash** | One call/day per family — could even use free tier |
| `reflection` | sonnet | **deepseek-chat** | Daily/weekly batch, latency-tolerant |
| `document_ingestion` | sonnet | **deepseek-chat** (test first) | Heavy structured extraction; verify on real PDF before committing |
| `import_extract` | haiku | **deepseek-chat** | Bulk fact extraction, rare |

Estimated savings if all "safe target" skills move: **~£20/family/month
→ ~£3/family/month** at Hareesh's household volume. Material at
Founding-50 scale (~£1,000/year). Privacy posture unchanged — Twin guard
runs ahead of dispatch regardless of provider, so DeepSeek/Gemini never
see real names.

**Migration order suggestion:** start with one — autolearn — for a week
of ledger data. If quality holds, move synthesis_update + synthesis_write
together (they share the synthesis pipeline and should be evaluated as a
pair). Then briefing/reflection. Document_ingestion last — its
structured-output requirements are the most demanding and worth testing
deliberately.

**GDPR note for Tier-1 hosted beta.** DeepSeek is a Chinese company.
Data jurisdiction is China. The Twin invariant means anonymous tokens
only leave the EU, never real names — the same posture as Anthropic
(US) or Google (US). Worth surfacing explicitly in the privacy ledger
+ DPIA when Founding-50 lands. Memu's defence is structural: privacy
by anonymisation, not by provider geography.

### From 2026-04-26 dogfood (post-document-ingestion deploy)

- 2026-04-26 (H, bug, ✅ **RESOLVED commits `27cad89` + `04d34de`**):
  PDF upload PWA → `spawnSync git ENOENT`. Two-part fix shipped: (1) git
  installed in Dockerfile runtime image; (2) `ensureFamilyRepo`'s git
  init wrapped in try/catch with console.warn fallback so Space writes
  succeed even if git is missing. Verified by deploy + WeST PDF re-upload
  later same evening.

- 2026-04-26 (H, bug, ✅ **RESOLVED commit `04d34de`**): Paperclip not
  visible in PWA chat composer. Root cause was the SVG glyph itself —
  it was a camera icon (single eye + lens), not a paperclip. Swapped to
  Feather paperclip on both `quick-attach` and `chat-attach` buttons.

### New bugs surfaced 2026-04-26 evening

- 2026-04-26 (H, bug, **MED — needs repro to diagnose**): Anthropic
  returns `400 invalid_request_error: container_id is required when
  there are pending tool uses generated by code execution with tools`
  on `interactive_query` mid-chain. Original repro:
  `req_011CaSsALet9nquWKrmnW8Vm` at 2026-04-26 19:35:46 (in
  `privacy_ledger` row from same timestamp). The chain ran one
  successful iteration (1954ms, 6091/29 tokens) then iteration 2
  failed. Memu doesn't use Anthropic's `code_execution_20250522`
  tool — only `web_search_20260209` server-side. Hypothesis: how
  `src/skills/router.ts:512+` reconstructs the assistant's content
  array between iterations (when it includes `server_tool_use` /
  `web_search_tool_result` blocks) confuses the API into thinking
  there are pending code-execution outputs. **Don't fix blind —
  capture another repro with the request body logged before
  speculating.** Workaround until then: catch + degrade gracefully
  (return text-so-far). Likely interacts with the new
  MAX_TOOL_ITERATIONS=10 bump from commit `24e273b` because longer
  chains hit this more often.

- 2026-04-26 (H, bug, ✅ **RESOLVED commit `e4f0539`**): Gemini
  free-tier 429 ("Quota exceeded for metric:
  generate_content_free_tier_requests, limit: 20") was the noisy
  symptom. Underlying cause: WhatsApp Baileys ingestion was running in
  "Phase 1: Omnivorous" mode — every message Baileys delivered (group
  chats, family threads, friend DMs, newsletters) was hitting the
  extraction skill on Gemini Flash. Limit hit in minutes. Fix:
  `MEMU_WHATSAPP_INGESTION` env var with default `self_only`. Only
  the user's own self-chat ("Message yourself") is processed.
  Throttled summary log every 60s tells the operator how many
  messages got skipped. Set `MEMU_WHATSAPP_INGESTION=all` to restore
  legacy omnivorous behaviour. Extraction stays on Gemini Flash per
  Hareesh's explicit choice — only the ingestion volume changes.

- 2026-04-26 (H, gap, ✅ **RESOLVED commit `04620da`**): Couldn't add
  Rach as a household member. Root cause: `auth.ts:registerProfile`
  and `channels/auth/google-signin.ts:signInWithGoogle` were both
  hardcoded single-tenant — both short-circuited to return the
  primary profile if any existed. New device sign-in returned
  Hareesh's profile + API key. Fix shipped: `registerProfile` gains
  `options.allowExisting` flag (default true preserves backstop);
  `signInWithGoogle` becomes a 4-step resolver
  (match-by-email → adopt-onto-primary → first-boot-create → reject
  with `GoogleSignInRejected`); new `POST /api/profiles` admin-only
  endpoint with magic-link generation; PWA Settings → Household
  panel; PWA index.html landing handles `?serverUrl=&apiKey=` query
  params. One tap from invite to signed-in.

- 2026-04-26 (obs): Layout bug in PWA after the Littlebird sidebar
  refresh — content rendered in a ~120px column when sidebar was
  hidden. Root cause: CSS Grid with `position: fixed` sidebar pulled
  the sidebar out of grid flow, so `app-main` got auto-placed into
  column 1 (the 0-width column). Switched to flex layout (commit
  `5b7468d`). Worth noting the lesson: when an element switches
  between in-flow (`position: sticky`) and out-of-flow
  (`position: fixed`) based on viewport / state, grid auto-placement
  becomes brittle. Flex is more forgiving. Same applies elsewhere if
  we ever rebuild the layout.

### From 2026-04-26 dogfood (synthesis correctness + self-awareness)

- 2026-04-26 (H, bug, **verified disclaim repro — RESOLVED in two
  hops**): "Search for the most affordable bags of organic compost"
  → Claude replied "Search isn't cooperating this morning. Here's
  what I'd suggest in the meantime…" with UK-specific fallbacks
  (Aldi/Lidl/B&Q/Wickes/Amazon). API logs confirmed `webSearch`
  was **never called** (no `[WEB SEARCH] Query:` log line, no
  `[TOOL-USE]: webSearch:*` entry). Claude had the tool wired
  per v4 SKILL.md but chose to deflect with a plausible-sounding
  excuse. **Hop 1 — Slice 1 of item 2 deployed:** v5 capabilities-
  authority paragraph + SOUL disclaim mirror landed; Claude started
  calling `webSearch` reliably. New symptom: footer read
  `_Memu just: ⚠ web search failed (no_results)_` — DDG Lite
  scraping returning empty from the Z2's IP (rate-limit / captcha
  / parse drift). **Hop 2 — Tool-Use Session 2 deployed:** local
  DDG Lite scraper replaced with Anthropic's native
  `web_search_20260209` server-side tool. Search now resolves on
  Anthropic's infrastructure with proper grounded results +
  citations. Disclaim symptom resolved structurally; reliability
  symptom resolved by provider migration. Both hops shipped
  2026-04-26.



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
