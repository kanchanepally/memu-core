# Memu UX Audit — Career & Growth Persona Cluster

**Audited against:** Memu Core as-shipped to 2026-04-27. Capability baseline drawn from `memu-core/CLAUDE.md` Current State (last substantive update 2026-04-26 evening), corroborated by `src/intelligence/orchestrator.ts`, `mobile/app/` file tree, and session memory files.

**A note on honest framing for this cluster.** Memu's stated purpose is family digital infrastructure: private chat, shared calendar, photos, and a family AI that learns household context over time. Every design decision in the product — the Digital Twin's anonymisation labels ("Adult-1", "Child-2"), the Spaces categories (person / routine / household / commitment / document), the briefing model, the multi-profile invite flow, the morning greeting copy ("Morning, friend — Tuesday 27 April") — assumes a household with multiple people and shared context as the generative use case.

Three of the four personas in this cluster are individual-career users who do not have a household to run through Memu. One (founder/entrepreneur) is a partial fit, because Hareesh himself is in this persona and actively uses Memu as his own Chief of Staff. That is useful data. But it is a sample of one, and it bends the product to an individual-use shape that was never the product's primary design intent. The audit is honest about where this bending helps, where it reveals real gaps, and where the product simply does not reach.

---

## Persona 1: Founder / Entrepreneur (Multi-Venture)

### Snapshot

Works 1-3 concurrent ventures alongside a day job, or has gone full-time on a portfolio of projects. Hareesh is the template: Director at Taylor & Francis by day, building Memu and MyDigitAlly by night, with a personal brand (hareesh.co) threading through. Calendar is fragmented across five Google Calendars and two email accounts. Has a content pipeline — newsletter drafts, LinkedIn posts, blog posts in various states — and a product decision stream that is never fully resolved. Gets 30 minutes to think and needs that 30 minutes to surface the right question, not spend it recalling context that was in Slack three weeks ago.

### Jobs to be done

- Retrieve context across a project without having to remember where it was stored: "What was the open question from the Founding-50 pricing session last Tuesday?"
- Get a morning brief that includes both the day job calendar and the venture task list, not one or the other.
- Capture a decision or a fragment — "we're going with £2.99, not £3.99, because of SEIS optics" — and have it surface the next time it is relevant.
- Draft a short communication (email to a collaborator, reply to a LinkedIn message) from within the tool, with the relevant context already loaded.
- Ask a general AI question — "what's the going rate for a seed-stage technical cofounder equity split in the UK" — without switching apps, without that query going to a cloud provider as a named person.

### Where Memu fits

This is the strongest fit in the cluster, but it is a narrow fit and it depends entirely on context having been seeded. Memu has the right primitives: Spaces (structured knowledge cards), the AI that queries them, Claude tool-use that can create and update Spaces mid-conversation, autolearn that extracts facts from every exchange, morning briefings that can pull from calendar and context, and a Digital Twin so sensitive business queries stay anonymised from the cloud AI. The `interactive_query` skill with its tool-use loop (`createSpace`, `updateSpace`, `addToList`) plus synthesis retrieval is genuinely useful for this persona once data is in the system. The problem is the setup cost: everything above depends on context having accumulated first, and the onboarding does nothing to accelerate that for a solo user with no household. The product was designed for a family of four to naturally generate context through shared use; a single founder has to manually seed it or wait for autolearn to accumulate over weeks of chat.

### Day 0 — first 5 minutes

**What onboarding should reveal:** "You have a private AI that knows your projects, because you told it about them. Here is how to give it context fast."

**What it should ask for:** Name (done), email (done), and — critically absent — "What are you working on? What matters most this week?" Even a free-text box that seeds one Space per project would dramatically change the Day 1 experience. The current setup screen asks for name, email, and family names. For a solo founder, "family names" is either blank or a weird prompt.

**The promise it should land:** "Memu knows your Memu-the-product work, your MyDigitAlly newsletter, and your T&F program. Ask it anything across all three." It currently cannot land this promise because the Spaces are empty.

### Day 1 — first 24 hours

Hareesh opens the app on a Monday morning. The Today screen renders the masthead — "Morning, Hareesh — Monday 27 April. The morning is yours to shape." — and then shows either empty briefing cards or whatever stream cards got extracted from conversations since install. If he has connected Google Calendar, today's T&F standup and a school pickup are visible. If not, nothing is there.

He types into chat: "What's the status of the Founding-50 beta?" Memu has no Spaces with this content. The retrieval path finds zero relevant embeddings. The `interactive_query` skill fires against an empty context block. Claude produces a generic reply: "I don't have notes on that yet — would you like to create a Space for Founding-50?" This is technically correct behaviour and the tool-use path can then create the Space. But the experience is: the AI I was told knows my projects does not know my projects. For a founder with high standards, this is a near-exit moment.

If he pushes past it and starts using chat to capture decisions — "we decided to price at £2.99 for Founding-50, locked for life, to anchor SEIS psychology" — autolearn will extract that as a durable fact and route it to a matching Space (if one exists) or to context_entries (if not). By the end of a working day with 10-15 AI interactions, there is a thin layer of accumulated context. Not enough to feel like a knowledgeable assistant, but enough to start feeling like a notetaker.

### Day 7 — end of first week

**What should have accumulated:** Autolearn has been firing on every conversation. If Hareesh has had daily interactions across all three projects, there are 50-100 context_entries, some routed to Spaces. Morning briefings are pulling from calendar (if connected). The chat history gives Claude 10 message pairs of rolling context per conversation. If he used the Spaces tab to manually create project Spaces for T&F / Memu / MyDigitAlly in the first session, the retrieval system is now usefully pre-loaded.

**The "ah, this is useful" moment:** He asks "what were the open questions from the Memu pricing conversation" and the reply actually surfaces the £2.99 / SEIS note from Day 1. That is the moment. Cross-session recall on a business decision is something no general AI provides without manual copy-paste. If Memu delivers this, the persona stays.

The risk: this moment may not happen at Day 7 if context seeding was low or if the embedding retrieval does not surface the right entry. There is no feedback mechanism that tells him whether the AI found relevant context or confabulated from nothing.

### Day 30 — would they renew Founding-50?

Conditional yes, but the condition is specific: they have to have had the "ah, it remembered" moment at least twice in the first two weeks. If the context accumulation worked and the morning briefing is genuinely pulling from both calendar and accumulated venture context, the £2.99 price point is trivially worth it. The friction points that could prevent renewal: no work/personal separation (T&F queries bleed into Memu founder context in the same chat thread), no way to scope a chat conversation to one project at a time (the "Projects/Spaces" isolation feature is on the roadmap but not shipped), and confabulation from empty state early on creating a trust deficit that never fully heals.

### Empty-state behaviour

Currently: the Today screen shows the time-of-day masthead and empty or near-empty stream card sections. The chat screen is a blank Gifted Chat interface. The Spaces screen shows an empty list with a "New Space" button. There is no coaching, no seed prompts, no "start here" guidance. The first interaction is entirely self-directed. For a sophisticated founder this is less fatal than for a student or job seeker, but it is still a cold start.

### Where Memu currently fails them

1. **No project / domain scoping in chat** (severity: high). All conversations go into one undifferentiated thread per profile. A Memu-founder query and a T&F AI programme query produce context entries in the same pool. Retrieval will serve both when either is queried. This is the "Projects/Spaces" isolation feature Hareesh himself flagged in April 2026 — it is not built.
2. **No seeding accelerator at onboarding** (severity: high). The setup screen collects name, email, and family names. For a solo founder, it should offer a "what are you working on?" seed that pre-creates two or three project Spaces and writes an initial context entry. The first meaningful interaction is currently 10+ manual messages away.
3. **Confabulation from empty context is invisible** (severity: high). When the context block is empty, Claude generates plausible-sounding answers with no flag that they come from zero evidence. The Privacy Ledger shows what was sent but does not surface "no relevant context found." A founder making decisions based on AI recall needs to know when the AI is drawing from memory versus fabricating.
4. **Morning briefing does not distinguish venture work from day-job** (severity: medium). The briefing pulls from a single calendar (Google Calendar, if connected) and accumulated context. There is no way to tell it "show me only Memu-related context in the morning briefing."
5. **Draft communication skill not yet shipped** (severity: medium). `proactive_check` and `draft_communication` are listed as Tier 1 skill cluster at 2/4 shipped. A founder who wants to draft a reply to a collaborator based on accumulated context cannot do this without hand-writing the full prompt with context.
6. **Conversation history cap at 10 message pairs** (severity: low-medium). Across a long working session, 10 pairs covers roughly 30 minutes. Older context in the same conversation falls off the window, requiring the user to re-state facts they already gave.

### Highest-value first build for this persona

Domain/project scoping in chat. Even a simple "context filter" UI that lets the user select which Spaces are active for the current conversation would transform this persona's daily use. Without it, Memu is one general AI chat thread with background embeddings — useful, but not the differentiated multi-project Chief of Staff it aspires to be.

---

## Persona 2: Job Seeker (Career Transition)

### Snapshot

Actively applying for roles, possibly between jobs or about to leave. Currently tracking 12 live applications across 4 companies, including a final-round video interview for the Senior Product Manager role at Octopus Energy on Thursday at 11am with hiring manager Priya Shah, and a first-call scheduled with a recruiter at Monzo for Friday 2pm. Has prep notes per company spread across a Google Doc, three browser tabs, and a Notes app. Under emotional load — the Octopus rejection last month still stings. Privacy-conscious: current employer at a consultancy should not see any of this. Device is a personal phone, not a work one.

### Jobs to be done

- Track the state of each application: company, role, stage, next action, deadline.
- Store prep notes per company: "Octopus Energy — they care about Agile transformation, read the sustainability report, interviewer background is ops not tech."
- Set a reminder: "interview Thursday 11am, prep the night before."
- Debrief after an interview: "Octopus interview done — felt strong on the strategic questions, weak on the data/metrics section."
- Get help drafting a follow-up email without it being sent to a cloud AI that indexes it under the user's name.

### Where Memu fits

**Weak fit. This persona is not who Memu's current product is for.** The product has no first-class concept of "applications" or "job tracking." There are no structured fields for company, role, stage, contact, deadline. Memu's Spaces categories are person / routine / household / commitment / document — none of which map cleanly onto a job application. The closest approximation is: create a manual Space per company (category: commitment or document), type prep notes into the body, and use chat to surface them. That is a workaround, not a product. The AI will answer general interview prep questions — "what are good questions to ask at the end of an interview?" — but that is commodity AI, not a differentiated use of Memu.

The Privacy Ledger and Digital Twin are genuinely relevant to this persona: a job seeker has strong reasons not to want their application data going to cloud AI with their name attached. The anonymisation of "Hareesh Kanchanepally applying to Octopus Energy" into "Adult-1 applying to Company-3" before the Claude API call is a real and differentiating privacy property. But the benefit only lands if the rest of the product serves the use case, and it does not.

Memu also has no concept of time-boxed urgency. A job seeker lives in a state of "this closes Friday, that interview is Thursday." The calendar view pulls from Google Calendar (if connected), but there is no way to flag a stream card or a Space as time-sensitive without it being in the calendar.

### Day 0 — first 5 minutes

**What onboarding should reveal:** "Memu can be your private research assistant for anything you don't want cloud AI to see under your real name." It can't credibly promise job-specific functionality, because there isn't any.

**What it should ask for:** Name and email. The "family names" field is actively confusing — this person does not have a family unit to add.

**The promise it should land:** "Ask me anything about your job search and I'll keep it private." That's a real promise. But it's a generic AI privacy pitch, not a job-search tool pitch.

### Day 1 — first 24 hours

She opens the app, completes setup (name, email, skips family names), lands on the Today screen. There is no briefing because nothing has been added to calendar, no morning push registered (push token registration issues were noted in bug list), and no context has been accumulated. She types in chat: "I have an interview at Octopus Energy on Thursday. Help me prepare." Memu has no Octopus Space, no notes about the company, no prior context. Claude — properly anonymised through the Digital Twin — will give a reasonable generic interview prep response. Useful, but nothing Memu-specific.

She might then ask Memu to store a note: "Remember that my interview at Octopus Energy is Thursday at 11am and the hiring manager is Priya Shah." The autolearn pipeline will extract this as a fact, write it to context_entries with an embedding, and potentially create or update a commitment Space. On the next interaction, a query about the Octopus interview will surface the note. That is functional. But she has to know to explicitly tell Memu things rather than expecting any structure.

### Day 7 — end of first week

**What should have accumulated:** A handful of manually-created or autolearn-generated context entries about companies and roles. If she has been chattier — using Memu like a journal or prep partner — the embedding pool is thicker. Morning briefings are still empty unless she connected Google Calendar and added the interview there.

**The "ah, this is useful" moment:** She asks "what did I note about Octopus Energy?" and the Space or context entry surfaces Priya Shah's name and the sustainability report note. That is a genuine win. But it requires both (a) that she stored the note in the first place, and (b) that the embedding retrieval hit on "Octopus" in the context block. If either fails, the moment doesn't happen.

### Day 30 — would they renew Founding-50?

Probably not at current product. For £2.99/month there are better-tailored job-search tools. Memu's value proposition for this persona is entirely "private AI that won't index your application under your name" — and while that is a real differentiator, it is not a compelling enough product story to replace a dedicated tool. If the person is also a household-manager with family context to manage, they might keep Memu for the family use case and use something else for job search. But a pure job-seeker persona, evaluating Memu on its own merits, will not renew.

### Empty-state behaviour

Empty Today screen, empty Spaces, empty chat. No prompts specific to job search. There is no onboarding path that would make Memu useful to this persona quickly.

### Where Memu currently fails them

1. **No job-application object type** (severity: critical for persona). There is no structured way to track company / role / stage / next action / deadline. Everything has to be prose in a Space body, which means the AI has to parse it back out on retrieval.
2. **No urgency or deadline surfacing** (severity: high). Stream cards with deadlines are extracted from text (e.g., "interview Thursday 11am"), but there is no automatic "you have a time-sensitive event approaching" proactive push.
3. **Push tokens not reliably registering** (severity: high). The first-use bug list notes push token registration issues. If the Thursday interview reminder does not fire, the product has failed its most basic task-management promise to this persona.
4. **Family-centric copy and structure is alienating** (severity: medium). "Family names" in setup, household-oriented Spaces categories, and family-AI positioning in onboarding all signal "this is not for you alone."
5. **No Google Sign-In on Android** (severity: medium). The first-use bug list notes the Android OAuth bug (custom URI scheme not enabled). An Android-first job seeker cannot connect Google Calendar without manual OAuth, blocking the one integration that might make Memu useful for deadline tracking.

### Highest-value first build for this persona

Punt. The job-seeker persona is not who Memu is for at this product stage. The audit value is in confirming this explicitly: building job-application tracking, urgency-based push, or career-specific Spaces categories would be a significant scope expansion away from the family AI core use case. The resource cost to serve this persona well would delay the Founding-50 beta for the family persona it was designed for. Do not build for this persona until the family use case is proven.

---

## Persona 3: Student (University or Upskilling)

### Snapshot

Second-year computer science student, Warwick. Has a dissertation chapter due Thursday 5pm (COMP30040 networks module), a study group session Wednesday 7pm with three flatmates, a part-time job at Deliveroo three evenings a week, and a stack of unread lecture recordings going back two weeks. Lives with flatmates, not family. May share a Memu instance with flatmates as a household-of-choice, or may be using a family-of-origin Memu instance on their parents' hardware. Deeply budget-sensitive: £2.99/month is meaningful, not trivial. Probably uses ChatGPT or similar already. Will not pay for privacy they don't fully understand.

### Jobs to be done

- Manage deadline pressure: COMP30040 due Thursday, COMP30021 coursework feedback due Monday, research proposal due in three weeks.
- Summarise a document or lecture recording: "Extract the key points from this 60-page networking textbook chapter."
- Study with an AI that doesn't judge or over-complicate: "Explain TCP congestion control to me like I know Java but not networks."
- Capture a note mid-session: "The dissertation argument is: home network latency variance is correlated with social isolation in remote-working households."
- Maybe: shared shopping list and bill-splitting with flatmates.

### Where Memu fits

**Weak-to-partial fit, depending heavily on the deployment scenario.** If the student is living with their family of origin and the household already runs Memu, then they inherit the family instance — the shopping lists, shared calendar, and household context are a free benefit. The AI's ability to summarise documents and answer domain questions is real and present. The document ingestion skill (shipped as of April 2026, with PDF parsing via `pdf-parse`) means uploading the COMP30040 textbook chapter and asking "extract key points" is a genuine capability. Vision extraction (photos of handwritten notes) is also shipped.

But if the student is evaluating Memu as a standalone product — "should I pay £2.99/month for this instead of or alongside ChatGPT?" — the answer is no. Memu's differentiators are privacy via Digital Twin, family context accumulation, and hardware-optional private deployment. None of these are primary concerns for a 20-year-old student. The privacy pitch requires understanding the Digital Twin's design, which is not surfaced in onboarding in a way that lands for a non-privacy-oriented user. The family context accumulation is irrelevant if they are the only user. The hardware angle is beyond their budget and motivation.

The flatmate-household scenario is the most interesting edge case: five students sharing a Memu instance would get shared lists, shared calendar, and a household AI. Multi-profile is now shipped (as of 2026-04-26), so this is technically possible. But the product positioning, pricing, and onboarding do not address this scenario at all.

### Day 0 — first 5 minutes

**What onboarding should reveal:** For an inherited family Memu, they join via magic-link invite, authenticate, and are in. The onboarding is a single tap. Clean. The privacy promise ("Intelligence without surveillance") is on the welcome screen. If their parents set it up, it may already have some household context seeded.

For a standalone student setup: Enter server URL (this person has no server — they're using Tier 1 hosted), name, email, skip family names. The empty state hits immediately.

**What it should ask for:** For a student persona specifically: "What matters most this week?" or "Drop a document or a deadline." Neither exists.

**The promise it should land:** "Ask me anything, private, no ads, no training on your queries." That is coherent and might land for a privacy-aware CS student.

### Day 1 — first 24 hours

He uploads the COMP30040 networking chapter PDF via the document attach button. The document ingestion pipeline fires: `pdf-parse` extracts the text, the Twin anonymises named entities, the extraction skill creates stream cards, synthesis writes a document Space with a structured summary. He asks "what's the key argument in section 3?" and the Spaces retrieval surfaces the summary. This works. This is the most functional Day 1 experience in the cluster, because it requires no prior context — the document is the context.

He asks Memu to explain TCP congestion control. The `interactive_query` skill fires. No relevant Spaces (the document Space from this session may match, depending on retrieval). Claude gives a competent explanation. The Digital Twin is not particularly relevant here because there are no personal entities in a technical question. But the response quality is the same as ChatGPT, at a higher price. He notices this.

He tries to add the dissertation deadline: "Remind me that COMP30040 is due Thursday 5pm." Autolearn extracts this as a durable fact. But push notifications may not be registered (known bug), so the reminder may never fire. He gets a text confirmation from the AI but no proactive push on Thursday morning.

### Day 7 — end of first week

**What should have accumulated:** Context entries from daily chat sessions. The COMP30040 document Space. Perhaps a dissertation-argument Space if he said "remember this: my dissertation argument is X." Study group session in calendar if he connected Google Calendar and entered it there.

**The "ah, this is useful" moment:** He asks "what's my dissertation argument again?" and it surfaces the note from Day 1 accurately. This is the same retrieval moment as Persona 1. It works if the context was stored. The specific student version is document recall: "what did section 3 of the networking chapter say about slow start?" If the document Space was summarised well, this surfaces the right passage. If the summarisation was lossy, it does not.

### Day 30 — would they renew Founding-50?

No, if evaluating on solo student use. The document QA feature is the only strong differentiator, and students have free alternatives (ChatGPT file upload, Claude.ai with project memory). The privacy angle requires understanding that is not surfaced in the product. £2.99/month is not trivial.

Conditional yes if they are in a household Memu with flatmates or family — in that case they are paying £2.99 for shared infrastructure they are already using. But the student is unlikely to be the one paying; that's the household admin.

### Empty-state behaviour

Empty Today screen. Empty Spaces. Chat is available immediately. The document upload button in chat is the clearest "start here" affordance for this persona. If Day 0 had a prompt — "Drop a document and I'll summarise it for you" — it would create an immediate win instead of a blank canvas.

### Where Memu currently fails them

1. **No deadline / coursework object type** (severity: high for this persona). Deadlines are extracted by autolearn as unstructured context_entries. There is no "due date" field, no countdown, no proactive push on approach. A student's primary organisational need is deadline management.
2. **Push notification reliability is unknown post bug-list** (severity: high). If the Thursday 5pm deadline reminder does not fire, the product failed its most important job.
3. **Family-centric framing throughout** (severity: medium). "Family names," household-category Spaces, morning greeting copy ("morning is yours to shape") — none of this is wrong, but it signals "this is for parents" not "this is for you."
4. **Privacy pitch requires sophistication to land** (severity: medium). The Digital Twin is a genuinely interesting privacy architecture, but the welcome screen's "A private AI that learns about you — without ever knowing your name" is too cryptic to land for someone who has never thought about anonymisation. The Privacy Ledger is the right place to make this tangible, but it requires one extra tap to discover.
5. **Budget sensitivity vs. incumbent alternatives** (severity: high). ChatGPT Plus is £16/month but has established trust, better mobile polish, file upload, and web browsing. Memu at £2.99/month needs a clearer value statement than "privacy" to win a student's discretionary spend.
6. **No study-group / shared-workspace concept** (severity: medium). Multi-profile is technically shipped but there is no "study group" or "shared project" framing. The five-flatmates scenario works mechanically but requires manual Space sharing setup with no guidance.

### Highest-value first build for this persona

This persona is also a punt from a primary targeting perspective — but document QA is worth keeping and polishing because it serves both the student and the founder/entrepreneur. The specific student build that would move the needle is not worth prioritising over the family AI core: deadline-aware push notifications, an "add deadline" affordance in chat that actually registers a timed push. This is also relevant to the family use case (school project deadlines, family events), so it has cross-persona value. Frame it as a family feature, not a student feature.

---

## Persona 4: Ambitious Professional (Career Development)

### Snapshot

Full-time employed at a mid-size tech consultancy, 5 years in, targeting promotion to Principal level. Runs a personal side project (a small productivity app) as a portfolio piece. Is doing AWS Solutions Architect certification. Keeps notes in Notion, uses LinkedIn actively for network building, has a work MacBook and a personal phone. Wants to map internal political dynamics, track conversations with sponsors, and prepare well for the annual performance review in September. Has tried ChatGPT but found it useful only in the moment — no memory. Privacy-interested: does not want their promotion strategy or internal political notes indexed by OpenAI.

### Jobs to be done

- Capture and retrieve career-development context: "Remember that Divya is my sponsor for the Principal promotion. She responds well to delivery data, not opinions."
- Prep for a specific meeting: "I'm meeting Divya on Friday. What do I know about her preferences and what's the open thread from last time?"
- Track learning progress: "I've done 4 of 12 AWS modules. What's left?"
- Separate personal from work: keep the side-project notes separate from the day-job political mapping, and both separate from personal life.
- Draft a message with relevant context loaded: "Draft a one-paragraph update to Divya on the Q1 delivery programme, based on what you know."

### Where Memu fits

**Partial fit, with the same structural problem as Persona 1: Memu is a single-tenant AI context store with no domain separation.** The core capability — "an AI that remembers what you tell it, privately, and surfaces it when relevant" — is directly applicable to career development. The Spaces system (person Spaces for "Divya — sponsor, Principal track", commitment Spaces for "AWS certification", routine Spaces for "weekly 1-1 prep") maps coherently onto career-development workflows. The Digital Twin's privacy property is genuinely differentiated: asking an AI for advice on internal political dynamics without your name, your employer's name, or your colleagues' names being sent to a cloud provider is a real use case.

The partial fit breaks down in three ways. First, no domain separation: career notes bleed into personal notes in the same context pool, unless the user manually manages Space visibility (private vs. family). Second, the draft_communication skill is not yet shipped (Tier 1 skill cluster, 2/4 done as of 2026-04-26), so the "draft an update for Divya" use case requires hand-assembling the prompt. Third, the product has no concept of "work mode" vs. "personal mode" — the morning briefing does not differentiate between a family event and a career development goal.

Unlike the job-seeker and student, this persona has a sustained use case that fits Memu's context-accumulation model: career development is a years-long horizon, not a weeks-long sprint. A person building a Principal track over 18 months has every reason to want an AI that accumulates knowledge over that period. The £2.99 price point is trivially affordable for this persona.

### Day 0 — first 5 minutes

**What onboarding should reveal:** "Memu knows what you tell it, privately, across time. Tell it about your goals, your relationships, and your projects. It builds from there."

**What it should ask for:** Name, email. Then ideally: "What are you working towards?" — a free-text seed that creates one or two Spaces. The current setup flow does not do this. After name+email, the user lands on a blank Today screen.

**The promise it should land:** "An AI that remembers your career context without sharing it with anyone." This is a real, landable promise for this persona. Memu can deliver it if context is seeded. The issue is whether the product communicates this clearly enough that the user understands what to do next.

### Day 1 — first 24 hours

She opens the app on a Monday morning and connects Google Calendar (the OAuth flow exists, Google Calendar integration is shipped). Today's calendar shows a 9am standup, a 2pm architecture review, and Friday's 1-1 with Divya. That is useful Day 1 value with zero prior setup.

She opens chat and tells Memu about Divya: "Divya Sharma is my sponsor for the Principal promotion track. She likes delivery data, distrusts opinion-heavy pitches, and has a standing concern about my stakeholder management skills." Autolearn extracts this, creates or routes to a person Space for "Divya Sharma." In the Digital Twin, Divya becomes "Professional-3" before the fact goes anywhere near Claude. The entity registry binds "Divya" → "Professional-3" so future references resolve correctly.

She asks: "What do I know about Divya?" Memu retrieves the Space. The response is accurate and has her own words. That is the trust-building moment. It works on Day 1 if the autolearn pipeline fires correctly.

### Day 7 — end of first week

**What should have accumulated:** Person Spaces for key colleagues. A commitment Space for AWS certification ("Module 4 of 12 done"). Possibly a routine Space for "Principal promotion — weekly actions." Daily calendar view is showing correctly. Conversation history is contributing rolling context within each session.

**The "ah, this is useful" moment:** Thursday evening, she preps for the Divya 1-1. She asks: "What do I know about Divya and what's the open thread from last time?" The retrieval system pulls the person Space and the autolearn entry from last week's 1-1 note. The response surfaces Divya's preferences and the last noted open question. She has a prep brief in 20 seconds that would have taken 5 minutes of note-searching before. This is the highest-value moment in the cluster.

### Day 30 — would they renew Founding-50?

Yes, if the Thursday prep moment happened even once. For this persona, Memu is competing against scattered Notion notes and memory. The £2.99 price is irrelevant. The question is whether context accumulation has been reliable enough to trust. Risks: (a) confabulation from empty context erodes trust early (if Memu confidently answers "what do I know about Divya" from a blank Space, the trust is gone); (b) no domain separation means she is worried about mixing career notes with personal notes; (c) the morning briefing surfaces personal context alongside career context in a way that feels untidy.

### Empty-state behaviour

Unlike the job-seeker, this persona is more likely to persist through the empty state because their use case is long-horizon. They will manually tell Memu things. The risk is still confabulation in the first week: if she asks "what did I tell you about the Principal promotion?" on Day 3 and Memu produces an answer that incorporates assumptions rather than what she actually said, the trust fails in a domain where trust is critical (career advice).

### Where Memu currently fails them

1. **No work/personal domain separation** (severity: high). A person Space for Divya (work sponsor) and a person Space for Rachel (partner) live in the same retrieval pool. A briefing query could surface both. Private visibility on a Space only means "household members cannot see this" — it does not mean "only surface this in work-context queries." There is no scoping by domain in the retrieval layer.
2. **Confabulation from empty state is unindicated** (severity: high). Same gap as Persona 1. For career-development queries — "what does Divya think of my stakeholder management?" — a hallucinated answer is worse than no answer, because the user may act on it.
3. **Draft communication skill not shipped** (severity: high). The most direct career-development use case ("draft an update for Divya based on Q1 delivery context") requires the draft_communication skill that is queued but not built.
4. **No AWS certification or structured learning tracker** (severity: medium). Learning progress (4 of 12 AWS modules) has no first-class representation. It lives as a note in a commitment Space body. The AI can recall it, but there is no progress bar, no "you have 8 modules left" proactive reminder, no date-based tracking.
5. **Morning briefing mixes all context** (severity: medium). No "work mode" briefing vs. "personal mode" briefing. For a person who wants to start the work day focused, surfacing family shopping list items alongside Principal promotion goals is unhelpful.
6. **Conversation-gap timer resets context** (severity: low-medium). The 30-minute conversation gap threshold starts a new conversation object, losing the rolling 10-message-pair history. A professional who picks up their phone to add a note during a meeting and then continues an hour later is starting from a cold context window, not a warm one. The Spaces retrieval partially compensates, but intra-session context is lost.

### Highest-value first build for this persona

Domain/context scoping — the same gap as Persona 1. The ability to say "in this chat, I'm thinking about work" and have the retrieval layer surface only work-tagged Spaces and context entries would transform the quality of responses for anyone using Memu across multiple domains of their life. This is also the correct fix for the family-use case (Rach's Caddisfly work and household context should not bleed together), so it has cross-persona and cross-product value. It is not a nice-to-have decoration — it is the architectural feature that makes Memu trustworthy as an AI for complex lives.

---

## Cross-cutting observations within this cluster

**The single shared failure is confabulation opacity.** Across all four personas, the highest-severity UX failure is that when the context block is empty or thin, Claude produces plausible-sounding answers with no visible signal that they came from nothing. The Privacy Ledger shows what was sent but does not expose "context block was empty." Every persona above would benefit from a clear signal — a one-line footnote in the response, a ledger flag, anything — distinguishing "I recalled this from your notes" from "I'm generating this from training data."

**Autolearn is load-bearing but invisible.** The context accumulation that makes Memu useful for all four personas runs silently in the background. The user has no visibility into what has been learned, no "Memu now knows 12 things about you" counter, no way to see whether a fact was routed to a Space or only to context_entries. This opacity makes it hard to trust and hard to debug. A simple "memory" view (the `memory.tsx` screen exists in the file tree — verify whether it's functional or placeholder) would close this gap.

**Domain scoping is the unbuilt architectural feature that gates this cluster.** The founder/entrepreneur and ambitious professional personas both need context isolation across domains of their life. Memu's current model is a single context pool per profile, with Space visibility (private / family / specific people) as the only scoping mechanism. That is a sharing/privacy model, not a domain/attention model. The "Projects/Spaces" chat scoping that Hareesh flagged in April 2026 is the right design direction. Until it exists, any sophisticated multi-domain user is managing context pollution manually.

**The product is ready for family beta. It is not ready for individual-use beta outside the founder/entrepreneur persona.** The job-seeker and student personas expose Memu to direct comparison with ChatGPT, Notion AI, and free alternatives where it will lose on polish, onboarding speed, and price-to-value for their specific use case. Opening Founding-50 beta to these personas risks early churn and negative word-of-mouth from people who were the wrong audience. The family persona, the household-manager persona, and the founder persona (who is already in the product and shaping it) are the defensible early adopters.
