# Memu Product Specification v3.0
## "Your Family's Chief of Staff"

**Date:** March 2026  
**Author:** Hareesh Kanchanepally + Claude  
**Status:** Definitive architecture specification  
**Core principle:** The AI that acts on your family's behalf — without ever learning who you are.

---

## 1. The Problem (Unchanged, Sharpened)

Your family's information is scattered across WhatsApp, Google Calendar, Gmail, Google Photos, school apps, and your own head. No single platform can see across all of it. You — usually one parent — are the human middleware connecting the dots.

Parents spend an average of 17 hours per week coordinating family schedules and logistics. That's a part-time job devoted to planning alone.

Two products have emerged to solve this:

**Nori** (launched January 2026, 100,000+ families) proved the market exists. Families want a shared AI brain that coordinates across calendars, tasks, meals, and logistics. But Nori holds all family data on its servers. Every meal plan, every schedule, every family note — on a startup's cloud. The Chief of Staff reports to the company, not the family.

**OpenClaw/NanoClaw** (250,000+ GitHub stars) proved that people want AI that *acts*, not just answers. Agents that book flights, negotiate car prices, manage inboxes — autonomously. But OpenClaw was designed for individual technical users, not families. And its security track record is a cautionary tale.

**Memu sits at the intersection.** A Family Chief of Staff that coordinates like Nori, acts like OpenClaw, and architecturally guarantees that the AI never learns who your family is.

---

## 2. What Memu Is

Memu is a WhatsApp contact that knows your family's life and acts on your behalf.

You text Memu like you text a friend. Your wife texts Memu. Your child texts Memu. Each conversation is private. Memu answers using Claude, enriched with your family's calendar, group chats, emails, and photos. But here's the difference:

**Memu doesn't strip your identity from messages. It translates your family into an anonymous model.**

The AI doesn't see "Robin has a dentist appointment at Ridgeway Primary's half-term." It sees "Child-1 has a medical appointment during School-1's holiday period." The anonymous model is structurally complete — relationships, schedules, preferences, history — all intact. Just not identifiable.

When the AI responds, Memu translates back. The family sees real names, real places, real context. The AI saw none of it.

This isn't PII stripping. This is a **Family Digital Twin** — an anonymous, complete representation of your family that gets smarter over time while remaining permanently unidentifiable.

---

## 3. The Two Architectural Innovations

### 3.1 Innovation 1: The Anonymous Family Digital Twin

#### The Problem with PII Stripping

Traditional PII stripping is subtractive. You take a message, remove names, schools, and addresses, and send what's left. This creates three problems:

1. **Context loss.** "Robin mentioned paddleboarding to Aanya at Ridgeway" becomes "mentioned paddleboarding to at." The AI gets garbage.
2. **Incompleteness.** Regex catches known entities. It misses novel ones. If Robin mentions a new friend "Zara" for the first time, the stripper doesn't know it's a name.
3. **Fragility.** Every conversation requires correct stripping. One miss and real PII reaches the cloud. The trust model is binary — either it works perfectly or it's broken.

#### The Solution: Translation, Not Subtraction

The Family Digital Twin is a persistent, structured, anonymous model of your family that lives on the family's device (or their encrypted partition on the cloud tier).

It contains:

- **Anonymous personas.** Each family member has a stable anonymous identity: Adult-1, Adult-2, Child-1, Child-2. These personas have attributes: age, school year, interests, dietary requirements, communication style — everything the AI needs to give good answers. Just no real names, locations, or identifying details.
- **Relationship graph.** Adult-1 and Adult-2 are partners. Child-1 is their child, age 7, school year 3. Friend-3 is Child-1's school friend. Teacher-2 teaches Child-1's class. The graph is rich and complete. It just maps to pseudonyms, not identities.
- **Entity registry.** Every named entity the family mentions — people, schools, places, businesses — gets registered with an anonymous label. "Ridgeway Primary" → School-1. "Dr. Patel" → Professional-3. "Costa in town" → Place-7. The registry grows automatically as new entities appear in conversations, calendar events, and emails.
- **Temporal context.** Calendar events, deadlines, routines, patterns — all stored with anonymous references. "Child-1 has Activity-3 every Thursday at Location-2" is structurally identical to "Robin has swimming every Thursday at Leisure Centre" — the AI can reason about scheduling conflicts, suggest reminders, coordinate logistics — all without knowing who, where, or what specifically.

#### How Translation Works

```
INBOUND (family → AI):

  "Can you check if Robin's swimming clashes with 
   the dentist appointment Dr Patel mentioned?"
   
       ↓ Twin translates
   
  "Can you check if Child-1's Activity-3 clashes with 
   the medical appointment Professional-3 mentioned?"
   
       + Context injected from twin:
       "Child-1 has Activity-3 on Thursdays 16:00-17:00 at Location-2.
        Professional-3 appointment is Thursday 15:30 at Location-5.
        Adult-2 usually handles Activity-3 transport."

       → Sent to Claude API

OUTBOUND (AI → family):

  Claude responds: "Yes, there's a clash. Activity-3 is at 16:00 
   and the appointment is at 15:30. Could Adult-2 take Child-1 to 
   Activity-3 while you handle the appointment?"
   
       ↓ Twin translates back
   
  "Yes, there's a clash. Swimming is at 4pm and the dentist is at 
   3:30. Could Rach take Robin to swimming while you handle 
   the dentist?"
```

The AI received a structurally complete, contextually rich query. It gave a useful, coordinated answer. It never learned a single real name, location, or identifying detail.

#### Why This Is Better Than Stripping

- **Context is preserved, not destroyed.** The AI gets *more* useful information, not less, because the twin injects structured context that raw messages don't contain.
- **Novel entities are caught automatically.** When the local model (or a lightweight NER pass) detects a new proper noun, it registers it in the entity registry with an anonymous label. No manual configuration needed.
- **The trust model is graceful, not binary.** Even if a novel entity slips through un-registered, the overall conversation is still anonymous because every *other* entity has been translated. One missed name in a sea of pseudonyms is far less identifying than one missed name in an otherwise stripped message.
- **The twin gets smarter over time.** Every conversation, calendar event, email, and photo adds to the twin. After a month, the twin knows your family's routines, preferences, relationships, and patterns — all anonymously. The AI gets progressively better answers because the context is progressively richer.

#### The Entity Registry: Automatic and Configurable

**Automatic detection:** The local LLM (or a lightweight classifier during message preprocessing) scans each inbound message for proper nouns, location references, and institution names. Detected entities are proposed for the registry.

**Family confirmation (first time only):** When a new entity is detected, the twin asks: "I noticed you mentioned 'Zara'. Is this a person? (Friend / Family / Teacher / Other)" — once, via a quick WhatsApp reply. After that, Zara is permanently mapped to Friend-4 in all future translations.

**Configured entities (setup):** During initial setup, the family provides core entities: family names, school names, home address, key locations. These form the seed registry. Everything else grows organically.

**Override and audit:** The parent dashboard shows the full entity registry. Parents can rename, recategorise, merge, or delete entities at any time. The audit trail shows which entity mappings were used in each API call.

---

### 3.2 Innovation 2: Privacy-Preserving Agentic Actions

#### The Problem with Current Agents

OpenClaw proved people want agents that *act*. But agentic action + family context = dangerous:

- An OpenClaw agent that can see your WhatsApp, access your calendar, and send emails has *everything* — and Cisco called its security "a nightmare."
- NanoClaw's container isolation is better, but it's designed for individual technical users, not family multi-user scenarios.
- Nori can create calendar events and assign tasks, but only within its own walled garden — it can't interact with the services families actually use.
- None of them address the core problem: **an agent that takes actions needs credentials, and credentials + AI = the highest-value attack target imaginable.**

#### Memu's Approach: The Capability Envelope

Memu doesn't give the AI access to family services. It gives the AI access to **capability descriptions**, and the family's local gateway executes the actual actions.

Think of it like this: the AI is a strategist in a sealed room. It can see an anonymised map of the family's world (the twin). It can write instructions on a notepad and slide them under the door. But it can never open the door. The gateway — running on the family's device — reads the instructions and decides whether to execute them.

```
AI (in the cloud, anonymous):
  "Create a calendar event: 
   Activity-3 for Child-1
   Thursday 16:00-17:00 at Location-2
   Reminder: 30 minutes before
   Assign transport to: Adult-2"

       ↓ Returned to gateway

GATEWAY (on family's device, has real identity):
  Translates: Activity-3 → Swimming, Child-1 → Robin, 
              Location-2 → Leisure Centre, Adult-2 → Rach
  
  Creates real calendar event:
  "Swimming - Robin
   Thursday 4:00-5:00 PM at Leisure Centre  
   Reminder: 3:30 PM
   Rach handling transport"
  
  → Written to Google Calendar via OAuth
  → Confirmation sent to family WhatsApp
```

The AI planned the action. The gateway executed it. The AI never had calendar credentials. The AI never knew the real names or locations.

#### The Action Framework

Memu's agentic capabilities are organised into **action types**, each with a clear contract:

| Action Type | What the AI Can Instruct | What the Gateway Executes | Credentials Required |
|---|---|---|---|
| Calendar | Create/modify/cancel events with anonymous entities | Real calendar operations via Google Calendar OAuth or CalDAV | OAuth token (gateway only) |
| Reminders | Set timed notifications for family members | WhatsApp messages to specific family members at specified times | Baileys connection (gateway only) |
| Shopping | Add/remove/check items, suggest based on patterns | Update shared shopping list, optionally message group | Local database + WhatsApp |
| Research | Search the web for anonymous queries | Web search, summarise, return to family | No credentials needed |
| Messaging | Draft messages for family members to review | Present draft via WhatsApp, send only with explicit approval | Baileys (gateway only) |
| Booking | Research options, compare, recommend | Present options. Actual booking requires human confirmation + action | None (human-in-the-loop) |

#### The Approval Framework

Not every action should execute automatically. Memu uses a tiered approval model:

**Auto-execute (no confirmation needed):**
- Adding items to shopping list
- Creating reminders for the person who asked
- Adding calendar events that the person explicitly requested
- Answering questions

**Notify-and-execute (executes, but tells you):**
- Morning briefing delivery
- Calendar conflict detection and alert
- Proactive reminders ("School trip consent form deadline is tomorrow")

**Request approval (waits for confirmation):**
- Creating calendar events that affect other family members
- Sending messages to family members on someone's behalf
- Any action involving money or external services
- Any action requested by a child profile

**Never auto-execute:**
- Anything involving payment or financial transactions
- Anything involving external parties (teachers, businesses, doctors)
- Anything that could be embarrassing or sensitive if wrong

The approval request comes via WhatsApp: "I'd like to add 'Dentist - Robin, Thursday 3:30pm' to the family calendar. Shall I go ahead?" One-tap reply: "Yes" or "No."

---

## 4. Product Tiers

Same as spec v2, with the twin and agentic layer integrated across all tiers:

### Tier 0: Try (Laptop)
- Family Digital Twin (basic — configured entities only, no auto-detection)
- WhatsApp DM conversations with Claude via twin translation
- Family profiles (adult/child)
- Shopping list management
- No observation, no proactive actions (laptop may be asleep)
- **Free. Bring your own Claude API key.**

### Tier 1: Always On (VPS or Memu Cloud)
- Full Digital Twin with auto-detection of new entities
- WhatsApp group observation → twin grows passively
- Google Calendar observation → scheduling intelligence
- Gmail/IMAP observation → school emails, appointments
- Morning briefing delivered to family WhatsApp group
- Proactive conflict detection and reminders
- Agentic actions: calendar management, reminders, shopping
- **£8/month (Memu Cloud) or self-hosted VPS (~£5/month + API)**

### Tier 2: Home (Hardware in the house)
- Everything in Tier 1
- Full data sovereignty — twin and all data on family's hardware
- Photo observation (Google Photos API or Immich)
- Document ingestion (school newsletters, PDFs)
- Local LLM for background processing (overnight indexing, briefing generation)
- **One-time hardware (~£150-300) + API costs**

### Tier 3: Sovereign (Full stack)
- Everything in Tier 2
- Matrix/Synapse replacing WhatsApp
- Immich replacing Google Photos
- Baikal replacing Google Calendar
- Complete independence from all Big Tech platforms
- **One-time hardware (~£250-500) + API costs**

### The Cloud Tier (Tier 1 hosted by Memu)

This is where most families start. And the architecture guarantees their privacy even though Memu hosts the compute:

- The Family Digital Twin encryption key is derived from the family's password. Memu (the company) cannot decrypt the twin.
- API calls to Claude are already anonymous (they go through the twin translation).
- Conversation history is encrypted at rest with the family's key.
- Memu's servers process anonymised queries. They never see real identities.
- The family can export their entire encrypted twin + history at any time and move to self-hosted. Zero lock-in.

**Memu is the only family AI where the hosted tier is architecturally private, not just policy-private.**

---

## 5. Technical Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MEMU GATEWAY SERVICE                          │
│                                                                      │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────────┐  │
│  │    BAILEYS      │  │  FAMILY DIGITAL  │  │   ACTION EXECUTOR   │  │
│  │  WhatsApp Conn  │  │     TWIN         │  │                     │  │
│  │                 │  │                  │  │  Calendar (OAuth)   │  │
│  │  - DM receive   │  │  - Entity reg.   │  │  Reminders (cron)  │  │
│  │  - Group observe│  │  - Personas      │  │  Shopping (local)  │  │
│  │  - Send replies │  │  - Relationship  │  │  Research (web)    │  │
│  │  - Send actions │  │    graph         │  │  Messaging (WA)    │  │
│  └───────┬────────┘  │  - Translate in   │  └────────┬───────────┘  │
│          │           │  - Translate out  │           │              │
│          │           │  - Auto-detect    │           │              │
│          │           └────────┬──────────┘           │              │
│          │                    │                      │              │
│  ┌───────▼────────────────────▼──────────────────────▼───────────┐  │
│  │                INTELLIGENCE ORCHESTRATOR                       │  │
│  │                                                                │  │
│  │  1. Receive message from WhatsApp (Baileys)                   │  │
│  │  2. Identify sender → load profile from twin                  │  │
│  │  3. Translate message through twin (real → anonymous)         │  │
│  │  4. Query context store for relevant anonymous context        │  │
│  │  5. Build enriched anonymous prompt                           │  │
│  │  6. Detect if response requires ACTION or just ANSWER         │  │
│  │  7. Route to Claude API                                       │  │
│  │  8. Parse response for action instructions (if any)           │  │
│  │  9. Translate response through twin (anonymous → real)        │  │
│  │  10. If actions detected: validate against approval framework │  │
│  │  11. Execute approved actions via Action Executor              │  │
│  │  12. Send response + action confirmations via WhatsApp        │  │
│  │  13. Store everything locally (original + anonymous + audit)  │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │              CONTEXT STORE (PostgreSQL + pgvector)             │  │
│  │                                                                │  │
│  │  - Twin state (personas, entities, relationships)             │  │
│  │  - Conversation history (per user, private, full audit)       │  │
│  │  - Observed context (calendar, group chat, email, photos)     │  │
│  │  - Vector embeddings for semantic search                      │  │
│  │  - Action history (what was requested, approved, executed)    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              CONTEXT OBSERVERS (always-on tiers)               │  │
│  │                                                                │  │
│  │  - WhatsApp Group Observer (Baileys, reads family group)      │  │
│  │    → Auto-detects new entities → proposes for twin registry   │  │
│  │  - Calendar Observer (Google Calendar / CalDAV)                │  │
│  │    → Events translated and stored in twin's temporal context  │  │
│  │  - Email Observer (IMAP polling)                              │  │
│  │    → School emails, appointments extracted and indexed        │  │
│  │  - Photo Observer (Google Photos API / Immich) [Tier 2+]     │  │
│  │    → Face clusters, locations, dates for contextual recall    │  │
│  │  - Proactive Engine (temporal reasoning)                      │  │
│  │    → Scans twin for upcoming events, conflicts, deadlines    │  │
│  │    → Generates nudges, reminders, morning briefing content   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              LOCAL LLM (Tier 2+ only, Ollama)                 │  │
│  │                                                                │  │
│  │  - Entity detection (NER on inbound messages)                 │  │
│  │  - Morning briefing generation                                │  │
│  │  - Overnight context summarisation                            │  │
│  │  - Pattern detection (routines, habits, recurring needs)      │  │
│  │  - NOT used for interactive chat (too slow on N100)           │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. The Proactive Engine

A Chief of Staff doesn't wait to be asked. The Proactive Engine is what transforms Memu from "an AI you text" into "an AI that anticipates."

### What It Does

The engine runs continuously (on always-on tiers) and scans the twin for:

**Temporal collisions:** Two events at overlapping times. An event that requires preparation the family hasn't started. A deadline approaching with no action taken.

**Pattern breaks:** "Child-1 usually has Activity-3 on Thursdays but this week the calendar shows no entry. Possible oversight?"

**Context connections:** "Adult-1 mentioned in the group chat wanting to try Italian food. Adult-2's birthday is in 10 days. There is a restaurant (Place-12) that Adult-1 saved a photo from last month."

**Proactive nudges:** "School-1 sent an email about non-uniform day on Friday. No family member has acknowledged it in any channel."

### How It Communicates

Proactive intelligence is delivered through three channels:

1. **Morning briefing** (daily, to family WhatsApp group): The headline view. What's happening today, what needs attention, what the family should know.

2. **Timely nudges** (throughout the day, to relevant family member's DM): "Reminder: the consent form for Child-1's school trip is due tomorrow. Want me to draft a response?"

3. **Agentic suggestions** (when patterns are detected): "I've noticed you buy milk every 5-6 days. Your last purchase was 5 days ago. Want me to add it to the shopping list?"

All proactive messages follow the approval framework. The engine never takes action without permission for anything that affects others.

---

## 7. Child Safety (MyDigitAlly Framework)

Identical to spec v2 but strengthened by the twin architecture:

- Child profiles use Claude Haiku (faster, cheaper, sufficient for children's queries)
- Child conversations are visible to parent profiles via the dashboard
- The twin translates child messages with extra care — all friend names, school references, teacher names automatically anonymised
- Response filters check for age-inappropriate content, self-harm indicators, grooming patterns
- Alerts sent to parent profiles via WhatsApp DM if anything is flagged
- Rate limits (configurable, default 50 queries/day) prevent overuse
- The MyDigitAlly educational framework system prompt encourages critical thinking, parent-bridge conversations, and honest AI identity

**Child safety is not a feature. It's the reason many families will choose Memu over every alternative.**

---

## 8. Separation, Safety, and Family Change

### 8.1 Design Principle

Families change. Partners separate. Relationships break down. A family AI built only for the happy path is a tool that becomes a weapon the moment things go wrong. This section is not an afterthought — it's a first-class architectural concern.

### 8.2 Per-Adult Cryptographic Privacy

Every adult profile has their own encryption key, derived from their personal password (not the family password, not the admin password). Adult-1's private conversations with Memu are encrypted with Adult-1's key. The admin cannot read Adult-2's private conversations. This is cryptographic, not policy-based. Even with physical access to the server, Adult-1 cannot decrypt Adult-2's conversation history without Adult-2's password.

Child conversations are encrypted with a shared parental key that both adults hold. This is established during setup when both adults are present. Neither adult can unilaterally revoke the other's access to child conversation visibility.

### 8.3 Unilateral Exit

Any adult can, at any time, without the admin's permission or knowledge:

- **Export their data:** Every conversation they've had with Memu, every context entry that relates to them, their personal partition of the twin.
- **Delete their profile:** Removes their persona from the twin, purges their entity mappings, deletes their conversation history, removes their encryption key.
- **Unlink their channels:** Remove Memu from their WhatsApp, revoke calendar OAuth, disconnect email observation.

These are self-service actions accessible from the parent dashboard or via a WhatsApp command to Memu ("delete my account"). They do not require admin approval. The admin is notified *after* the action is complete, not before.

### 8.4 Admin Role: Functional, Not Hierarchical

The admin set up the server. That gives them:
- Infrastructure management (API keys, observer config, billing)
- The ability to add new family members (with the new member's consent)
- System health monitoring

It does NOT give them:
- Access to other adults' private conversations
- The ability to prevent another adult from leaving
- The ability to delete another adult's data
- The ability to modify another adult's permissions without their consent
- Elevated visibility of the twin beyond what any adult can see

### 8.5 Immutable Audit Trail

Every administrative and access action is logged in an append-only audit trail:

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_profile_id TEXT NOT NULL,
  action TEXT NOT NULL,       -- 'profile_created', 'profile_deleted', 'conversation_accessed',
                              -- 'observer_enabled', 'observer_disabled', 'permission_changed',
                              -- 'data_exported', 'child_visibility_changed', 'safety_reset'
  target_profile_id TEXT,     -- Who was affected
  details TEXT,               -- JSON: what specifically changed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- This table has NO delete permissions in the application layer.
-- The only way to remove entries is direct database access,
-- which itself creates a gap in the timestamp sequence — visible evidence.
```

In a coercive control investigation, the pattern of "password changed at 2am, observer added to partner's email, partner's profile permissions modified" is visible and timestamped.

### 8.6 Safety Reset

If a family member is in immediate danger:

1. **One-tap exit via WhatsApp:** Text Memu "SAFETY RESET" (or a configured safe word). Memu immediately: deletes the sender's profile, unlinks all their channel observations, purges their conversation history, removes their persona from the twin.
2. **No advance notification to admin.** The controlling partner sees that the other person's profile is gone. They do not receive a warning beforehand.
3. **Evidence preservation option:** Before deletion, the system offers to export an encrypted evidence package (audit trail + conversation history) to an email address the exiting person provides. This can be shared with law enforcement or a solicitor.
4. **Help resources:** The safety reset response includes domestic abuse helpline numbers (configured per locale, UK default: National Domestic Abuse Helpline 0808 2000 247).

### 8.7 Separation Process

**Amicable separation:**
- One adult exports their data and deletes their profile.
- The twin's relationship graph updates — the departed persona becomes inactive.
- Context entries that relate only to the departed adult are purged.
- Shared context (family calendar events where both participated) remains but with the departed adult's real-name mapping removed.
- The remaining family continues using Memu normally.

**Contested separation:**
- Either adult can leave unilaterally (section 8.3).
- Neither adult can destroy the other's data.
- Child profile visibility freezes at the last mutually-agreed setting.
- Neither parent can unilaterally change child visibility — both must agree.
- If disputes arise, the system defaults to the safest position: both parents retain existing child visibility until they both agree on a change or a court orders otherwise.

### 8.8 Children Across Two Households

If separated parents both want Memu, the child can have profiles on both instances. The twin is per-instance — Parent A's Memu and Parent B's Memu are separate systems with separate twins, separate context, separate conversations. There is no sync between them. This mirrors reality: the child has a life at Mum's house and a life at Dad's house, and each parent sees what happens under their roof.

---

## 9. Multi-Channel Architecture

### 9.1 Design Principle

WhatsApp is the first channel because it's where most families live. But the architecture is channel-agnostic. The Intelligence Orchestrator receives text, identifies a sender, translates through the twin, routes to Claude, translates back, and returns a response. It doesn't care where the message came from.

### 9.2 Channel Connectors

Each messaging platform is a thin connector with a common interface:

| Channel | Connector | Status | Notes |
|---|---|---|---|
| WhatsApp | Baileys | Build first | Primary channel. DM + group observation |
| Telegram | Grammy/Telegraf | Future slice | Natural second channel for privacy-conscious families |
| iMessage | BlueBubbles/Beeper | Future slice | Requires macOS host or bridge service |
| SMS | Twilio webhook | Future slice | Fallback for families not on messaging apps |
| Web chat | Built-in HTTP | Build with dashboard | For families who prefer browser interaction |
| Matrix/Element | matrix-nio | Tier 3 only | For sovereign stack users |

### 9.3 Connector Interface

```typescript
interface ChannelConnector {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(callback: (msg: InboundMessage) => void): void;
  sendMessage(recipient: string, content: string): Promise<void>;
  sendGroupMessage(groupId: string, content: string): Promise<void>;
  getGroupMembers(groupId: string): Promise<string[]>;
}

interface InboundMessage {
  channel: string;          // 'whatsapp', 'telegram', 'web', etc.
  senderId: string;         // Channel-specific sender ID (phone number, username, etc.)
  groupId?: string;         // If from a group
  content: string;
  timestamp: Date;
  isDirectedAtMemu: boolean; // Mentioned or DM
  metadata: Record<string, any>;
}
```

The orchestrator maps `senderId` to a profile via the profile table, which stores channel-specific identifiers:

```sql
CREATE TABLE profile_channels (
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  channel TEXT NOT NULL,           -- 'whatsapp', 'telegram', 'web', etc.
  channel_identifier TEXT NOT NULL, -- Phone number, username, session ID, etc.
  is_primary BOOLEAN DEFAULT FALSE,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (profile_id, channel)
);
```

A single family member can be linked across multiple channels. A message from any of their linked channels maps to the same twin persona.

---

## 10. Consent and Observation Boundaries

### 10.1 Design Principle

Memu only observes conversations it has been explicitly and visibly invited into. This is both an ethical principle and a legal one (GDPR, UK Data Protection Act).

### 10.2 Rules

**Family groups (Memu is a visible member):** Full observation. Every member can see Memu is present. Memu's profile name is visible in the group member list. This is consensual by participation — if a family member doesn't want Memu observing, they raise it with the family, and Memu can be removed.

**External groups (school, sports, neighbourhood):** Memu does NOT join. Memu does NOT observe. Even if the admin has technical ability to bridge these groups, the product explicitly prevents it. Other group members did not consent to AI processing of their messages.

**How external context reaches Memu:**
1. **Email forwarding.** The family forwards school newsletters, appointment confirmations, and event notices to the email address Memu watches. This is the family's own email — they chose to forward it. Clean consent.
2. **Natural family conversation.** A parent reads something in the school group and mentions it in the family group: "School said non-uniform day Friday." Memu observes this in the family group — which it's invited to. The original school group message was never processed.
3. **Document upload.** The parent photographs a school letter or saves a PDF and forwards it to Memu via WhatsApp DM. Memu ingests the document. The parent chose to share it. Clean consent.
4. **Calendar integration.** School events added to Google Calendar by the school's own system (many schools offer this) are observed via the calendar observer. The family opted into this calendar subscription. Clean consent.

### 10.3 Technical Enforcement

The WhatsApp group observer maintains an allowlist of group JIDs (group identifiers) that Memu is permitted to observe. During setup, the admin selects which groups to enable. The observer code refuses to process messages from groups not on the allowlist — even if Baileys receives them.

```javascript
// Hard enforcement — not configurable, not bypassable
const allowedGroups = await db.getAllowedGroupJids();
if (!allowedGroups.includes(msg.key.remoteJid)) {
  return; // Silently ignore. Do not store. Do not process.
}
```

---

## 11. Database Schema

### 11.1 Twin: Personas and Entity Registry

```sql
-- Anonymous personas (one per family member)
CREATE TABLE personas (
  id TEXT PRIMARY KEY,                    -- 'adult-1', 'adult-2', 'child-1', etc.
  profile_id TEXT UNIQUE REFERENCES profiles(id),
  persona_label TEXT NOT NULL,            -- 'Adult-1', 'Child-1' (used in translated messages)
  attributes JSONB,                       -- Age, school year, interests, dietary requirements
                                          -- All stored anonymously (no real names)
  relationship_to JSONB,                  -- [{"persona": "adult-1", "relationship": "partner"},
                                          --  {"persona": "child-1", "relationship": "parent"}]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Entity registry (maps real-world entities to anonymous labels)
CREATE TABLE entity_registry (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'person', 'school', 'workplace', 'medical', 'location',
    'activity', 'business', 'institution', 'other'
  )),
  real_name TEXT NOT NULL,                -- "Ridgeway Primary" (encrypted at rest)
  anonymous_label TEXT NOT NULL,          -- "School-1"
  attributes JSONB,                       -- {"type": "primary_school", "related_personas": ["child-1"]}
  detected_by TEXT DEFAULT 'manual',      -- 'manual', 'auto_ner', 'auto_pattern'
  confirmed BOOLEAN DEFAULT FALSE,        -- Has a family member confirmed this entity?
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT REFERENCES profiles(id)
);

-- Relationships between entities (not just personas)
CREATE TABLE entity_relationships (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entity_registry(id),
  related_entity_id TEXT REFERENCES entity_registry(id),
  related_persona_id TEXT REFERENCES personas(id),
  relationship_type TEXT NOT NULL,        -- 'attends', 'works_at', 'friend_of', 'located_at'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 11.2 Profiles (extended from v2)

```sql
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'adult', 'child')),
  date_of_birth DATE,
  school_year INTEGER,
  ai_model TEXT DEFAULT 'claude-sonnet-4-6',
  system_prompt_override TEXT,
  daily_query_limit INTEGER,              -- NULL = unlimited, 50 for children
  encryption_key_hash TEXT NOT NULL,      -- Hash of personal encryption key
  can_exit_unilaterally BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 11.3 Messages (with twin translation audit)

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content_original TEXT NOT NULL,         -- What the person typed (encrypted with their key)
  content_translated TEXT,                -- What was sent to Claude (anonymous twin translation)
  content_enriched TEXT,                  -- Full prompt including twin context injection
  content_response_raw TEXT,              -- What Claude returned (anonymous)
  content_response_translated TEXT NOT NULL, -- What the person saw (real names restored)
  entity_translations JSONB,             -- [{"real": "Robin", "anonymous": "Child-1", "type": "person"}]
  context_sources JSONB,                 -- Which twin context was injected
  actions_requested JSONB,               -- Actions the AI suggested (if any)
  actions_executed JSONB,                -- Actions that were approved and executed
  flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  channel TEXT NOT NULL,                  -- 'whatsapp', 'telegram', 'web', etc.
  latency_ms INTEGER,
  cloud_model TEXT,
  cloud_tokens_in INTEGER,
  cloud_tokens_out INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 11.4 Actions

```sql
CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES messages(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'calendar_create', 'calendar_modify', 'calendar_cancel',
    'reminder_set', 'shopping_add', 'shopping_remove',
    'research', 'message_draft', 'message_send',
    'booking_research', 'booking_confirm'
  )),
  instruction_anonymous TEXT NOT NULL,    -- What the AI instructed (anonymous)
  instruction_translated TEXT NOT NULL,   -- Translated to real entities
  approval_level TEXT NOT NULL CHECK (approval_level IN (
    'auto_execute', 'notify_and_execute', 'request_approval', 'never_auto'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'executed', 'failed'
  )),
  approved_by TEXT REFERENCES profiles(id),
  executed_at TIMESTAMPTZ,
  result JSONB,                           -- Outcome of execution
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 11.5 Allowed Groups and Observers

```sql
CREATE TABLE allowed_groups (
  group_jid TEXT PRIMARY KEY,
  channel TEXT NOT NULL,                  -- 'whatsapp', 'telegram', etc.
  group_name TEXT,
  observation_enabled BOOLEAN DEFAULT TRUE,
  memu_can_respond BOOLEAN DEFAULT TRUE,  -- Can Memu speak in this group?
  added_by TEXT REFERENCES profiles(id),
  added_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE observer_config (
  id TEXT PRIMARY KEY,
  observer_type TEXT NOT NULL CHECK (observer_type IN (
    'whatsapp_group', 'google_calendar', 'ical', 'baikal',
    'gmail', 'imap', 'google_photos', 'immich'
  )),
  enabled BOOLEAN DEFAULT FALSE,
  config JSONB,                           -- Provider-specific config (OAuth tokens, IMAP creds, etc.)
  last_sync_at TIMESTAMPTZ,
  sync_interval_minutes INTEGER DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 12. System Prompts

### 12.1 Adult Profile

```
You are Memu, a private family AI Chief of Staff. You have access to an anonymous 
model of this family — personas, relationships, schedules, and context. All real 
names, locations, schools, and identifying details have been replaced with anonymous 
labels (Adult-1, Child-1, School-1, Location-3, etc.).

CRITICAL RULES:
1. Always use the anonymous labels in your response. Never guess or invent real names.
2. If the context mentions "Child-1 has Activity-3 on Thursday", respond using those 
   exact labels. The system will translate them to real names before the user sees 
   your response.
3. If you can take an action (create calendar event, set reminder, add to shopping 
   list), describe the action using anonymous labels. Format actions clearly:
   
   ACTION: calendar_create
   WHAT: Activity-3 for Child-1
   WHEN: Thursday 16:00-17:00
   WHERE: Location-2
   ASSIGN: Adult-2 (transport)
   
4. Be warm, direct, and useful. You are a trusted Chief of Staff, not a chatbot.
5. For sensitive personal topics, engage thoughtfully and supportively.
6. If you notice any information that seems like it could be a real name or location 
   that wasn't properly anonymised, do not reference it in your response.
```

### 12.2 Child Profile (MyDigitAlly Framework)

```
You are Memu, a helpful learning companion for a child. The child's persona is 
[PERSONA_LABEL] (age [AGE], school year [YEAR]).

All names, schools, and locations have been replaced with anonymous labels. Always 
use these labels in your response. The system will translate them to real names.

RULES:
1. IDENTITY: Always be honest that you are an AI tool. Never pretend to have feelings.
2. LANGUAGE: Use vocabulary appropriate for a [AGE]-year-old.
3. SAFETY: Never provide information about self-harm, violence, weapons, drugs, or 
   explicit content. If the child expresses distress, respond with empathy and ALWAYS 
   include: "This sounds really important. Please talk to a grown-up you trust — like 
   Adult-1 or Adult-2."
4. CRITICAL THINKING: Don't just give answers. Ask follow-up questions.
5. PARENT BRIDGES: Occasionally suggest discussing topics with family.
6. BOUNDARIES: No roleplay, no simulated relationships, no "I love you."
7. HOMEWORK: Help understand, never just give the answer.
8. LENGTH: 2-4 short paragraphs maximum.
9. ACTIONS: You may suggest actions (reminders, calendar events) but ALL child-initiated
   actions require adult approval. Format them the same way but note:
   APPROVAL_REQUIRED: Yes (child-initiated)
```

---

## 13. Cloud Tier Privacy Architecture (The Honest Version)

### 13.1 The Contradiction We Caught

There is a fundamental tension between cloud-hosted WhatsApp processing and zero-knowledge encryption. When a family uses WhatsApp on Memu Cloud (Tier 1), Meta delivers messages in plaintext to our Baileys instance on Hetzner. To translate "Robin" to "Child-1", our server must read the entity registry. If the entity registry is E2E encrypted with a client-side key, our server cannot decrypt it to perform the translation.

**You cannot have a cloud-hosted WhatsApp bot and mathematical zero-knowledge encryption.** If the server does the translating, the server must hold the keys — at least in RAM.

This is not a problem to hand-wave away. It is the defining architectural constraint of the cloud tier, and we must be completely honest about it.

### 13.2 Three Trust Levels (Honest, Verifiable)

The privacy guarantee is different depending on which channel a family uses and where Memu runs. We state this explicitly to every user.

#### Level 1: Zero-Knowledge (Tier 2+ Home Hardware, any channel)

The gateway runs on the family's hardware. Translation happens on their silicon. The entity registry never leaves their device. The only thing that crosses the network is the anonymous API call to Claude.

**Trust model:** Mathematical zero-knowledge. Memu the company has no infrastructure in the loop. Even with a court order, there is nothing to seize from us because we hold nothing.

**Available on:** Tier 2 (Home), Tier 3 (Sovereign).

#### Level 2: Zero-Knowledge (Tier 1 Cloud, PWA/Web channel only)

When a family uses the Memu web app (PWA) instead of WhatsApp, the translation happens in their browser. The browser holds the decryption key locally. Only the anonymous prompt leaves the browser and reaches our server. The server processes anonymous queries and returns anonymous responses. The browser translates back to real names.

**Trust model:** Mathematical zero-knowledge for the web channel. The server never sees real names. This is the same model as zero-knowledge note-taking apps (Standard Notes, Proton Drive).

**Available on:** Tier 1 (Memu Cloud) when using the web interface.

#### Level 3: Ephemeral Processing (Tier 1 Cloud, WhatsApp channel)

When a family uses WhatsApp on Memu Cloud, the Baileys connector on our server receives plaintext messages from Meta. The server must decrypt the entity registry in RAM to perform the translation. It processes the message, translates it, builds the anonymous prompt, calls Claude, translates the response back, sends it via WhatsApp, and then **wipes the plaintext from RAM**. The entity registry is re-encrypted. The database on disk contains only encrypted real names and plaintext anonymous data.

**Trust model:** Ephemeral processing. Our server sees real names *briefly, in memory, during processing*. It never writes them to disk in plaintext. This is the same trust model as Signal's server infrastructure — messages pass through in transit but are not persisted. It is strong security. It is NOT zero-knowledge.

**What a breach would reveal:** If an attacker gains access to the running server's RAM (an extremely sophisticated attack), they could potentially intercept messages during the brief processing window. If they gain access to the database on disk, they see only encrypted real names alongside plaintext anonymous data — they'd need to crack the family's Argon2id-derived key to map anonymous labels to real identities.

**Available on:** Tier 1 (Memu Cloud) when using WhatsApp.

### 13.3 How We Communicate This

We do not overclaim. The marketing is honest:

> **Memu Cloud** keeps your family's identity encrypted at rest. WhatsApp messages are processed in memory and never written to disk in plaintext. For mathematical zero-knowledge privacy, use the Memu web app or run Memu on your own hardware.

Every tier has a clear privacy label in the dashboard:

| Tier | Channel | Privacy Level | Plain English |
|---|---|---|---|
| Tier 1 Cloud | Web/PWA | Zero-Knowledge | "We mathematically cannot see your identity" |
| Tier 1 Cloud | WhatsApp | Ephemeral | "Your identity is processed in memory, never stored on disk" |
| Tier 2 Home | Any | Zero-Knowledge | "Your identity never leaves your house" |
| Tier 3 Sovereign | Any | Zero-Knowledge + Full Sovereignty | "Nothing leaves your house. Period." |

### 13.4 Key Derivation and Encryption

**Key derivation:** During setup, the family creates a password. A key is derived using Argon2id (memory-hard, resistant to brute force).

**For Tier 1 Cloud (WhatsApp channel):** The derived key is held in the server's RAM process during active sessions. When the family disconnects or after an inactivity timeout, the key is wiped from memory. The key is reconstructed from the password when the family next authenticates. The key is never written to the server's disk, logs, or persistent storage.

**For Tier 1 Cloud (Web channel):** The derived key never leaves the browser. All translation happens client-side. The server receives only anonymous data.

**For Tier 2+ (Home):** The key stays on the family's hardware. No ambiguity.

### 13.5 Technical Safeguards for Ephemeral Processing

For the WhatsApp channel on Tier 1, we implement defence-in-depth:

1. **Process isolation:** The Baileys connector and translation engine run in an isolated process with its own memory space. No other service on the server can read its memory.
2. **Explicit memory wiping:** After each message is processed, the plaintext content and decrypted entity mappings are overwritten with zeros before being freed. (Node.js: Buffer.fill(0) before deref.)
3. **No logging of plaintext:** The application logs contain only anonymous labels. Real names never appear in log files, error reports, or crash dumps.
4. **Encryption at rest:** The PostgreSQL database stores entity_registry.real_name fields encrypted with the family's key. The anonymous fields (anonymous_label, persona attributes, translated messages) are in plaintext for the server to process.
5. **Audit trail:** Every decryption event (key loaded into RAM) is logged with a timestamp. Families can see how often and when their key was active.

### 13.6 Data Portability

"Export my data" produces an encrypted archive containing the full twin (with real names), all conversations, all context, and the entity registry. The family can import this into a self-hosted Memu instance by providing their password. Zero lock-in. Zero data loss. Complete migration path from cloud to sovereignty.

### 13.7 Why This Honesty Is a Strength

Every competitor either overclaims their privacy (Nori: "we take privacy seriously" — policy, not architecture) or doesn't address it (OpenClaw: known security nightmare). Memu is the only product that tells families *exactly* what the trust model is at each tier, backs it with verifiable architecture, and offers a clear upgrade path to mathematical zero-knowledge.

The graduation story becomes: "Start on Memu Cloud. Your identity is protected by ephemeral processing — stronger than any competitor. When you're ready, move to home hardware and get mathematical zero-knowledge. Same product, same data, stronger guarantee."

---

## 14. Data Lifecycle: How Context Flows Through the System

### 14.1 The Three Phases

Context in Memu moves through three distinct phases: **Ingestion** (data enters the system), **Enrichment** (data is processed and made useful), and **Retrieval** (data is assembled into Claude's prompt). Understanding this flow is essential for debugging, for explaining the product to anyone who asks, and for building it correctly.

### 14.2 Phase 1: Ingestion (Real-Time, Automatic)

During the day, three observers write raw context into PostgreSQL's `context_entries` table. No LLM is involved. This is pure data capture.

**WhatsApp Group Observer (Baileys):** Every message in the family group is received via WebSocket. The gateway writes a row: timestamp, source `whatsapp_group`, raw content, sender's phone number. If Rach says "Robin's swimming is cancelled tomorrow" at 3pm, it's in the database by 3:00:01pm. Memu does NOT respond in the group unless mentioned.

**Calendar Observer (Google Calendar OAuth or CalDAV):** Polls every 15 minutes. New events and changes are written to `context_entries`: source `google_calendar`, event summary, start/end time, location metadata.

**Email Observer (IMAP):** Polls every 30 minutes. New emails are extracted (subject, plain-text body, sender, date) and written to `context_entries`: source `imap`.

All ingested content is stored in its original form. The twin translation (real names → anonymous labels) happens only at query time, not at ingestion. This means the raw context store contains real names — which is why it's encrypted at rest and why the Tier 1 Cloud privacy architecture (Section 13) matters.

### 14.3 Phase 2: Enrichment (Overnight Batch, Local LLM)

At 2am, a cron job triggers the overnight batch processor. On Tier 2+ (home hardware), this runs on Ministral-3B via Ollama. On Tier 1 (cloud), this runs on Claude Haiku (cheap, fast enough for batch work).

**Job 1: Entity Detection (NER).** The local LLM scans each new message from the past 24 hours for proper nouns not already in the entity registry. "Aanya's mum Sarah offered to help with the party" — the twin knows Aanya (Friend-2), but "Sarah" is new. The LLM proposes: `{name: "Sarah", type: "person", suggested_label: "Person-7", relationship: "parent of Friend-2", confidence: 0.85}`. This is written to `entity_registry` with `confirmed = false`. Next time a family member interacts with Memu, it asks: "I noticed someone called Sarah in the family chat — is she Aanya's mum?" One tap to confirm.

**Job 2: Context Summarisation.** Over a week, the family group might have 200 messages. Most are noise ("ok", "👍", "on my way"). The LLM reads the full batch and produces a structured weekly summary: key decisions, upcoming events mentioned, action items, notable context. This summary is written back to `context_entries` as a high-quality compressed entry with source `summary_weekly`. This is what Claude will primarily reference for older context — not 200 raw messages.

**Job 3: Embedding Generation.** Each new context entry (and each new summary) gets a vector embedding generated via a lightweight embedding model (e.g., `nomic-embed-text` running locally on Ollama, or via an embedding API). The embedding is stored in the `embedding` column of `context_entries` (pgvector). This powers semantic search at query time.

**Job 4: Morning Briefing Assembly.** The LLM gathers today's calendar events, yesterday's unprocessed emails, the latest weekly summary, the shopping list, and any pending reminders. It assembles a raw briefing, which is either finalised by the local LLM (2-3 minutes, but nobody's waiting at 2am) or sent to Claude Haiku for polishing (2 seconds, fraction of a penny). The finished briefing is scheduled for 7am delivery to the family WhatsApp group via Baileys.

### 14.4 Phase 3: Retrieval (Query Time, Real-Time)

When a family member asks Memu a question, the Intelligence Orchestrator assembles context from the database. This is where the architecture must be efficient — the family is waiting for a response.

**Step 1: Semantic search.** The query is embedded (same model as Job 3). pgvector finds the top 10 most semantically similar context entries. This catches relevant information regardless of keyword matches — "What should we do for Rach's birthday?" finds the paddleboarding mention even though "birthday" wasn't in that message.

**Step 2: Temporal context.** Always include today's calendar events regardless of query. If the query references time ("this week", "Thursday", "next month"), expand the calendar window accordingly.

**Step 3: Recent context.** Include the last 24 hours of raw group chat messages (they haven't been summarised yet). For older context, include the weekly summaries rather than raw messages.

**Step 4: Conversation history.** Include the last 5-10 messages from this user's conversation with Memu (for multi-turn coherence).

**Step 5: Twin translation.** All assembled context is translated through the twin: real names → anonymous labels. The query itself is translated. The system prompt is prepended.

**Step 6: Prompt caching.** The system prompt and twin persona descriptions are stable across requests — they change rarely. These are cached using Anthropic's prompt caching API, reducing input token costs by up to 90% for repeated content. Only the dynamic portions (the query, the retrieved context, the conversation history) are billed at full rate.

**Step 7: Model routing.** The orchestrator selects the model based on the profile: Haiku for children (fast, cheap, safe), Sonnet for adults (powerful, nuanced). For simple queries ("add milk to the list"), the orchestrator can route to Haiku even for adults — detectable via a lightweight intent classifier or keyword match.

**Step 8: API call.** The fully assembled, anonymous, cached prompt goes to Claude. Response arrives in 2-4 seconds.

**Step 9: Action detection.** The orchestrator parses the response for action instructions (calendar events, reminders, shopping list changes). If found, these are validated against the approval framework (Section 3.2).

**Step 10: Reverse translation.** The anonymous response is translated back through the twin: anonymous labels → real names. "Child-1's Activity-3 at Location-2" becomes "Robin's swimming at the Leisure Centre."

**Step 11: Delivery and storage.** The response is sent via WhatsApp (or PWA). The full audit trail is stored: original message, translated message, enriched prompt, raw response, translated response, entity mappings used, context sources referenced, model used, token counts, latency.

### 14.5 The Full Picture

```
DAYTIME (every message, real-time, no LLM):
  WhatsApp group msg → Baileys → gateway → context_entries table
  Calendar event      → OAuth   → gateway → context_entries table
  Email               → IMAP    → gateway → context_entries table

OVERNIGHT (2am batch, local LLM or Haiku):
  Ministral/Haiku reads context_entries →
    Job 1: Entity detection   → entity_registry (pending confirmation)
    Job 2: Weekly summary     → context_entries (compressed)
    Job 3: Embeddings         → context_entries.embedding (pgvector)
    Job 4: Morning briefing   → scheduled for 7am via Baileys

QUERY TIME (interactive, Claude Sonnet/Haiku):
  User msg → Baileys → gateway identifies user →
    Semantic search (pgvector) + temporal + recent + history →
    Twin translates all → prompt caching applied →
    Model routed (Haiku/Sonnet) → Claude API →
    Response parsed for actions → twin reverse-translates →
    Delivered via WhatsApp → full audit stored in PostgreSQL

MORNING (7am, scheduled):
  Pre-generated briefing → Baileys → family WhatsApp group
```

PostgreSQL is the single brain. Everything writes to it. Everything reads from it. Ministral and Claude never talk to each other — they both talk to the database. Ministral makes the database smarter overnight. Claude uses that smarter database during the day.

---

## 15. Alignment with Best Practices

### 15.1 Anthropic Architecture Patterns

The Memu architecture aligns with Anthropic's recommended patterns for production Claude applications:

**RAG with Contextual Retrieval.** Anthropic's research shows that combining semantic embeddings with BM25 keyword search reduces failed retrievals by 49%, and adding reranking improves this to 67%. Memu's context retrieval should implement both: pgvector for semantic search and a BM25 index on `context_entries.content` for keyword matching, with results merged via rank fusion. The overnight summarisation (Job 2) is a form of Anthropic's "Contextual Retrieval" — adding context to chunks before they're embedded, which Anthropic's own research shows dramatically improves retrieval quality.

**Prompt Caching.** Anthropic's caching feature reduces costs by up to 90% for repeated prompt content. Memu's system prompt, twin persona descriptions, and content rules are highly cacheable — they change rarely. The dynamic context (query + retrieved entries + conversation history) is the only portion billed at full rate. For a family sending 30 queries/day, this reduces the effective system prompt cost to near-zero after the first request.

**Model Routing.** Anthropic recommends using the cheapest model that meets quality requirements. Memu's routing strategy (Haiku for children, Sonnet for adults, with intent-based downgrade to Haiku for simple adult queries) follows this pattern. For multi-agent architectures, Anthropic suggests Sonnet/Opus as orchestrator with Haiku as parallel worker — Memu's overnight batch processing (Haiku) with interactive queries (Sonnet) follows this principle.

**Agentic Architecture with Human-in-the-Loop.** Anthropic's CCA exam domain emphasises designing approval flows in agentic systems. Memu's four-tier approval framework (auto-execute, notify-and-execute, request-approval, never-auto) directly implements this pattern. The capability envelope (AI instructs, gateway executes) is a production safety pattern that prevents the AI from having direct credential access.

**Context Management.** Anthropic warns about "context rot" — degradation of response quality as context windows fill. Memu addresses this through the overnight summarisation pipeline: raw messages are compressed into structured summaries, keeping the active context window lean. The 180K token guideline (staying under premium pricing thresholds) is naturally met because family context per query is typically 2-5K tokens of retrieved entries, not the full context store.

**Tool Design.** Anthropic's best practice is single-responsibility tools with clear descriptions, strong input validation, and structured output formats. Memu's action types (calendar_create, reminder_set, shopping_add, etc.) follow this pattern — each is a discrete, well-defined capability with a clear contract.

### 15.2 What We Should Add (Future Slices)

**MCP Integration.** The Model Context Protocol is Anthropic's standard for connecting Claude to external services. Memu's observers (calendar, email, photos) could be implemented as MCP servers, making them reusable components that any MCP-compatible client could use. This is a future architecture improvement, not a launch requirement.

**Extended Thinking.** For complex queries (scheduling conflicts, multi-factor gift recommendations), enabling Claude's extended thinking mode would improve response quality. This is a per-request flag that can be enabled when the intent classifier detects complexity.

**Evaluation System.** Anthropic recommends structured evaluations for production AI. Memu should implement automated quality checks: did the twin translation catch all entities? Did the response contain any un-translated PII? Was the context relevant to the query? These can run as batch evaluations on daily conversation logs.

---

## 16. Build Plan

### Slice 1: The Gateway + Twin (Weekend 1-2)

**Build:** Node.js/Fastify gateway. Baileys WhatsApp connection. Profile system. Entity registry with configured entities. Twin translation (inbound + outbound). Claude API integration. PostgreSQL context store. Message storage with full audit trail.

**Deliverable:** Text Memu on WhatsApp. It responds via Claude. Your name, your school, your address — all translated to anonymous labels. The Claude API log shows zero PII. The conversation is stored locally.

**Validation:** Send "Can Robin go to Ridgeway Primary's sports day?" Verify the API call contains "Can Child-1 go to School-1's sports day?" Verify the response comes back with real names.

### Slice 2: Family Profiles + Child Safety (Weekend 2-3)

**Build:** Multi-user profiles (admin, adult, child). Child-specific system prompt. Response filters. Alert system. Basic parent dashboard (web UI). Per-user conversation privacy.

**Deliverable:** Robin texts Memu and gets age-appropriate answers. You get alerts if anything is flagged. Your wife's conversations are private from yours.

### Slice 3: Context Observation + Morning Briefing (Weekend 3-4)

**Build:** WhatsApp group observer. Google Calendar observer. Context enrichment in prompt pipeline. Auto-entity detection (new names in group chat proposed for registry). Morning briefing generator. Briefing delivery to family group.

**Deliverable:** Memu knows what's on the calendar. It mentions things from the family group chat. The morning briefing arrives at 7am with useful, synthesised family intelligence.

### Slice 4: Agentic Actions (Weekend 4-5)

**Build:** Action detection in Claude responses. Action executor (calendar, reminders, shopping). Approval framework. Confirmation flow via WhatsApp.

**Deliverable:** "Add Robin's dentist to the calendar for Thursday 3:30" → Memu creates the event, sends confirmation. "Remind me about the consent form tomorrow morning" → Reminder arrives.

### Slice 5: Email + Documents + Proactive Engine (Week 5-6)

**Build:** IMAP email observer. PDF/document ingestion. Proactive engine (temporal scanning, conflict detection, nudges). Email context in morning briefing.

**Deliverable:** Forward a school newsletter → it appears in tomorrow's briefing. Calendar conflict detected → nudge sent to relevant parent.

### Slice 6: Setup Wizard + Cloud Tier + Open Source (Week 6-8)

**Build:** First-run setup wizard. Docker Compose packaging. Multi-tenant cloud infrastructure (Memu Cloud tier). Encrypted twin storage for cloud tier. Data export for migration to self-hosted. README, documentation, GitHub release. Substack post.

**Deliverable:** Your friend signs up at memu.digital, scans a QR code, and has Memu working in 10 minutes. Or runs `docker compose up` on their own hardware in 15 minutes.

---

## 17. What This Does NOT Cover (Deliberately)

- **Voice input/output** — Text only for MVP. Future slice.
- **React Native app** — WhatsApp IS the app. Dashboard is a web page.
- **Photo context** — Tier 2+ only. Requires Google Photos API or Immich. Future slice.
- **Full sovereignty stack** — Matrix, Immich, Baikal integration remains for Tier 3. Existing infrastructure preserved.
- **Multi-family coordination** — Single family per instance. Future slice.
- **WhatsApp Business API** — Not needed. Baileys uses WhatsApp Web protocol.

---

## 18. Competitive Position

| Capability | Nori | OpenClaw | ChatGPT | Memu |
|---|---|---|---|---|
| Family-native profiles | Shared | Single user | Per-user | Family: adult + child |
| Privacy between members | No | N/A | No | Yes (per-user twin partitions) |
| Data sovereignty | Cloud only | Self-hosted | Cloud only | Cloud → Self-hosted gradient |
| Privacy architecture | Policy ("we won't look") | Application-level | Policy | Structural (twin anonymisation) |
| Agentic actions | Within its app | Full system access | Limited | Sandboxed via capability envelope |
| Child safety | None | None | 13+ only | Pedagogical (MyDigitAlly) |
| Zero migration | New app required | Technical setup | New app | WhatsApp contact |
| Proactive intelligence | Yes (within app) | Heartbeat scheduler | No | Yes (across all observed sources) |
| Open source | No | Yes (MIT) | No | Yes (AGPLv3) |

**Memu is the only product that combines: family coordination, structural privacy, agentic capability, child safety, and zero migration — where the AI never learns who the family is.**

---

## 19. Success Criteria

1. Robin texts Memu and prefers it to asking you or Googling.
2. Rach texts Memu and says "this is actually useful" without prompting.
3. You use Memu at midnight for something personal and feel confident the conversation is private.
4. Rach asks "what's happening this week?" and Memu synthesises calendar + WhatsApp + email into a useful answer.
5. The morning briefing arrives and someone acts on it.
6. Memu proactively warns about a scheduling conflict before anyone notices.
7. Memu creates a calendar event correctly from a natural language WhatsApp message.
8. A beta family runs Memu Cloud and has it working in 10 minutes.
9. The Claude API logs contain zero real family names, schools, or addresses.
10. A parent reviews the entity registry and the PII audit trail and trusts the system.

---

## 20. The One-Line Pitch

**Memu is the Family Chief of Staff that never learns your name. It coordinates your life through WhatsApp, acts on your behalf, and runs on hardware you control — or our cloud, where we can't see your identity either.**

---

## 21. The Vision

Self-hosting is the answer. But self-hosting can't be the starting point for most families.

Memu starts where families are — in WhatsApp, on cloud infrastructure, with zero migration. It delivers value on day one. And it provides a gradient toward full sovereignty: from cloud, to VPS, to home hardware, to complete independence.

Every family that starts on Memu Cloud can graduate to self-hosted. The code is identical. The data is exportable. The twin is portable.

Nori proved families want a Chief of Staff. OpenClaw proved people want AI that acts. Memu combines both — and adds the one thing neither can offer: the architectural guarantee that the AI works for the family, and only the family.

We, not them.

---

*"The question isn't whether families need AI coordination — Nori proved they do. The question is whether the architecture that delivers that coordination should require uploading your family's complete life to a startup's server. Memu says no. Not as a policy. As a mathematical guarantee."*

*— Hareesh Kanchanepally, "We, Not Them," March 2026*
