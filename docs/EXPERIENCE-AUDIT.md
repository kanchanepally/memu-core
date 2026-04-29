# Memu Experience Audit

**Audit date:** 2026-04-29
**Codebase state:** memu-core through commit `04620da` (multi-profile shipped 2026-04-26). At time of audit, the live Z2 had not yet deployed those commits — so live behaviour trails the audit's source-of-truth, which is the codebase as committed.
**Why this exists:** see `backlog/CRITIQUE-2026-04-27.md`. Two days of troubleshooting an "I sent a self-chat and Memu didn't process it" question surfaced five latent bugs in code shipped over the prior fortnight. The bugs were not bad code in isolation — they were missing UX walkthroughs after the code was written. Hareesh, fairly: *"we keep introducing bugs faster than we fix them … 100k tokens to find issues in code that you built."*

This audit is the response. It pauses feature work, asks "what does the product feel like for sixteen kinds of user", and uses the answer to sequence the next four to five build sessions. The aim is to ship in user-experience priority order rather than feature-interesting order.

---

## How to read this document

- **This file** is the master synthesis: cross-cutting findings, Hareesh-specific calibration, and the recommended sequencing of the next sessions.
- **`docs/experience-audit/*.md`** are the four cluster files. Each contains four full per-persona audits using a strict template (Snapshot → JTBDs → Where Memu fits → Day 0 / 1 / 7 / 30 → Empty-state → Current failures → Highest-value first build).
- **`backlog/CRITIQUE-2026-04-27.md`** captures the five concrete bugs from 2026-04-27 + the meta-bug about confabulation from emptiness. Sequenced into the recommendations below.

If you read only one section: skip to **"Cross-cutting findings"** below. The single highest-leverage change across all sixteen personas is named there.

---

## The personas

Sixteen personas across four clusters. Each persona's strongest fit, weakest fit, surprising gap, and highest-value first build are summarised below; full audits in cluster files.

### Cluster 1 — Household core ([household-core.md](experience-audit/household-core.md))

| Persona | Fit | Highest-value first build |
|---|---|---|
| Primary household admin | **Strong** — Memu fits this persona better than any other. The execution gaps are the bottleneck, not the product-market fit. | Onboarding seed prompt + visible context-confirmation messages |
| Co-adult partner | Conditional. Real fit, but entirely dependent on the admin's setup quality. The partner has no independent onboarding path. | Magic link → mobile app deep-link handshake (currently PWA-only) |
| Young child (5-9) | **None today.** Kids Mode is documented in CLAUDE.md, the architecture diagram, the file structure — and does not exist in the actual codebase. | Minimal Kids Mode chat screen + child-safe system prompt |
| Teenager (13-17) | Weak. The role binary (child / adult) breaks for the 13-17 range. Privacy framing absent. | Privacy declaration on first open, per-profile (also serves co-adult partner) |

### Cluster 2 — Adult life roles ([adult-roles.md](experience-audit/adult-roles.md))

| Persona | Fit | Highest-value first build |
|---|---|---|
| Solo individual | Weak. The product's family framing is consistent friction. Tier 1 hosted is the entire path to market. | Tier 1 hosted deployment (Milestone C) — without it this persona is unreachable |
| Home-maker / household ops | Strong on paper. Blocked by absence of Tier 1 and absence of context-seeding onboarding. | 3-question seeded onboarding (who in household / what schools / what weekly anchors) |
| Working parent w/ knowledge work | Partial. Single Google Calendar OAuth slot prevents work + personal calendar separation. | Optional second daily briefing at configurable time, family-only |
| Caregiver of aging parent | **Highest fit in cluster.** Document ingestion + Spaces + multi-profile maps almost exactly to the care-coordination problem. Highest-risk persona for empty-state confabulation (medical information). | Source citation in mobile chat replies (provenance infrastructure already exists; surface absent) |

### Cluster 3 — Career & growth ([career-and-growth.md](experience-audit/career-and-growth.md))

| Persona | Fit | Highest-value first build |
|---|---|---|
| Founder / entrepreneur (Hareesh-shaped) | Strongest fit in cluster — Hareesh himself is the existence proof. Single context pool per profile is the structural ceiling. | Domain / project scoping in chat (also the right fix for several other personas) |
| Job seeker | Weak. No application object type, no urgency model, family-centric framing alienating. | **Punt.** Building for this persona delays the family core. |
| Student | Weak-to-partial. Document QA is the only strong differentiator; commodity AI elsewhere. | Punt as primary target. Reusable: deadline-aware push (also serves family use). |
| Ambitious professional | Partial. Long-horizon use case (career development over 18mo) genuinely fits Memu's accumulation model. | Domain / project scoping (same as founder) |

### Cluster 4 — Conviction & specialist ([conviction-and-specialist.md](experience-audit/conviction-and-specialist.md))

| Persona | Fit | Highest-value first build |
|---|---|---|
| Self-hoster / privacy maximalist | **Memu's strongest fit, full stop.** AGPLv3, local embeddings, verifiable Twin, Privacy Ledger, audit trail — the architecture matches their values exactly. Gaps are specific and discoverable from code. | Fix git ENOENT bug + surface Twin violation alerts in Privacy Ledger UI |
| Researcher / journalist | Partial. Real value over Obsidian-with-no-AI. Limited by registry-based Twin (ad-hoc codes pass through), no air-gap mode without Ollama, no scoped delete. | Retrieval provenance shown in AI replies (legal defensibility) |
| Neighbour / community-light | **None today.** No public-read or pre-signed-link flow exists. Magic link creates full household member, not a reader. | A `space_shares` table + unauthenticated read route (one session of work) |
| Multi-agent power user | Partial. Solid-OIDC + WebID + DPoP plumbing is real. No MCP server surface. | Thin MCP adapter exposing list_spaces / get_space / update_space |

---

## Cross-cutting findings

Six patterns appear across all four clusters. The first one is the most important.

### 1. Confabulation from emptiness is the single highest-severity universal failure

Every cluster names this, in different words, as the dominant failure mode. When Memu has no/sparse data, it generates confident answers from training-data parametric knowledge with no signal to the user that nothing was retrieved. The Privacy Ledger shows what was *sent* to the AI; it does not flag "context block was empty."

The cluster-specific harm:
- **Household admin** churns: "you have a quiet day, enjoy" three days in a row reads as broken.
- **Caregiver** is at safety risk: medical information generated from training data is visually indistinguishable from information retrieved from an uploaded discharge summary.
- **Founder / professional** can't build trust: the use case requires the AI to recall what it was told, and undifferentiated confident answers destroy that trust the moment they're noticed.
- **Journalist** has legal liability: confident AI synthesis on an investigation it knows nothing about, surfaced with no provenance, is the worst-case failure of the entire audit.
- **Privacy maximalist** loses faith: this is the user who will catch it first and fastest.

This is not five separate problems. It is one product behaviour applied to five contexts.

**The fix is structural, not cosmetic.** It is detailed in `CRITIQUE-2026-04-27.md` under "Meta-bug" and consists of: empty-state gates on synthesis paths, a retrieval-empty flag passed through to chat replies, source citation rendered in the chat UI, and a `context_block_empty` flag on Privacy Ledger entries. Together these turn "Memu confidently making things up" into "Memu honestly says when it doesn't know, and visibly cites when it does."

### 2. There is no onboarding that seeds context — every persona's Day 0 is a blank chat

All sixteen personas land at Memu with the same problem: nothing in the system to retrieve from, no guidance to seed it, no visible feedback that anything is being learned even when they do try. The setup screen collects name, email, and "family names." Then the user is at the Today screen, which is empty.

The fix is consistent across the cluster recommendations: a 3-question seeded onboarding that creates initial Spaces ("who is in your household / what schools or work / what are your weekly anchors") plus a synthetic first message from Memu after setup completes ("I'm ready. Tell me what's happening this week — I'll start building from there"), plus a confirmation acknowledgement when autolearn writes ("Got it — saved to your Robin Space"). This raises Day 7 retention more than any single feature could.

The household-core audit and adult-roles audit both name this as the single most cost-effective intervention. The adult-roles audit estimates it as ~2-3 hours of work against existing endpoints.

### 3. Push notifications have never worked for any user — including Hareesh

The `push_tokens` table is empty for every profile on the Z2. This isn't a registration failure for one user; it's that nobody has ever had a token successfully written. The morning briefing — the primary "sticky" behaviour that gives users a daily reason to open Memu — has never been delivered as a push notification to any user, ever.

The mobile app's registration code path runs at `_layout.tsx` boot. It depends on `Device.isDevice` AND notification permission granted. There is no in-app way to re-request permission, no diagnostic Settings row showing token status, no logging of registration attempts. Silent failure mode.

This is the cleanest example of the meta-pattern that triggered this audit: the slice passed tests when shipped, nobody walked through the lifecycle on a real device, and the gap survived for weeks.

### 4. Domain / project scoping doesn't exist — and gates several non-family use cases

Memu has a single context pool per profile. Visibility on Spaces (`private` / `family` / specific people) is a sharing/privacy mechanism, not an attention/domain mechanism. A founder's notes about Memu-the-product, MyDigitAlly, and the T&F day job all live in the same retrieval pool. A working parent's work meetings and family commitments mix in the same morning briefing. The co-adult partner's professional research and household admin tasks share retrieval space.

Several persona audits independently land on the same recommendation: a "context filter" UI that scopes a chat to a domain (work / family / specific project), and a retrieval layer that respects the scope. Adult-roles cluster names this as the right fix for the working-parent persona too, and the conviction cluster shows it's relevant to the multi-agent power user. It is the unbuilt architectural feature that unblocks five of sixteen personas.

### 5. The "family" framing is load-bearing but persona-exclusive

Memu's UI labels, onboarding copy, Spaces categories (person / household / commitment / routine / document), and morning briefing tone all assume a household with multiple people. For three of sixteen personas this is the right fit. For the other thirteen it ranges from mild friction (founder, professional) to outright alienation (solo individual, journalist, neighbour, job seeker).

Two specific copy-level fixes appear in multiple clusters:
- Rename "Family / Personal" toggle to "Shared / Private" — same architecture, language usable by non-family configurations.
- Make "family names" optional during setup (or replace with "names of people who'll use this" — neutral about household structure).

These are 30-minute changes that broaden the addressable persona set without any backend work.

### 6. Memory visibility is missing — autolearn fires invisibly

The product's central value proposition is "AI that learns about your life over time, privately." Autolearn is the mechanism for this. It runs silently in the background, extracts observations from every conversation, writes context_entries and Space appendages — and the user has zero visibility into what has been learned.

There is no "Memu now knows 12 things about you" view, no fact counter, no audit of what was extracted from a given conversation. The `mobile/app/memory.tsx` screen exists in the file tree (per the household-core auditor's notes) but its functional state is unverified — it may be a working memory view that partly addresses this, or a placeholder.

**Action:** verify `memory.tsx` state. If functional, surface it more prominently (Settings nav, maybe a count badge). If placeholder, build it.

---

## Hareesh — your specific calibration

You are simultaneously four of these sixteen personas: **Primary household admin**, **Founder / entrepreneur**, partner-of **Co-adult partner** (Rach), parent-of **Young child** (Robin, 7). The audit's calibration target is whether you would use Memu daily at the £2.99 / month feel-it-disappear price point, and whether Rach and Robin would too.

Read in that lens, the sixteen-persona audit collapses to a tighter priority list:

**For you** (admin + founder): the highest-leverage gaps are confabulation honesty (you don't trust answers you can't ground), domain scoping (Memu vs. T&F vs. MyDigitAlly should not bleed), and Today-screen synthesis caching (don't burn Sonnet on every tab focus). You're already getting value from autolearn and Spaces — the failure mode for you is silent inaccuracy, not absence.

**For Rach** (co-adult partner): the highest-leverage gaps are the magic-link → mobile app handshake (so she doesn't need you to walk her through setup), the privacy declaration on first open ("you're signed in as Rach, your stuff is yours"), and per-profile context isolation actually being verifiable by her (she shouldn't have to take your word that her Caddisfly research isn't in your morning briefing). She is not a self-server. If she sets up and immediately hits a 401, a blank screen, or an unmissable "Hareesh's family" greeting, she will not return.

**For Robin** (young child): the gap is total — there is no Kids Mode UI. The CLAUDE.md, architecture diagram, and PWA spec all reference Kids Mode. The codebase has no `kids/chat.tsx`, no `kids.html`. If a Founding-50 family with children is shown the docs before joining, they will be misled. Building a minimal Kids Mode (one screen, child-safe system prompt, "back to grown-ups" button) is one session.

**The product is not yet ready for non-Hareesh families.** Three of the audit's strongest signals say so: Tier 1 doesn't exist (so non-self-hosters can't try), Kids Mode doesn't exist (so families with children would be misled), push has never worked (so the morning briefing — the primary sticky — silently fails). All three of these gate the Founding-50 beta.

---

## Recommended sequencing — the next 4-5 sessions

This sequence interleaves the bug fixes from `CRITIQUE-2026-04-27.md` with the highest-value-first-build recommendations from each persona cluster. It is calibrated to your situation: you and Rach using Memu daily, Robin maybe trying it, no external Founding-50 family yet. Once these five sessions land, opening Founding-50 to non-Hareesh families becomes defensible.

### Session 1 — Foundation fixes (clean install, push, cost runaway)

The blocking bugs. Without these landed, no audit recommendation will be felt because the foundation is broken.

1. **Bug 6 — git ENOENT in Docker image.** Add git to the Dockerfile. Wrap `ensureFamilyRepo` defensively. Smoke test against an empty database. ~15 mins of work, blocks every clean install.
2. **Bug 3 — push token registration.** Diagnose why your phone has no token despite running the app for weeks. Add a Settings diagnostic row showing push status with a "retry registration" button. Send a one-off confirmation push when registration succeeds so the user *sees* it work. ~1-2 hours.
3. **Bug 4 — Today screen synthesis cache.** Cache `/api/dashboard/synthesis` for 15-30 minutes per profile. Gate the call behind a data-availability check (no calendar + no stream cards + no context entries → static onboarding prompt, no Sonnet call). ~1 hour.

Estimated: one focused session.

### Session 2 — Empty-state honesty (the meta-bug, part 1)

The single most leveraged change in the audit. After this session, Memu stops generating confident answers from emptiness. This unlocks everyone's trust in everything else.

1. **Empty-state gate on synthesis paths.** Before the briefing skill is dispatched, check if there's substantive context. If not, return a structured "no data yet — here's what to seed" response. Apply the same gate to `/api/dashboard/synthesis`.
2. **Retrieval-empty flag on chat replies.** When `interactive_query` retrieves zero relevant Spaces and zero context entries, prefix the response with a marker the UI can render distinctly. The system prompt for `interactive_query` should be updated: "If the context block is empty, say so. Never blend training-data knowledge with note-retrieved knowledge without a visible line between them."
3. **Bug 5b — header/body coherence.** Either dynamic time-aware headers ("Morning brief" / "Afternoon update" / "Evening recap") or one neutral header ("Today's brief") that doesn't clash with greeting copy in the body.

Estimated: one focused session.

### Session 3 — Onboarding seed + Day-0 confirmation

After session 2, Memu is honest about emptiness. After session 3, Memu doesn't *land* in emptiness in the first place.

1. **3-question seeded onboarding.** Inject a step in `setup.tsx` (or a fresh post-setup welcome screen): "Who else is in your household?" / "What's happening this week or what are you working on?" / "Drop a document — a school letter, a bill, a note." Each answer creates a Space or context entry via existing endpoints. No new backend.
2. **Synthetic first message from Memu.** After setup, the chat starts with a message from Memu rather than a blank input: "I'm ready. Tell me what's happening this week — I'll start building from there." Suggested-prompt chips below.
3. **Autolearn write confirmations.** When the autolearn pipeline writes to a Space, the chat reply includes a visible acknowledgement: "Got it — saved to your Robin Space." This makes the otherwise-invisible memory accumulation feel real.
4. **Privacy declaration on first open, per profile role.** A single screen for non-admin profiles (Rach, future Founding-50 members): "What you say to Memu is yours. Your conversations go to your private Spaces only. Anything you mark private stays private."

Estimated: one focused session.

### Session 4 — Memory visibility + provenance + WhatsApp routing

The trust-building session. After this, users can see what Memu knows and where its answers come from.

1. **Source citation in mobile chat replies.** The provenance infrastructure exists in `src/spaces/provenance.ts` and `recordRetrievalProvenance`. Pass it through the API response shape and render it in `chat.tsx` as a secondary line: "From: Robin Space, updated 2026-04-12." This closes the caregiver-medical-safety risk and the journalist-defensibility gap simultaneously.
2. **"What Memu knows" view.** Verify `mobile/app/memory.tsx` — if functional, promote it in Settings; if placeholder, build a minimal version showing recent autolearn observations and a fact count.
3. **Bug 1 — WhatsApp self-chat → extraction routing.** One-line change at `orchestrator.ts:330` to treat self-chat the same as group messages. Plus tests. (Now low-risk because session 2 made empty-state honest, so any extracted-but-thin self-chat content won't produce confident confabulation.)
4. **Bug 2 — `stream_cards.source` CHECK migration.** Migration extending the CHECK to include mobile / pwa / whatsapp_dm / whatsapp_self. Update `extraction.ts:46` to map channel → source via a dedicated function. Tests.
5. **Bug 5a — rename/delete `generateAndPushMorningBriefing`.** It doesn't push. Either rename to `generateBriefingText` or delete and inline-call `runUnifiedBriefing`. Update the cron's misleading WhatsApp branch.

Estimated: one focused session.

### Session 5 — Domain scoping + Kids Mode minimum + magic-link mobile handshake

The session that opens up beta. After this, Rach onboards cleanly via mobile, Robin has a screen, and the founder/multi-domain use case stops bleeding.

1. **Domain / project scoping in chat.** Add a `domain` tag to conversations and to context_entries. Add a UI scope selector at the top of chat. Retrieval respects the scope. This is the single most-cited "highest-value first build" across non-family-pure personas.
2. **Magic-link → mobile app deep-link handshake.** Add `memu://onboard?serverUrl=&apiKey=` scheme. Generate two formats from the admin invite flow (PWA link + mobile deep link). Mobile app picks up params from deep link, writes to secure storage, navigates to Today.
3. **Minimal Kids Mode chat screen.** One file (`mobile/app/kids/chat.tsx`), no tab navigation, simplified chat UI, system prompt restricting topics + age-appropriate language. "Back to grown-ups" button. Reuse the existing chat component. Backend role-gating already enforces Haiku and blocks BYOK / export.

Estimated: one focused session, possibly split into 5a (domain + magic-link) and 5b (Kids Mode).

---

## Recommendations not in the next-five-sessions list

These came up across the audit but are deferred — either because Tier 1 / Milestone C is the gating constraint, because they're small enough to slot in opportunistically, or because they expand the persona target away from the family core.

**Deferred until Tier 1 ships (Milestone C):**
- Solo individual, working knowledge-worker parent without home-server access, home-maker without Docker comfort. These three personas are entirely dependent on hosted deployment. The audit can describe their experience but they can't be reached today.

**Slot in opportunistically (small wins):**
- Rename "Family / Personal" → "Shared / Private" in chat toggle.
- Make "family names" field optional in onboarding.
- Surface DeepSeek jurisdiction in BYOK / provider configuration UI before any skill migrates to it.
- Add `MEMU_TWIN_GUARD_MODE` documentation explaining the production default of `log_and_anonymize`.
- Reduce `pino` log volume on production: don't write translated message content to stdout where `docker logs` captures it.

**Punt — out of scope for the family-AI core:**
- Job-seeker tracking (no application object type, urgency model, or career-specific Spaces).
- Student-specific deadline structuring (deadline-aware push is reusable for family use; the broader student tooling is not).
- Neighbour / community link sharing (requires `space_shares` table and unauth read route — a substantial separate feature, not a config change).
- MCP server adapter (high value to the multi-agent power user persona but tangential to the family core; ship after Founding-50 lands).

---

## What this audit does *not* cover

- **Performance and scaling.** The audit assumes single-family local performance. At Founding-50 × 2-4 adults × multiple devices, several patterns will need re-evaluation: synthesis caching strategy, the `/api/briefing/run-now` rate limiting, the privacy_ledger query performance on weeks of data. Out of scope here; needs its own audit when Tier 1 lands.
- **Security beyond the privacy story.** OWASP-style threat modelling, input validation review, session management — all out of scope. This audit only touches privacy where it is part of the felt user experience (Twin guard mode, DPoP enforcement claims, provenance citation).
- **Internationalisation, accessibility, and offline behaviour.** All out of scope. Memu is currently UK-English-only with no a11y review and online-only.
- **Pricing and commercial.** The audit grounds against £2.99 / month Founding-50 but does not evaluate the tier structure or upsell path.

---

## Status of the audit itself

| Cluster | File | State |
|---|---|---|
| Household core | [`experience-audit/household-core.md`](experience-audit/household-core.md) | Drafted 2026-04-29 |
| Adult life roles | [`experience-audit/adult-roles.md`](experience-audit/adult-roles.md) | Drafted 2026-04-29 |
| Career & growth | [`experience-audit/career-and-growth.md`](experience-audit/career-and-growth.md) | Drafted 2026-04-29 |
| Conviction & specialist | [`experience-audit/conviction-and-specialist.md`](experience-audit/conviction-and-specialist.md) | Drafted 2026-04-29 |
| Master synthesis | this file | Drafted 2026-04-29 |
| Critique (5 bugs from 2026-04-27) | [`../backlog/CRITIQUE-2026-04-27.md`](../backlog/CRITIQUE-2026-04-27.md) | Drafted 2026-04-29 |

**Pending:** Hareesh review, then Session 1 begins.

The audit is a snapshot. As code lands, claims here go out of date. When a persona's "highest-value first build" ships, strike it through here and update the persona file. The audit is not a deliverable, it's a working document for the next month of building.
