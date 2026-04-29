# Experience Audit — Adult Life Roles Cluster
**Date:** 2026-04-27
**Auditor:** Claude (claude-sonnet-4-6)
**Scope:** Four adult-life-role personas. Critique and gap-finding against current product state. Not marketing copy.

**Product state at time of audit:**
- Mobile app (Expo/React Native): personal-use ready. Screens: Today, Chat, Spaces, Lists, Calendar, Settings. Side-drawer navigation. Onboarding flow (welcome → setup → channels).
- Backend (Fastify + PostgreSQL 16 + pgvector): multi-profile with magic-link invite. Intelligence pipeline: Digital Twin (anonymisation), orchestrator, briefing (07:00 cron, London timezone), autolearn, extraction, tool-use (addToList / createSpace / updateSpace), web_search (Anthropic server-side), document ingestion, vision.
- AI providers: Claude Sonnet/Haiku (primary), Gemini Flash (routing), DeepSeek (wired, no skills migrated yet).
- Privacy Ledger: in-app, shows what was anonymised and sent to AI.
- Deployment: Tier 2 only (HP Z2 Tower, Tailscale). Tier 1 (hosted) not yet available.
- Founding-50 paid beta: not yet open. Multi-profile shipped but Z2 has not yet received all April 26 commits.
- Known open bugs: container_id 400 from Anthropic on long tool-use chains; Google Sign-In custom URI scheme on Android; push token registration reliability not confirmed for non-primary users.

---

This cluster covers adults whose primary friction is role complexity: they carry multiple identities simultaneously (worker, parent, carer, solo person) and need a tool that operates across those roles without collapsing them into each other. The unifying theme for Memu across this cluster is **context accumulation over time**. That is also where the product is most fragile right now: when context is empty, Memu is a generic chat interface with privacy theatre. When context is rich, it is a genuinely differentiated product. The audit below names exactly how wide that gap is, per persona.

---

## Persona 1: Solo Individual

### Snapshot
Priya, 31, software developer in Manchester. Lives alone in a flat. No children, no dependants. Privacy-conscious — she left Google Photos after reading about PaLM training data practices. Uses Obsidian for notes, Signal for messages, Proton for email. Has heard of self-hosting but runs nothing yet. Found Memu via a Reddit thread on r/privacy or r/selfhosted. She is technically capable enough to follow a Docker tutorial but does not want to babysit a server. She has career projects, side projects, a running habit she tracks inconsistently, and a social life that generates scheduling friction. She has no "household" in the family sense.

### Jobs to be done
- Keep track of commitments she's made verbally ("I'll review your PR by Thursday") without going back to Slack
- Get a morning summary of what matters today — meetings, deadlines, open loops — without switching between four apps
- Store personal health notes and symptom patterns privately (she does not trust health apps with this data)
- Have an AI she can think out loud with about a career decision or side project without that conversation training a corporate model
- Reduce the cognitive overhead of her running and nutrition tracking without subscribing to yet another app

### Where Memu fits
Memu's chat, Spaces, Lists, and Privacy Ledger are genuinely relevant. The Digital Twin privacy guarantee is specifically the thing Priya cares about. The morning briefing (calendar + open commitments) addresses the multi-app fragmentation. Autolearn extracts durable facts from conversations — over weeks, this builds a personal knowledge base passively. These all work for a single user. The friction is structural: the entire product surface has been designed and labelled around "family" — "Family/Personal toggle" in chat, the Household section in Settings, family domain awareness in the briefing. For Priya, this isn't wrong exactly, but it does jar. She is not a household. The "family" framing in copy and UI surfaces a product that was built for someone else.

### Day 0 — first 5 minutes
**What onboarding should reveal:** That a single adult can use this without a household. That the AI privacy promise is concrete (the Digital Twin is the only genuinely differentiating claim). That there is something to do on Day 1 beyond "chat with a blank AI."
**What it should ask for:** Name (required). What matters to you right now — one or two things. Optional: connect calendar. Optional: server URL (if self-hosting; baked-in URL path skips this for managed deployments, but Tier 1 isn't live yet, so Priya has no managed path).
**The promise it should land:** "Memu knows what you tell it. The AI never sees your name. Ask it anything."

Currently: the onboarding collects name, email, family names, and routes to a channel setup screen. "Family names" is required UI on a screen Priya is reading. There is no context-seeding question. After completing setup, she lands on Today with no events (unless she connected Google Calendar), no stream cards, and the briefing has not fired. The Masthead says "The morning is yours to shape." which lands as empty platitude against a blank screen. This is the "blank page" problem already captured in the bug log.

### Day 1 — first 24 hours
Priya types "remind me to send the invoice to Kiran by Friday." Memu creates a task in Lists (tool-use shipped: `addToList`). Good. She asks "what did I commit to this week" — Memu searches context and finds nothing except the invoice item she just added. The response is accurate but sparse. She uploads a PDF of her running plan she got from a physio. Document ingestion extracts it into a Space. She asks "what's my target heart rate for tomorrow's tempo run" — Memu retrieves from the Space and answers correctly. That is a genuine moment of value.

However: push notifications may not fire. The push token registration flow runs through Expo Push Notification API but there are known issues with token delivery for non-primary users — Priya is a new registration, not the developer's account, and this has not been verified at scale. If push does not work, the 07:00 briefing is silent. She would not know why. There is no fallback UI indicator saying "briefing failed — check Settings."

### Day 7 — end of first week
**What should have accumulated:** 5-7 conversations have been stored and indexed. Autolearn has extracted some durable facts (the Kiran invoice, the tempo run schedule, potentially something from her job if she's talked about work). The physio PDF is a Space she can query.
**The "ah, this is useful" moment:** On Thursday morning the briefing includes "Invoice to Kiran due Friday" extracted from her earlier message. That is the moment where the context accumulation becomes visible. It requires: the briefing to have been generated (calendar connected helps), the stream card to have persisted (requires `has_substantive_updates === true` from the LLM), and the autolearn fact to have been stored and retrieved. All three must work. Currently, if any one fails silently, the moment does not arrive and Priya sees a generic "No pending items" card. She has no way to know whether the system is working.

### Day 30 — would they renew Founding-50?
Possibly yes — if the physio document retrieval and the invoice reminder both worked correctly, that is a clear and private alternative to Notion + Google Assistant. But there is a real risk she churns at week 2. The product has no observable health indicators for the user ("your context has 12 facts stored," "last briefing: 7:02am today, 3 items"). Without visibility into whether the system is actually accumulating, the value proposition is invisible. She would be renewing on faith, not evidence.

### Empty-state behaviour
Today tab on Day 1: Masthead + empty events list + "No pending items." Synthesis block shows nothing. This is the product at its weakest. The correct behaviour on empty state is to prompt for context input: "Tell me three things you're working on this week" or "Drop a document or paste some notes — I'll extract what matters." Currently neither exists. The empty state is passive.

### Where Memu currently fails them
- **Framing mismatch (med):** "Family/Personal toggle" in Chat, "Household" in Settings, "family domain awareness" in briefing copy — all assume the user has a family. Priya does not. It is not a dealbreaker but it consistently signals the product was built for someone else. Severity: medium for adoption conversion; low for actual function.
- **No Tier 1 hosted option (high):** Priya will not self-host on her own hardware at £200+ to try a £2.99/month service. Tier 1 is the entire path to market for this persona. Without it, Memu is inaccessible to her until Milestone C ships. This is the single highest-severity gap.
- **No context status visibility (high):** After a week of use, the user has no idea how much context Memu holds about them, when the last briefing fired, or whether autolearn is working. The Privacy Ledger shows what was *sent to the AI*. There is no "what does Memu know about me" summary.
- **Onboarding collects family data from a solo user (med):** "Family names" field on the setup screen is confusing to someone who has no family members to add.
- **Push token reliability unverified (high):** If briefings don't arrive, the primary value proposition for day-to-day use collapses. No retry UI, no failure feedback in-app.
- **Container_id 400 on long tool chains (med):** If Priya pastes a long document and asks Memu to do several things with it, the interactive_query chain may fail mid-execution on iteration 2. The error is opaque from the user's perspective.

### Highest-value first build for this persona
**Tier 1 hosted deployment (Milestone C).** Without it, this persona cannot be reached at all. Everything else is polish on an inaccessible product.

---

## Persona 2: Home-maker / Household Ops Primary Operator

### Snapshot
Dele, 38, stays home and runs the household while his partner works full-time. Two children: Zara, 8, and Marcus, 5. Weekly household tasks include school logistics (packed lunches, kit days, reading records, two different start times), GP appointments, the weekly shop, maintenance calls, and tracking the family budget. His partner handles the income; Dele handles everything else. He is not a developer. He used Alexa briefly before the privacy stories put him off. He is on WhatsApp constantly — it is how the school communicates, how his partner updates him mid-day, and how his mother-in-law sends the children's schedules when she has them.

### Jobs to be done
- Know what is happening today across both children's school schedules without checking the school app, the calendar, and WhatsApp separately
- Get the weekly shop list out of everyone's heads and into something queryable ("did we need almond milk?")
- Track Marcus's medical appointments — he has a recurring ear issue requiring ENT follow-ups
- Handle the school newsletter PDF that arrives Friday and extract the important dates without reading it linearly
- Pass the shopping list to his partner without typing it out again

### Where Memu fits
The core loop — PDF ingestion → Space extraction → morning briefing with today's school events — is exactly right for Dele. Document ingestion (school newsletter PDF → Spaces), Lists (shopping list with `/api/lists` CRUD), Calendar integration (Google Calendar OAuth), and the morning briefing are all present. The tool-use layer means "add almond milk to the shopping list" works in conversation. The multi-profile invite means his partner can be added to the household and see shared Spaces. The value proposition for this persona is concrete and daily.

The problem is the operational gap between what the system can theoretically do and what Dele will experience on Day 1. He is not going to open a Docker terminal. He will follow whatever onboarding flow exists and expect it to work. The current onboarding flow asks for a server URL. He has no server.

### Day 0 — first 5 minutes
**What onboarding should reveal:** That he does not need to understand servers. That Memu will learn the family's routines from what he tells it. That the shopping list works from Day 1 even if nothing else does.
**What it should ask for:** Who is in the household (first names). A few recurring events ("what are your weekly fixed routines?"). Calendar connection (one tap, returns value immediately).
**The promise it should land:** "Tell Memu what's happening and it will hold it all — so you don't have to."

Currently: the onboarding asks for a server URL. Without Tier 1, Dele cannot get past Step 1. Even with a baked-in URL (which would require a pre-built APK from a distribution channel that doesn't exist yet), the onboarding has no questions about household composition or recurring routines. Context seeding is entirely manual.

### Day 1 — first 24 hours
Assume Tier 1 exists and Dele has installed the app. He taps "Get started," enters his name, connects Google Calendar (one OAuth step — this is real, it works). He types "Marcus has an ENT appointment at Bristol Children's Hospital on Thursday at 10am." Memu extracts it, creates a stream card, and adds it to calendar if he grants that permission. He drops in the school newsletter PDF. Memu extracts term dates, key events, and non-uniform days into a Space called "School — St. Giles." That Space is now queryable: "when is Zara's sports day?" returns the correct date.

But: he says "add almond milk, oat milk, and those biscuits the kids like to the shopping list" — the tool-use layer handles "almond milk" and "oat milk" precisely, but "those biscuits the kids like" is ambiguous and Memu has no prior context to resolve it. Autolearn would eventually capture "kids like Hobnobs" if he had told Memu that before. He hasn't. This is not a bug; it is the cold-start limitation. The product has no answer for it except time and input.

### Day 7 — end of first week
**What should have accumulated:** Marcus's ENT appointment in the calendar. School newsletter Spaces. Several shopping list cycles. Autolearn has extracted a few household facts from conversation (Marcus's ear issue, Zara's sports day, school run times if Dele mentioned them).
**The "ah, this is useful" moment:** Friday morning briefing: "Marcus has ENT Thursday 10am. Zara's book character day is next Wednesday — costume needed. Shopping list has 8 items." If that fires correctly, Dele will not churn. That is the product working.

The risk is that "costume needed" requires Memu to have either been told or to have extracted it from the newsletter PDF. Extraction from PDFs is real (document ingestion is shipped) but the quality of extraction is LLM-dependent and untested at this persona's usage pattern. If the newsletter uses unusual formatting or the extraction skill does not flag "non-uniform day, costume required," that item will not appear in the briefing. There is currently no way for Dele to audit what was extracted from the PDF beyond looking at the Space body manually.

### Day 30 — would they renew Founding-50?
Yes, conditional on the briefing working reliably and Tier 1 existing. The shopping list alone is worth £2.99/month if it reduces the "did you add X?" back-and-forth. The PDF extraction of school newsletters is a genuine time save. The risk is the "magic but opaque" problem: when it works, he doesn't know why; when it fails, he doesn't know why either. A month of unexplained failures would kill retention.

### Empty-state behaviour
Day 1 empty state: the Today screen shows a friendly masthead and nothing else. For Dele this is actively confusing because he came expecting the app to help him organise the household. The first tap should be something actionable — "Tell me about your week" or a prompted form: "Who is in your household / what school do your children go to / what recurring events should I know about?" This does not exist. The empty state is a chasm between the promise and the reality.

### Where Memu currently fails them
- **No Tier 1 (critical):** Dele will not run a home server. Without hosted deployment, this persona is blocked completely.
- **No context-seeding onboarding (high):** The onboarding collects a name and that is it. On Day 1, Memu knows nothing. The briefing on Day 2 will be generic. For a persona whose entire value proposition is "holds the family's routines," a blank state is a product failure.
- **PDF extraction quality is unaudited (med):** School newsletters are the most common document this persona would import. Newsletter PDFs have inconsistent formatting. The extraction quality is LLM-dependent and there is no user-facing audit of "what was extracted from this document."
- **No shared list access without invite flow (med):** Dele's partner can be added via the magic-link invite, but the invite flow is admin-only and requires the PWA on a desktop — the mobile Settings → Household screen is not the entry point for this. The partner's path to seeing the shopping list has friction.
- **Morning briefing is single-timezone (low):** The briefing cron is hardcoded to Europe/London. For UK families this is fine. Worth noting it is not configurable.
- **Briefing time not adjustable per user (med):** 07:00 is baked into the cron. Dele does the school run at 8:15, and a 7am briefing is right. But there is no per-profile setting. The settings screen has a `briefingTime` preference that is stored via `loadPrefs/setBriefingTime` — this exists in the UI — but whether it actually shifts the cron fire time or merely stores a preference without affecting the 07:00 cron has not been verified.

### Highest-value first build for this persona
**Structured context-seeding onboarding (3 questions: who is in your household / what school / what are the weekly anchors).** Even without Tier 1, this is the fix that turns Day 1 from "blank page" into "working product." It does not require new backend capability — it is three prompted inputs that call `/api/seed` and `/api/spaces` (which already exist). This is a 2-3 hour build that removes the biggest Day 1 churn driver across the entire adult-roles cluster.

---

## Persona 3: Working Parent with Knowledge Work

### Snapshot
Tanvir, 42, Senior Product Manager at a SaaS company in London. Working from home three days a week. Partner is Amara; children are Imani, 10, and Kofi, 7. His calendar is dominated by product reviews, sprint meetings, stakeholder calls, and OKR planning sessions. Family time is from 5:30pm. Between 9am and 5:30pm he is in work mode. The seam — 5pm to 7pm — is where the worlds collide: school pickup, homework, dinner, and also the Slack message he needs to reply to before tomorrow morning. He has tried multiple productivity apps and abandoned them all. He wants a tool that handles the transition, not one more thing to manage.

### Jobs to be done
- Know what is on the family calendar tonight without context-switching out of work mode at 3pm
- Capture a family commitment ("Kofi's class assembly Tuesday 2pm — I need to be there") without it ending up in his work Slack or work calendar
- Get a 5:30pm brief that is domestic — what's for dinner, what the kids need for tomorrow — without it mixing with his work threads
- Have a space to think out loud about a product decision privately, without it polluting the family AI's context or appearing in the family briefing
- Track that the boiler service is overdue and the vet appointment for the dog needs rescheduling, without either getting lost in email

### Where Memu fits
Tanvir is the persona Memu is most concretely designed for — and also the one where the work/life boundary problem is most acute. The Chat screen's Family/Personal visibility toggle is directly relevant: messages tagged "personal" stay out of the family feed. Spaces can be private or family-visible. The morning briefing draws on calendar and stream cards, not work Slack. If the Digital Twin anonymises his messages before Claude processes them, he gets AI assistance without his employer's data leaking.

But the work-context isolation problem is deeper than the visibility toggle covers. Tanvir will want to ask "what are my key deliverables this week" — meaning work deliverables, not family ones. If he does this in Memu, those work facts get stored in his persona's context and may surface in briefings or synthesis. There is no explicit "work mode" flag on context entries. The autolearn skill extracts "durable facts" from every conversation — a conversation about the Q3 roadmap could deposit work project details into Memu's context store, and the next morning's briefing might reference them alongside "Kofi's assembly Tuesday." That is not a failure — it is exactly the seam Tanvir lives in — but there is no current mechanism to say "this conversation is work-context-only, exclude from family briefings."

### Day 0 — first 5 minutes
**What onboarding should reveal:** The work/life boundary capability. Specifically: that the Personal visibility toggle keeps work thoughts out of family Spaces, and that the AI never names him to the AI (the Twin).
**What it should ask for:** The household composition (for shared family context). Whether he wants to connect his work calendar separately from his personal/family calendar. (Currently: one Google Calendar OAuth connection, which presumably brings in work meetings unless he uses a separate account.)
**The promise it should land:** "Work and family in the same app, never leaking into each other."

Currently: onboarding does not explain the Family/Personal toggle. It does not mention that Spaces can be private. The calendar OAuth connects one Google account and does not distinguish work from personal. If Tanvir's work meetings appear in the family briefing, that is an immediate failure of the core promise.

### Day 1 — first 24 hours
Tanvir connects his personal Google Calendar (family events). His work calendar lives in a separate Google account — there is no multi-calendar support currently. So the briefing sees only what is on the personal calendar. He mentions "I need to be at Kofi's class assembly Tuesday 2pm" in chat. Memu extracts it as a stream card and adds it to his calendar (if granted). At 07:00 Wednesday the briefing includes "Kofi's assembly Tuesday 2pm." That works. 

At 4pm he opens the chat and thinks out loud about a product decision: "I'm trying to decide whether to cut the reporting feature from the Q2 scope — the engineering estimate came in at 6 weeks and we've got 4." He tags this as Personal visibility. Autolearn extracts: "User is weighing a 6-week vs 4-week feature scope decision." That goes into context_entries. It will not appear in a family briefing (the briefing draws on stream_cards and calendar, not context_entries directly). So the practical bleed risk is lower than feared — but it is still in the context store and will surface if Tanvir asks a question that triggers retrieval. The boundary is more porous than the UI implies.

### Day 7 — end of first week
**What should have accumulated:** Family calendar events. Kofi's assembly. The boiler service note (if he mentioned it). His dog's vet appointment (if mentioned). Work context entries that are separate from family Spaces.
**The "ah, this is useful" moment:** The 5:30pm brief (if this existed as a separate briefing mode) that says: "Tonight: Imani has reading, Kofi needs PE kit tomorrow. Boiler service still overdue — you mentioned it Monday." Currently there is only one briefing cron at 07:00. A 5:30pm family transition brief does not exist. The Today tab is refreshed on focus, so he can open it manually, but the morning briefing card from 7am is stale. There is no second daily brief. This is a significant gap for the working-parent use case.

### Day 30 — would they renew Founding-50?
Probably yes if the morning briefing works and the chat is genuinely useful for capturing family logistics. But Tanvir will have noticed: (a) his work meetings appear in the briefing unless he uses a separate calendar account; (b) there is no 5:30pm brief; (c) the Family/Personal toggle exists but its actual effect on what the AI knows about him is not clearly documented or visible. The Privacy Ledger shows what was sent to the AI, not what is stored. He will have moderate confidence the product is useful, and real uncertainty about whether it is doing what it claims.

### Empty-state behaviour
Tanvir starts with Google Calendar connected, so the Today screen is not blank — it has events. The empty-state problem is different here: stream cards are empty (he hasn't had things extracted yet), and the synthesis block is blank. The Masthead text is generic. For this persona, the useful prompt is "What's on your plate this week — work, family, anything?" to seed context for the first briefing.

### Where Memu currently fails them
- **Single Google Calendar OAuth (high):** Tanvir almost certainly has separate work and personal Google accounts. There is one OAuth slot. He must choose. If he connects work, family events are missing. If he connects personal, work meetings are missing. A working parent needs both. Multi-calendar support is absent.
- **No second daily brief (high):** The entire "seam between work and family" use case requires a transition brief around 5–5:30pm. Currently there is one 07:00 briefing cron. No per-profile configurable second brief time. This is the highest-impact feature gap for this persona.
- **Work context bleeds into personal context store (med):** The Family/Personal visibility toggle in chat affects Space visibility and message routing. It does not create a separate context_entries namespace. A conversation about a work deadline deposits facts into the same vector store that feeds the morning briefing's context retrieval. The boundary is softer than it appears.
- **No Tier 1 (critical):** Same as above — this persona can use the hosted path (eventually) but is blocked until Milestone C.
- **Onboarding does not explain the toggle (med):** The Family/Personal chat visibility toggle is the key differentiating UX claim for this persona. It is not mentioned during onboarding, not explained in any empty-state, and requires discovery.

### Highest-value first build for this persona
**An optional second daily briefing at a configurable time (e.g., 5:00–6:00pm), covering "family mode only" — calendar events for the evening, open household Spaces, pending lists items.** The Settings screen already stores `briefingTime` as a preference. Extending this to a second configurable slot would directly serve the work/home transition. Backend: one additional cron job (or a per-profile scheduled task lookup). Mobile: one extra Settings row. This closes the most concrete gap for this persona in roughly one session.

---

## Persona 4: Caregiver of Aging Parent (Sandwich Generation)

### Snapshot
Kezia, 47, secondary school teacher in Bristol. Children: twins Asha and Dev, 14. Mother — Nita, 74 — lives 20 minutes away. Nita is sharp but has Type 2 diabetes, recently had a TIA, and needs help coordinating her healthcare. Nita's GP is at Stapleton Road Surgery. Her cardiologist is at Frenchay Hospital. She is on seven medications. Kezia coordinates with her brother Rajan in Leeds who is emotionally present but physically absent. Kezia is also managing Asha's GCSE coursework deadlines and Dev's rugby schedule. Her own life gets whatever is left.

### Jobs to be done
- Know when Nita's next cardiology appointment is and what the last one said, without hunting through email
- Track Nita's medication changes — the GP changes dosages without telling Kezia, and she finds out when she collects the repeat prescription
- Keep Rajan informed without writing a long message every week — a shared update they can both query
- Hold Asha's GCSE deadlines in the same system as Nita's appointments so nothing falls through
- Process the discharge summary from Nita's last TIA admission — it is a PDF, it is 14 pages, it references three medications by generic name

### Where Memu fits
This is the persona where Memu's core architecture — document ingestion, Spaces, Digital Twin anonymisation, shared household access — most exactly matches a real and painful problem. The 14-page discharge summary PDF goes into document ingestion → a Space called "Nita — Medical" → queryable by "what did the consultant say about aspirin dosage." Multi-profile means Rajan can be added to the household and query the same Space. The weekly briefing synthesis would pull Nita's next appointment into the morning brief. This is the scenario where Memu's context-over-time value prop is clearest.

The product gap is that almost none of this works end-to-end today without significant setup friction, and the demographic that needs it most (Kezia, who is exhausted and time-poor) will not absorb setup friction.

### Day 0 — first 5 minutes
**What onboarding should reveal:** That documents can be imported and queried. That multiple people (Rajan) can be added. That the AI knows nothing about anyone and needs to be told — or fed documents.
**What it should ask for:** Who is in the care situation (names, roles). Any immediately relevant documents (medication lists, appointment letters). Whether there is a second person who needs access.
**The promise it should land:** "Drop in Nita's discharge summary. Ask me what's in it. Add Rajan. I'll keep both of you on the same page."

Currently: the onboarding says "Ask anything" and "Stay on top of your day." These are the right promises for Hareesh building a personal Chief of Staff. For Kezia they are too vague and do not signal that the product can hold medical documents, multiple people, and long-term care coordination. The onboarding is persona-blind.

### Day 1 — first 24 hours
Kezia drops in Nita's TIA discharge summary (PDF, 14 pages). Document ingestion runs pdf-parse, extracts text, passes through Twin (Nita becomes "Person-2" or similar anonymous label), extraction skill fires, a Space "Medical — Nita" is created with the consultant's key points. She asks "what medications did they change?" Memu retrieves from the Space and responds with the relevant section. That works, and it is a genuine moment of value that no general AI gives her (those don't persist the document to a queryable store).

She then asks Memu to "remind me when Nita's next cardiology appointment is." The appointment is in the discharge summary as "follow-up in 8 weeks from 14 March." Memu needs to: (a) calculate the date (8 weeks from March 14 = May 9); (b) create a reminder or calendar event. Whether it does (a) correctly depends on the LLM reasoning. Whether it does (b) depends on calendar OAuth being connected and the interactive_query tool-use chain completing without a container_id 400 error. This is three dependent steps, any of which can fail. There is no confirmation feedback in the mobile UI if the calendar event creation fails partway through a tool chain.

Adding Rajan: Kezia goes to Settings → Household → Add household member. She generates a magic link. She pastes it to Rajan in WhatsApp. He clicks it on his phone, it opens in a browser, he lands on the PWA dashboard (not the app — the link goes to the web PWA). He would need to separately install the app and sign in, or use the PWA. The mobile app is the primary surface but the invite flow drops him at the web. This is a friction point for a non-technical sibling in Leeds.

### Day 7 — end of first week
**What should have accumulated:** Nita's medical Space with discharge summary content. The cardiology follow-up date (if the calendar chain worked). Asha and Dev's school events if Kezia mentioned them. Autolearn has started building a profile of Nita's care situation.
**The "ah, this is useful" moment:** Morning briefing Friday includes "Nita cardiology appointment May 9" and "Asha's History coursework submission deadline is May 2." Kezia did not have to enter these manually; they came from documents and conversation. If this fires correctly, this is the product at its best.

But: medication tracking is a specific gap. Kezia's key JTBD is tracking dosage changes over time. The discharge summary has the drugs listed. Future GP letters will have updates. Each one is a separate document. Memu's Spaces model (autolearn appends observations, synthesis_update merges content) would accumulate medication information over time — but there is no structured medication tracker. There is no "compare what the last letter said vs this one" capability. The information is in Spaces as prose, not as a structured record. Querying "has the metformin dose changed since the last letter?" requires the LLM to reason over two imported documents, which is theoretically possible but has not been tested at this complexity.

### Day 30 — would they renew Founding-50?
Probably yes, if the medical Space retrieval worked and the morning briefing included Nita's appointments. The use case is high enough stakes that Kezia will tolerate more friction than a casual user. But she will have noted the absence of: structured medication tracking, a clear way to share updates with Rajan that does not require him to install another app, and any proactive alert ("Nita's follow-up appointment is in 3 days — you haven't confirmed attendance").

### Empty-state behaviour
For this persona, empty state is particularly dangerous. If Memu has no context about Nita's care situation and Kezia asks "what medications is Nita on?" — Memu will say it does not know, or worse, confabulate from general medical knowledge. The current orchestrator behaviour when context is empty is to pass the question to the LLM with an empty context block. The LLM (Claude) will respond from training data, not from Nita's actual records. The Privacy Ledger will show the translation, but Kezia will not know whether the answer came from her documents or from Claude's general knowledge. This is the highest-risk failure mode in the cluster: plausible but wrong medical information surfaced as if it were retrieved from a personal document.

This is not hypothetical. Until documents are uploaded and facts are extracted, every question about Nita's care returns general AI output. There is no UI distinction between "retrieved from your Spaces" and "generated from training data." The citation infrastructure (`source_references` on Spaces, `recordRetrievalProvenance`) exists in the backend but it is not surfaced in the mobile chat UI.

### Where Memu currently fails them
- **No source citation in mobile chat (critical):** When Memu answers a health-related question, Kezia has no indication whether the answer came from the discharge summary she uploaded or from Claude's general training. This is not merely a UX gap; for medical information, unsourced AI output is actively unsafe. The provenance infrastructure exists in `src/spaces/provenance.ts` but is not surfaced in `chat.tsx`. Severity: critical for this persona.
- **Invite flow lands at PWA, not app (high):** Rajan receives a magic link. It opens in a browser on his phone. He sees the PWA dashboard. To use the mobile app, he needs to separately download it and sign in with the API key (or re-paste the URL into the app). The link should deep-link to the mobile app or at minimum make the PWA experience first-class for a household member who will never self-host.
- **No structured medication tracking (med):** The caregiving use case specifically requires tracking changes over time across multiple documents. Memu's Spaces model accumulates prose, not structured records. There is no way to ask "how has the aspirin dose changed over the last 3 months" without the LLM reasoning over multiple documents, which it may do incorrectly.
- **No proactive alerts without calendar hook (med):** "Nita's cardiology appointment is in 3 days" only appears if the appointment made it into Google Calendar. If it is only in a Space, it will not proactively surface. Stream card creation from Space content is not automatic.
- **Confabulation risk on empty context (critical):** Until documents are loaded, every factual question returns LLM-generated output that may appear authoritative. For health information, this is a liability and a trust destroyer if Kezia acts on wrong information.
- **No Tier 1 (critical):** Same as every other persona — not applicable until Milestone C.

### Highest-value first build for this persona
**Source citation in mobile chat responses.** When Memu answers using retrieved Space content, the response should include a line like "From: Nita — Medical (imported 2026-04-27)." The backend already records this via `recordRetrievalProvenance`. It needs to be passed through to the mobile response and rendered in `chat.tsx` as a secondary line below the message bubble. This closes the highest-severity risk (confabulation appearing as document retrieval) and is the single trust-building feature missing from the chat surface. Estimated effort: one session — wire the provenance data through the API response shape and render it in the chat message component.

---

## Cross-cutting observations within this cluster

**1. Tier 1 hosted deployment gates the entire cluster.** Every persona except a technically confident DIY-homelab user is blocked until Milestone C ships. This audit can describe ideal experiences but they are theoretical for three of four personas today. The product exists as a demo for family adoption; it does not yet exist as a consumer product.

**2. The empty-state → cold-start problem is the same across all four personas.** Day 1 Memu knows nothing, the Today screen is blank or nearly blank, and there is no guided path to giving Memu context. The fix — a 3-question context-seeding onboarding — is a 2-3 hour build against existing endpoints. It would raise Day 7 retention across all four personas more than any single new feature.

**3. Source citation is missing from the mobile chat.** The backend records provenance. The mobile chat does not render it. For Persona 1 and 3 this is a trust gap. For Persona 4 (caregiver), it is a safety risk. This is underweighted in the current backlog.

**4. The briefing-as-primary-value-delivery mechanism is fragile.** It depends on: push token registration working (unverified for new users), the LLM returning `has_substantive_updates: true`, the cron firing (hardcoded London timezone), and calendar data being available. Any one failure produces a silent miss. There is no "briefing health" indicator for the user.

**5. The "family" framing is load-bearing but persona-exclusive.** The product's language, UI labels, and onboarding are built around a household with children. Personas 1 and 3 (solo user, working parent) experience mild but consistent friction from this framing. The Chat visibility toggle is the right architectural answer; it needs to be explained earlier and more clearly. Consider renaming "Family/Personal" to "Shared/Private" to make it usable by non-family households.
