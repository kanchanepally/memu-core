# Household Core — UX Experience Audit

**Cluster:** Household Core
**Audit date:** 2026-04-27
**Codebase state:** memu-core as of commit `04620da` (multi-profile shipped), not yet deployed to Z2. Z2 runs the pre-Littlebird-PWA, pre-DeepSeek, pre-multi-profile build. The mobile app exists under `mobile/` but the `/mobile/app/(tabs)/` file tree has no Kids Mode screen.

This cluster covers the four people who form a typical household using Memu. Their experiences are interdependent: if the admin can't invite the partner, the partner never exists. If there's no Kids Mode surface, the children's personas are role-gated API entries with no UI. Each persona's gaps compound.

---

## Persona 1: Primary household admin

### Snapshot

Technical-leaning adult, mid-30s to mid-40s. Runs two or three domains simultaneously: a demanding job, a household, side projects. Information arrives from every direction — email, calendar invites, WhatsApp threads, school newsletters forwarded by a partner. His working memory is constantly overloaded; the problem isn't that he lacks information, it's that he lacks a system that assembles it. He is probably a parent of at least one child under 12. He got interested in Memu because he saw the phrase "private AI that learns your family" and recognised the problem immediately. He is comfortable with Docker, not afraid of a command line, but has been burned by self-hosted projects that became maintenance work. He wants something that runs itself.

### Jobs to be done

- Know what is actually happening this week — not a raw calendar list, a synthesised picture: Robin's dentist is Thursday morning, the council tax direct debit lands Friday, Rach is away overnight Wednesday.
- Get the school's PDF letter (term dates, inset days) into a system that surfaces it before the relevant date, not after he's already booked something conflicting.
- Have a place to put a shopping list that doesn't live in a WhatsApp thread or a Notes app that only he reads.
- Keep family context private — not on Meta's servers, not fed into a general AI training set.
- Invite his partner to join without giving her his account.

### Where Memu fits

Memu fits this persona better than any other in the cluster. The morning briefing (7:00 cron, push-delivered), stream card extraction from chat, document ingestion (PDF school letters), shopping list, calendar integration, and Spaces all target exactly his jobs. The Privacy Ledger addresses his stated concern about AI training. Multi-profile onboarding (shipped 2026-04-26, not yet deployed) means he can now invite Rach. The fit is genuine but the execution has several sharp edges that would stop a second Hareesh from reaching Day 7.

### Day 0 — first 5 minutes

**What onboarding should reveal:** What Memu does in concrete terms — not "intelligence without surveillance" (that's a slogan) but "you'll get a briefing at 7am that synthesises your calendar and anything you've told me. You can ask me anything. I'll remember your family and never send your real names to any AI."

**What it should ask for:** Name, optionally email, Google Calendar OAuth (non-blocking if skipped), a brief statement of who is in the household. Three questions, not twenty.

**The promise it should land:** "I know nothing about you yet. Everything I learn comes from you. Here's how to start: tell me one thing that's happening this week."

### Day 1 — first 24 hours

He downloads the APK (or builds from EAS). The `welcome.tsx` → `setup.tsx` onboarding flow exists. It covers server connection and name, but currently asks nothing about household composition, no AI orientation questions, and gives no prompt to seed initial context. The result is a blank Today screen and a chat box with no starting point. He types something — say, "This week: Robin's dentist Thursday 10am, school inset day Friday, Rach arrives back from conference Saturday." The message goes through the pipeline. Novel entity detection picks up "Robin" and "Rach." Autolearn extracts facts. A Space for Robin may be created. But there is no visible confirmation any of this happened. The reply is just a conversational acknowledgement. He has no way to see whether the system learned anything without navigating to Spaces manually.

If he connects Google Calendar, the `isCalendarConnected` flag flips on the Today screen and his next API call to `/api/dashboard/brief` returns events. Good. If he does not connect calendar, the Today screen's event section shows nothing, which is correct — but there is no prompt encouraging him to connect.

The 7:00 briefing will not fire tonight (it runs at 7am tomorrow). He has no signal that it is coming. There is no "your first briefing will arrive tomorrow morning at 7am" confirmation anywhere in the onboarding path.

Push token registration IS wired in `_layout.tsx` and fires on app boot. But it requires `Device.isDevice` (simulator returns null) and requires notification permission granted. If he taps "Don't allow" on the notification prompt (common on first install), push tokens never register, and the morning briefing never arrives. There is no recovery path — no re-prompt, no in-settings button to re-request permission.

### Day 7 — end of first week

**What should have accumulated:** Several conversation turns. Autolearn should have produced dated bullets in Spaces for Robin, Rach, and household commitments. If he uploaded any PDFs (school letters, bills), those become document Spaces. Shopping list should have items added either by chat ("add oat milk") or manually. Calendar events visible if connected.

**The "ah, this is useful" moment:** Should be the first morning briefing that mentions an imminent event he had forgotten — "Robin's dentist is tomorrow at 10am, and you have that 9:30 call, those overlap" — and does so without him having to ask. That is the "ah" moment. Whether it happens depends entirely on whether push tokens registered, calendar connected, and whether he had told Memu about the dentist appointment (either by chat or via calendar sync). Three independent failure points before the "ah" lands.

### Day 30 — would they renew Founding-50?

Yes, if the briefing fired reliably in the first week and one of the suggested actions (add-to-list, add-calendar-event) worked as a one-tap action. The £2.99/month ask is low enough that the bar is "does this save me one missed appointment or one forgotten item a month." That threshold is achievable if the system ran cleanly. If push never registered or the briefing ran on empty data and said "you have a quiet day, enjoy" three days in a row, he would not renew.

### Empty-state behaviour

This is one of Memu's worst current failure modes. When there is no calendar data, no stream cards, and no inbox messages, `runUnifiedBriefing` passes "No new messages." and "No events in the next 48h." to the briefing skill. The skill is instructed to set `has_substantive_updates: false` in that case — good, it won't create a card. But `generateProactiveSynthesis` (which is just `runUnifiedBriefing` with `channel='app'`) is called on every focus of the Today tab. On empty data it runs a full Sonnet call and either returns null or a hollow briefing. The Today screen either shows nothing (correct) or shows a synthesis AI Insight Card that says something like "You have a quiet day — enjoy the calm." That sentence is generated by Sonnet from empty inputs. It sounds like confabulation because it is.

**Proposed alternative:** Gate `generateProactiveSynthesis` behind a data-availability check. If calendar is not connected AND no stream cards exist AND no context_entries exist, return a static onboarding prompt: "Connect your calendar or tell me about your week to get started." No LLM call. No invented calm.

### Where Memu currently fails them

1. **No seed-context onboarding prompt** (high). After setup.tsx completes, the user faces a blank chat. No "start here" message, no suggested first input. The system cannot learn anything until he types something. He may not know what to type. First session ends without Memu learning anything useful.

2. **Push token recovery path missing** (high). If notification permission is denied at first launch, there is no way to re-request it from within the app. The Settings screen has a "Run briefing now" button (which calls `/api/briefing/run-now`) but this is in-app only — it does not fix the push delivery path. The morning briefing, which is the primary "sticky" hook, silently never arrives.

3. **`generateProactiveSynthesis` fires a Sonnet call on every Today tab focus** (medium). `loadSynthesis()` is called inside `useFocusEffect` with no cache, no debounce, no data-check gate. Every time he navigates to the Today tab — 5-10 times per day — a Sonnet briefing call fires. On a quiet day this costs ~£0.02 per focus. Over a month for an active user, this alone exceeds the £2.99 subscription price. This is not theoretical — it is burning Anthropic credits on tab-switch events.

4. **Calendar OAuth breaks on docker restart** (high, operational). As documented in the first-use bug log: `.env` changes do not survive `docker restart`; requires `docker compose down && up -d`. The stale `GOOGLE_REDIRECT_URI` issue means any admin who runs maintenance operations loses their calendar connection silently. No user-visible warning.

5. **No confirmation that Memu learned anything** (medium). After seeding context through chat, there is no visible acknowledgement ("I've saved that to your Robin Space"). The user has to navigate to Spaces manually and inspect. For a first-time user, the system feels like a chat that forgets.

6. **Magic link contains API key in URL** (low-medium). Documented as "acceptable for in-household invites." But if he copies the link from the PWA and pastes it into a WhatsApp message, it appears in WhatsApp's link preview, sits in message history, and may be snapshotted by WhatsApp's servers — the exact threat model Memu is designed to protect against. For a privacy-first product this is an uncomfortable position.

7. **git binary missing in Docker container breaks new family Space init** (high, operational). `ensureFamilyRepo` calls `git init` without checking if git is on PATH. On the rebuilt API container it is missing. Any new family (i.e., every Founding-50 invitee who is not Hareesh) will hit this on their first Space write. Captured in INBOX.md but blocking multi-family deployment.

### Highest-value first build for this persona

**Onboarding seed prompt + context-confirmation message.** When onboarding completes (setup.tsx → main app), send a synthetic first message from Memu: "I'm ready. Tell me who's in your household and what's happening this week — I'll start building context from there." Then, when the first user message produces autolearn output, reply with a visible confirmation: "Got it — I've saved that to [Robin / your household] so I'll remember it." This single change turns the blank-chat problem into a first-session success. It does not require new backend work. It makes every subsequent feature (briefing, Spaces, extraction) land on top of context that actually exists rather than empty data.

---

## Persona 2: Co-adult partner

### Snapshot

British woman, mid-30s to early-40s. Academic or professional, high agency, not technically inexperienced but did not choose to run a home server. Has a phone, uses WhatsApp, and is perfectly capable of using a new app — but her tolerance for setup friction is low because she has her own cognitive load. Cares about her privacy in a specific, concrete way: she does not want her work research (grant applications, fieldwork data, professional contacts) visible to the same AI system her partner uses for family logistics. She has been told by the admin that Memu protects her data. She wants to believe that. She will verify it by checking whether it actually acts that way.

Her entry point to Memu is a magic link — a URL with an API key in it, sent by the admin via WhatsApp or Signal. She taps it on her phone. This is the moment that must work.

### Jobs to be done

- Have a private space for her own work context — Caddisfly research, grant deadlines, fieldwork schedule — that the admin's briefing cannot see.
- Coordinate shared family logistics (school pickups, weekly shop, household calendar) without those things being mixed into her professional AI.
- See what Memu actually knows about her and be able to correct or delete it.
- Not have to learn how Memu works to start using it.
- Know that her data is not being used to train anything.

### Where Memu fits

The fit here is real but currently conditional on the demo going well. Per-profile context isolation exists architecturally — each profile has its own `profile_id`, its own entity registry entries (using the per-profile suffix from 2026-04-26), and Space visibility can be set to `private`. The Privacy Ledger shows her what Claude received. The BYOK-key system means her interactions can route through her own API key if she wants. The "Rach" onboarding materials (`walkthrough-rach.md`, `briefing-rach.md`) suggest pre-seeded Spaces around her actual work.

The problem is that this persona's experience is entirely dependent on the admin having:
1. Deployed the latest code (multi-profile is not on Z2 yet as of 2026-04-27).
2. Correctly seeded context for her before she joins.
3. Sent the magic link through a private channel (not WhatsApp with link preview).
4. Walked her through first use rather than dropping a link.

There is no independent onboarding path for the partner. She opens the magic link, lands at the dashboard, and faces the same blank state as Persona 1 — except she has even less context about why she's there or what to type.

### Day 0 — first 5 minutes

**What onboarding should reveal:** That her profile is separate. That what she types goes to her spaces, not Hareesh's. That she can see the Privacy Ledger to verify. That there are pre-seeded Spaces about her work waiting.

**What it should ask for:** Nothing mandatory — she should land signed in. Optionally: "Want to add anything about what you're working on right now?" with a suggested prompt.

**The promise it should land:** "This is your space. Hareesh sees family stuff. You control what you share and what stays private."

### Day 1 — first 24 hours

She taps the magic link on her phone. The PWA `index.html` picks up the query params, writes `serverUrl` and `apiKey` to localStorage, scrubs the URL via `history.replaceState`, and redirects to dashboard. This is a web flow, not a native app install. She may not have the mobile app at all — she's on the PWA.

She sees the PWA dashboard. There is no profile-aware greeting: the dashboard does not say "Welcome, Rach" or confirm whose profile this is. If the admin pre-seeded Caddisfly Spaces before inviting her (per the `walkthrough-rach.md` script), they will appear in the Spaces list. If not, blank state.

She tries the chat. Types "When's my next grant review?" Memu has no context for this. The `interactive_query` skill fires, retrieves from Spaces (empty for her) and embedding context (empty for her), and answers with something polite but empty. The Digital Twin runs — correctly — but she has no way to see that it is working unless she opens the Privacy Ledger. The Ledger link exists in the PWA but is not prominent.

Critically: she is using the mobile app. The mobile app's onboarding flow (`welcome.tsx` → `setup.tsx`) requires manually entering a server URL and API key. The magic link is a PWA-only mechanism. If she wants to use the native mobile app, the admin must copy the server URL and API key out of the magic link and send them separately, or she must type them manually from the PWA settings page. There is no "open in app" handshake for the mobile app.

### Day 7 — end of first week

**What should have accumulated:** If she used the chat at all, autolearn will have extracted some professional context from her inputs (Caddisfly grant review, fieldwork location if she mentioned it). These land in her Spaces. If the admin sent her a PDF (school schedule, a household bill), document ingestion creates a document Space. Shopping list is shared (family visibility) so she can see items the admin added.

**The "ah, this is useful" moment:** She asks "What's on the shopping list?" and gets back the items Hareesh added, including the veg stock. She adds "tahini" from her phone. Hareesh sees it on his next briefing. That cross-profile, shared list moment is the "ah" for this persona. It requires: (1) both profiles connected to the same backend, (2) shopping list working (it does, per bug-3 fix), (3) family visibility set on the list (it is, by default).

### Day 30 — would they renew Founding-50?

Probably not on her own initiative, because she is not the primary subscriber. The renewal decision is the admin's. But if asked "is this worth £2.99 a month for the household?" her answer determines whether the admin renews. She will say yes if: the shared list worked reliably and reduced one WhatsApp thread. She will say no if: she felt her work context was not private, or she got a morning briefing that mentioned something she had not shared with the household AI, or she could not get the mobile app set up.

### Empty-state behaviour

Her empty state is worse than the admin's because she has no incentive to seed context — she did not build this system. When she opens the PWA and sees a blank spaces list and a chat box, the natural interpretation is "this isn't working yet." Memu should detect a new profile with no context and surface a specific, practical starting prompt: "I don't know anything about you yet. To get started, tell me what you're working on right now — I'll keep it private to you." The word "private" matters here and should appear immediately.

### Where Memu currently fails them

1. **No mobile app magic-link handshake** (high). The magic link is a PWA-only flow. Getting her onto the native mobile app requires a separate manual step (copy server URL + API key). For a non-technical partner, this is a drop-off point. She either uses the PWA only (limited notification support) or asks the admin to walk her through it, which creates friction at the moment of first impression.

2. **No per-profile greeting or profile confirmation on first open** (high). Nothing on the PWA dashboard or the mobile app confirms whose profile this is. She cannot tell at a glance that she is logged into her own separate profile rather than the admin's. For someone explicitly trusting the "your data is separate" promise, the absence of this signal is trust-eroding.

3. **No privacy confirmation on first open** (high). The primary reason she is using Memu is privacy. The first screen she sees after landing from the magic link should confirm: "You're signed in as Rach. Your conversations and spaces are private to you unless you choose to share." This sentence does not exist anywhere in the current first-run experience.

4. **Twin entity collision risk on shared household** (medium). The entity registry now uses per-profile suffixes (e.g., `Adult-<id-slice>`) rather than literal `Adult-0`. This was fixed in 2026-04-26. But if both profiles refer to "Robin" and both register him, they create separate entity entries. The shared Space for Robin may diverge between profiles, with neither profile seeing the other's autolearn writes. The cross-profile Space sharing model is not fully specified or tested in the current build.

5. **No way to audit what the admin can see about her** (medium). She can see her own Privacy Ledger. She cannot see whether any of her data appears in the admin's briefings. Architecturally it should not (per-profile isolation), but she has no way to verify this herself. The Privacy Ledger is personal — not a family-level audit of who sees what.

6. **Cron briefing is profile-aware but she has no calendar** (low-medium). The 7:00 cron fires for all adults with push tokens. If she registered a push token (which requires downloading the native app and granting permissions — see gap 1) she will get a morning briefing. But she has not connected Google Calendar. The briefing will be generated from an empty calendar, empty inbox (WhatsApp ingestion is self-only by default), and whatever she seeded in chat. On Day 1-6 this produces hollow or no briefings. She will interpret this as the system not working.

### Highest-value first build for this persona

**Magic link → mobile app handshake.** Add a deep-link scheme (`memu://onboard?serverUrl=&apiKey=`) to the Expo app config. When the admin generates a magic link (from PWA Settings → Household → Add member), offer two formats: PWA link (current) and mobile deep link (new). The mobile deep link writes server URL and API key to secure storage and navigates to the Today tab, bypassing manual entry. This collapses a multi-step process that currently requires the admin's help into a single tap. Without this, the co-adult partner using the native app (which is Memu's primary channel) has no independent onboarding path.

---

## Persona 3: Young child (5–9)

### Snapshot

Seven years old. Uses a tablet or a parent's phone. Can read basic sentences, type slowly but independently, likely uses voice in preference to typing if available. Has been told by a parent that this is "the family computer helper." Wants to know: can I ask it things? Will it be funny? Does it get angry if I ask something silly? Has no concept of privacy and no interest in the product vision. Interacts in short bursts — five minutes before school, ten minutes on a car journey. Will abandon immediately if the first response is confusing, adult-toned, or slow.

### Jobs to be done

- Ask questions at a 7-year-old level and get answers that feel like talking to a helpful, patient adult rather than a corporate AI.
- Add things to the shopping list ("we need more Coco Pops").
- See "what's happening today" in terms a child understands — not "domain health: amber."
- Not be exposed to adult household information (the parent-teacher consultation notes, the mortgage renewal reminders, the relationship-adjacent chat history).
- Not be tracked, gamified, or have their curiosity about topics logged in a way that feels surveillance-adjacent.

### Where Memu fits

Weakly. The current build has the architectural scaffolding for child profiles — role-gated API responses (Claude Haiku for `role === 'child'`, document upload blocked at 403, BYOK config blocked, export blocked, briefings blocked) — but has no UI surface at all for this persona. The `mobile/app/` directory has no kids mode screen. The PWA has no `kids.html` (the `src/dashboard/public/` directory does not exist in the filesystem as checked). The CLAUDE.md architecture diagram references `kids/chat.tsx` and `src/dashboard/public/kids.html` but neither file exists in the actual codebase. The child role is enforced on the backend but the frontend has nothing to show a child.

If a child were somehow given access (via a magic link that the admin created with `role: 'child'`), they would open the same PWA or mobile app as the admin, see the same Today / Chat / Lists / Calendar / Spaces / Settings tabs, and interact with a Haiku-powered chat that is otherwise identical in UI to the adult experience. The domain health headers, stream cards about mortgage renewals, and Privacy Ledger entries would all be visible.

### Day 0 — first 5 minutes

**What onboarding should reveal:** A different, age-appropriate entry point. "Hi Robin! I'm Memu. I can answer questions, help with homework, and add things to the shopping list. What do you want to ask?"

**What it should ask for:** Nothing. A child should not be asked to configure anything.

**The promise it should land:** "Ask me anything. I won't share what you say with anyone unless you want me to." (Age-appropriate privacy.)

Currently: none of this exists. There is no child-facing onboarding.

### Day 1 — first 24 hours

Memu currently has nothing for this persona at Day 1. The architecture says Kids Mode uses Haiku and restricts certain APIs. In practice, if Robin somehow has a profile, he opens the same UI as his father, sees the morning briefing about domain health and calendar collisions, and either asks a question that gets a Haiku-generated response (functionally correct but with no child-oriented framing) or gets confused and stops using it.

The shopping list addition via chat ("add Coco Pops to the shopping list") would work — `handleListCommand` in the orchestrator intercepts "add X to shopping" phrasings deterministically and does not go through the LLM. So that one job would succeed. Everything else fails.

### Day 7 — end of first week

**What should have accumulated:** Nothing. There is no Kids Mode, so no child-specific context accumulation path exists. The autolearn skill would fire on any chat turns and write observations to Spaces, but those observations would go to the admin's family namespace. A child's private conversations should not be writing to family Spaces that the admin reads in briefings.

**The "ah, this is useful" moment:** Does not exist in the current product for this persona. Theoretically it would be: Robin asks "who invented the lightbulb?" and gets a clear, short, age-appropriate answer. Then a few days later his dad's briefing mentions nothing about what Robin asked, confirming the privacy promise. But that chain requires Kids Mode UI (absent), per-profile Space isolation for children (untested), and a child-safe response style (Haiku is not automatically child-safe — it is just cheaper and faster).

### Day 30 — would they renew Founding-50?

This question is not meaningful for this persona. A 7-year-old does not decide subscription renewals. The question is whether Memu adds value to this child's experience such that the admin cites "Robin uses it too" as a retention reason. Currently: no. There is no child-facing surface.

### Empty-state behaviour

No Kids Mode means no state to be empty in a child-relevant way. If one were built, the empty state should be: "What do you want to know? You can ask me about animals, space, homework, or add things to the shopping list." Short. Concrete examples. No adult infrastructure language.

### Where Memu currently fails them

1. **Kids Mode UI does not exist** (high). The architecture diagram, CLAUDE.md, and pricing copy all reference Kids Mode as a feature. The codebase has no `kids/chat.tsx`, no `kids.html`, no child-facing screen of any kind in the mobile app. This is an architectural promise without implementation. Severity: high because if a child profile is created (via admin invite with `role: 'child'`), they see the full adult UI with adult content.

2. **No content filtering at the LLM response level** (high). Child profiles route to Haiku. Haiku is not a content-safety filter. It will answer "what is sex?" or "what are drugs?" if asked. There is no system-prompt instruction in any SKILL.md to adopt child-safe response norms, refuse sensitive topics, or redirect to a parent. The `interactive_query/SKILL.md` v6 has no child-mode clause.

3. **No per-child private Space namespace** (medium). Child autolearn observations would write to family Spaces visible in the admin's briefing. A child's curiosity about a topic (searched via chat) should not appear in their parent's morning briefing. The visibility model for child-generated content is unspecified.

4. **Shopping list add is the only working job for this persona** (medium). The `handleListCommand` fast path in the orchestrator works correctly for "add X to the shopping list" from any profile including children. This is accidentally the most functional thing Memu does for a 7-year-old, and it works not because of kids mode but because of a deterministic string matcher.

5. **Voice input not implemented** (high for this age group). A 7-year-old will not type well. Voice dictation is bug #5 in the first-use list — not yet built. Without voice, this persona's interaction mode is slow and frustrating.

### Highest-value first build for this persona

**A minimal Kids Mode chat screen.** A single-route screen (`mobile/app/kids/chat.tsx`) with three things: (1) a simplified chat UI with no tab navigation, no stream cards, no domain health, (2) the chat routed through a child-safe system prompt appended to `interactive_query/SKILL.md` that restricts sensitive topics, uses age-appropriate language, and always responds in 1-3 short sentences, (3) a "back to grown-ups" button that navigates to the family Today screen. No custom design needed — reuse the existing chat component. This single screen, added in one session, converts a persona with zero current product fit into a persona with a real (if minimal) use case. Everything else (voice, per-child Spaces, parental controls) builds on top.

---

## Persona 4: Teenager (13–17)

### Snapshot

Thirteen to seventeen years old. Probably on TikTok, Snapchat, possibly Discord. Has a smartphone and uses it as their primary computing device. Has strong feelings about surveillance: hates being tracked, resents parental oversight, but simultaneously wants help with things (homework, schedules, "what should I make for lunch"). Their relationship with Memu will be adversarial unless Memu explicitly acknowledges their autonomy. If they feel Memu is a parental monitoring tool, they will refuse to use it or use it to test its limits ("tell me how to get out of curfew"). If they feel Memu gives them their own private assistant that happens to live at home, they might actually engage.

### Jobs to be done

- Get help with homework without the whole household seeing what they asked.
- Know their schedule without asking a parent (when's the dentist, when does school break up, when is the family trip they've been told about).
- Add things to the shopping list and have it actually work.
- Not have every conversation they have with the AI fed back to their parents in a morning briefing.
- Have their own Space for personal notes that nobody else can read.

### Where Memu fits

Weakly, but the fit is better than for the young child. The architectural building blocks are present: per-profile isolation, Space visibility (including `private` setting), BYOK (blocked for children, but a 16-year-old on an `adult` role would have it). The problem is positioning and trust, not just features. A teenager's question about Memu is "does my dad see what I ask?" — and the current onboarding says nothing about this.

There is also a role ambiguity: should a 15-year-old be a `child` profile or an `adult` profile? The system has only those two roles. A `child` profile blocks BYOK, export, document upload, briefings, and family settings. A 15-year-old might reasonably want briefings and document uploads (school PDFs). An `adult` profile has full access. There is no `teen` role. This is an uncovered design gap.

### Day 0 — first 5 minutes

**What onboarding should reveal:** Explicitly: "This is your profile. What you type here goes to your Spaces, not your parents'. You can set any Space to private." Also: what Memu can help with in terms a teenager actually cares about — homework, schedules, reminders, personal notes.

**What it should ask for:** Nothing. Or optionally: "What subject do you need help with most?" (low-stakes, familiar).

**The promise it should land:** "I'm yours. Ask me anything. Your parents won't see it unless you choose to share."

Currently: same onboarding as the admin. No differentiation, no privacy promise, no teenager-oriented framing.

### Day 1 — first 24 hours

If they got a magic link and landed on the PWA, they see a blank dashboard. They may type a question — "what's mitosis?" — and get a correct Haiku response (assuming child role). The Haiku model answer will be shorter than Sonnet but likely fine for this use case. No chat history visible to parents (correct, per profile isolation). They may try to add something to the shopping list — works. They will not look at the Privacy Ledger. They will not create Spaces. They will check tomorrow whether the shopping list item is still there.

The morning briefing is blocked for `child` profiles. So no push notification will arrive. For a teenager this may be fine — they probably turned off notifications anyway. But it also means no proactive touch from Memu, which for this persona might mean out of sight, out of mind.

### Day 7 — end of first week

**What should have accumulated:** If they used chat (they may not have, given the blank-state problem), some autolearn observations in their private Spaces. The shopping list has items. Calendar is not connected — they probably have a school calendar that is not Google Calendar.

**The "ah, this is useful" moment:** They ask "when's the family trip to Edinburgh?" and Memu answers correctly because the admin's family calendar or household Space contains that information, and it is family-visibility by default. The teenager got useful information without asking a parent. That is the specific value of a household AI versus a personal one — access to shared context without the social friction of asking. But this requires: (1) the admin has actually put that information in Memu, (2) the teenager's profile can read family-visibility Spaces, (3) the retrieval system surfaces the Edinburgh Space when asked. Step 3 is the most uncertain — the retrieval is embedding-based and depends on semantic similarity. "Family trip to Edinburgh" may or may not match a Space titled "Summer 2026 holiday."

### Day 30 — would they renew Founding-50?

No. They are not the subscriber. The question for this persona is: do they use Memu often enough that the admin cites "the kids use it too" as a renewal justification? Currently: unlikely. There is no distinctive value proposition for a teenager that differentiates Memu from just opening ChatGPT. The privacy angle does not resonate with this age group — they already have iMessage, WhatsApp, and TikTok. The household-context angle (knowing the family schedule) is real but requires the admin to have built that context, which is not guaranteed in the first 30 days.

### Empty-state behaviour

A teenager who opens a blank Memu for the first time and sees no content will close it and not return. The empty state needs to be active. For this persona: "You haven't told me anything yet — but I have access to the family's shared information. Try asking: 'What's happening this weekend?' or 'When do I have the dentist?'" This uses shared context without implying surveillance. It shows capability rather than asking them to provide data.

### Where Memu currently fails them

1. **No teen role — only child or adult** (medium). A 15-year-old with a `child` role loses document upload, export, and briefings. A 15-year-old with an `adult` role gets full access but is exposed to family settings controls. Neither is right. The binary is fine for under-10s and over-18s; it breaks for the 13-17 range.

2. **No explicit privacy framing for the teenager** (high). The first question this persona will have is "does my dad see what I ask?" Memu does not answer this anywhere in the current onboarding flow. Without a clear answer, the teenager assumes the worst (surveillance) and either refuses to use it or uses it adversarially.

3. **Shared calendar is adult-connected (Google Calendar via OAuth)** (medium). The teenager likely does not have a Google Calendar or will not connect one. Their schedule lives in their school's app, their phone's stock calendar, or nowhere structured. There is no mechanism for them to get relevant schedule information from Memu unless the admin has added it. The "family trip to Edinburgh" scenario only works if the admin put Edinburgh in the system.

4. **No school-specific context ingestion path** (low-medium). School PDF documents (term dates, timetables, event letters) arrive physically or by email and are not in any digital calendar. The document ingestion feature (PDF upload → Space) exists and works for adults. A teenager should also be able to upload "my timetable for next term" and have Memu answer "when's your geography exam?" In theory, a `child` role blocks document uploads (403). For a teenager who should have this capability, the role-based block is wrong.

5. **Stream cards and domain health are visible to child profiles** (medium). The Today screen shows stream cards regardless of role. If the admin's briefing produced a card about "renewal reminder: household insurance" or "Rach returns from conference Saturday" — these show up on a teenager's Today screen because the query `SELECT * FROM stream_cards WHERE family_id = $1` does not filter by visibility or card audience. A child's Today screen should show only family-visibility cards relevant to their age.

6. **Voice input not implemented** (medium for this persona). Less critical than for a 7-year-old but still: a teenager is more likely to voice-dictate from their phone than type in an app. Bug #5 remains open.

### Highest-value first build for this persona

**Privacy declaration on first open, per profile role.** A single screen injected into the post-onboarding experience for non-admin profiles: "What you say to Memu is yours. [list 2 bullet points: 'Your conversations go to your private Spaces only' and 'Anything you mark private stays private — no one else in the household sees it']. You can check this in the Privacy Ledger any time." No code change to the backend. No new API. One new screen (or a component added to the existing onboarding `channels.tsx`). This single change addresses the primary trust barrier for both the co-adult partner (Persona 2) and the teenager (Persona 4), and it does so accurately — the system actually works this way. The promise is true. It just needs to be stated.

---

## Cross-cutting observations within this cluster

**The shared empty-state failure.** All four personas encounter Memu before it has learned anything about them. There is no seeded context, no guided first interaction, and no visible feedback that the system is learning. The architecture handles learning through autolearn (fires post-chat) and document ingestion (explicit upload) — but neither is triggered by the onboarding flow. Every persona's Day 1 experience starts with a blank chat that may or may not confirm it understood what was typed. This is the single most consistent failure across the cluster.

**Push token registration is fragile for all adults.** The 7:00 cron briefing — the primary "sticky" behaviour that gives adults a daily reason to open the app — depends on push token registration succeeding at first launch. One "Don't allow" tap on the notification permission prompt silently breaks morning briefings for that profile, with no recovery path. This affects Persona 1 and Persona 2 equally.

**The role binary (child / adult) does not map to the household reality.** Real households have 7-year-olds, 15-year-olds, partners, and administrators — all with meaningfully different access requirements. The current two-role system produces correct behaviour at the extremes (young child, admin) but is wrong for the co-adult partner who needs isolation without restriction, and for the teenager who needs partial access. A `teen` role or configurable per-profile capability flags would address this without a schema overhaul.

**Kids Mode is the largest documented-but-unbuilt feature in the product.** The CLAUDE.md, architecture diagram, PWA spec, and file structure comments all reference Kids Mode as if it exists. It does not. Three file references (`mobile/app/kids/chat.tsx`, `src/dashboard/public/kids.html`, `dashboard.html`) do not exist in the filesystem. If a prospective Founding-50 family with children is shown the product documentation before joining, they will be misled about the product's actual current state.

**The `generateProactiveSynthesis` cost problem compounds across users.** When the product scales to 20 Founding-50 families, each with 1-2 adults, each opening the Today tab 5-10 times per day, the per-focus Sonnet call in `loadSynthesis()` becomes a significant and unpredictable cost line. This is not a future problem — it is a current problem that will worsen linearly with user count. Fixing it (cache the synthesis for N minutes, or gate it behind a data-availability check) should precede inviting any beta family.
