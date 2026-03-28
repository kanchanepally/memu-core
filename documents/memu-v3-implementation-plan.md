# Memu v3: Definitive Implementation Plan
## From Working Prototype to Consumer Product

**Date:** March 26, 2026
**Author:** Hareesh Kanchanepally + Claude
**For:** Gemini (CTO / Co-builder)
**Status:** Slice 1 shipped. WhatsApp connected. Twin translation verified. Claude responding.

---

## Part 1: Strategic Context

### Where We Are

Slice 1 is live. A WhatsApp message goes in, the Anonymous Family Digital Twin translates real names to anonymous labels, Claude responds intelligently, the twin translates back, and the response arrives on WhatsApp with real names restored. The core pipeline works. Six product managers and technical leaders at Hareesh's FTSE 100 company said "I want this" when they heard what it does — unprompted, in a single day.

### Why This Exists (And Why Nobody Else Has Built It)

**Anthropic won't build it** because a product that minimises what the cloud sees is adversarial to their per-token revenue model. They want more context in every API call, not less.

**Google won't build it** because a Family Chief of Staff that acts on your behalf cannibalises their advertising model — every question answered by Memu is a Google search that doesn't happen.

**Apple won't build it** because their security model is per-device, per-user. A shared family brain that sees across multiple family members' calendars and conversations is philosophically foreign to their architecture.

**Nori won't add privacy** because their VC investors need a return, and structural privacy (where the company can't see user data) makes the product harder to improve, harder to monetise, and harder to value.

**OpenClaw/NanoClaw won't serve families** because they're built for individual technical users with full system access — the opposite of a multi-user family product with child safety guardrails.

Memu exists in a structural gap that no existing player is incentivised to fill.

### The Nori Playbook (What We Learn, What We Reject)

Nori's model: core tools free (calendar, tasks, shopping lists), AI features freemium (generous daily quota, pay for power). No app installation barrier — available on iOS, Android, and web. 100,000 families in two months of beta.

**What we adopt:** Frictionless onboarding. Free tier with real value. No app store dependency. Conversational setup. The family never configures infrastructure.

**What we reject:** All family data on Nori's servers. No privacy between family members. No self-hosting path. No child-specific safety framework. No data portability.

**What we add that Nori can't:** The Anonymous Family Digital Twin. Per-member privacy. Child safety with parental visibility. A graduation path from cloud to full sovereignty. Open source codebase for verifiability.

---

## Part 2: The Product (What Families See)

### memu.digital — The Consumer Experience

A family visits memu.digital. They see:

> **"Your family's Chief of Staff. Private by design."**
> 
> Memu coordinates your family's calendar, school emails, and daily chaos. Talk to it on WhatsApp or in the Memu app. The AI never learns your name.
>
> **[Start Free →]**

They click Start Free. Here's what happens:

**Step 1: Create account.** Email and password. Nothing else. (This creates their encryption key for the twin.)

**Step 2: Family setup.** A beautiful onboarding wizard asks: "What's your name?" → "Who else is in your family?" → "Any children? What are their names and ages?" → "What's your school name and address?" (Seeds the entity registry for twin translation.) 3 minutes, conversational, friendly.

**Step 3: Choose your front door(s).** Two options, both enabled by default:

- **WhatsApp:** Memu displays a QR code. Open WhatsApp → Linked Devices → scan. Memu becomes a WhatsApp contact. (We provide the number — families don't buy a SIM.)
- **Memu App (PWA):** Tap "Add to Home Screen" from memu.digital. A full-screen app icon appears on their phone alongside WhatsApp. No app store. No download. Instant.

Both are first-class. WhatsApp for quick questions on the move. The Memu app for the full experience — morning briefing dashboard, shopping list, family calendar view, document upload, and the child's safe interface.

**Step 4: Connect calendar (optional).** "Want me to know your family's schedule? Tap this link to connect Google Calendar." One-tap OAuth. Or skip — they can connect later.

**Step 5: Done.** "You're all set. Try asking me: 'What's happening this week?' or 'Add milk to the shopping list.' Your morning briefing arrives at 7am tomorrow."

**Total time: 5 minutes. Zero friction points the family has to solve themselves.**

### The Free Tier

Every family gets, for free, forever:

- Private AI conversations for each family member via WhatsApp AND the Memu PWA
- Anonymous twin translation on every query (the core privacy guarantee)
- Shopping list management
- Basic family memory ("Remember: Robin's allergic to nuts")
- Child-safe interface via PWA (memu.digital/kids — no WhatsApp needed for children)
- **10 AI queries per day** (enough to be useful, creates desire for more)

### The Paid Tier (£8/month)

Unlimited AI queries. Plus:

- Morning briefing delivered to the family WhatsApp group at 7am
- Google Calendar observation (knows your schedule)
- Email observation (knows about school letters and appointments)
- Proactive conflict detection and nudges
- Agentic actions (create calendar events, set reminders from WhatsApp)
- Priority response times
- Parent dashboard with child conversation visibility

**Why this pricing works:** Nori's free tier covers basic organisation tools. Memu's free tier covers basic AI with privacy. The upgrade trigger for both is the same: "I want this to be smarter and more proactive." But Memu's paid tier delivers something Nori cannot — the morning briefing synthesised across WhatsApp + calendar + email, with the guarantee that the AI never saw your real names.

### The Memu PWA (First-Class Interface)

The PWA at memu.digital is not a fallback for when WhatsApp breaks. It's a co-equal front door — the product's home.

**For adults:** The PWA is where you see the full morning briefing with calendar integration and action items. Where the shopping list lives as a proper interactive list. Where you review conversation history with rich formatting. Where you upload documents (school letters, PDFs). Where you manage settings. Where you see the entity registry and verify what's being anonymised. Quick questions happen on WhatsApp. Management and depth happen on the PWA.

**For children:** The PWA IS Memu. A child without WhatsApp opens memu.digital/kids on their tablet, logs in with a PIN, and sees a friendly "Ask Memu" box. Same twin translation. Same Claude Haiku routing. Same safety filters. Different front door. Parents see child conversations on the parent dashboard at memu.digital/dashboard.

**Architecture:** The PWA and WhatsApp share everything — same gateway, same twin, same context engine, same database. A message sent on WhatsApp appears in the PWA conversation history. A document uploaded on the PWA enriches WhatsApp responses. They are two windows into the same brain.

**Why both from day one:** Nori built their own app because they understood that owning your interface is owning your product. If Memu only exists inside WhatsApp, it's a WhatsApp plugin, not a product. The PWA is what makes Memu a product with its own identity, its own home, and its own resilience against platform dependency.

---

## Part 3: Technical Architecture (What We Build)

### Multi-Tenancy

Each family is a tenant. On Memu Cloud, all families share the same Hetzner infrastructure, but their data is isolated:

**Database isolation:** Each family gets a `family_id` column on every table. All queries are scoped by `family_id`. There is no way for Family A to query Family B's context, profiles, or conversations. This is enforced at the database layer (Row-Level Security in PostgreSQL), not just the application layer.

```sql
-- Row-Level Security: every table is scoped to the authenticated family
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_isolation ON profiles
  USING (family_id = current_setting('app.current_family_id')::text);
```

**Twin isolation:** Each family has its own entity registry, its own personas, its own relationship graph. Family A's "Child-1" is completely separate from Family B's "Child-1."

**WhatsApp isolation:** Each family connects via their own Baileys session. Messages from Family A's WhatsApp group never cross into Family B's context. Baileys sessions are keyed to the family's assigned WhatsApp number.

### API Key Management and Cost Control

**Single Anthropic API key, owned by Memu.** Families never see, manage, or pay for API access directly. Memu holds one organisational API key (Tier 3 or Tier 4 for sufficient rate limits) and routes all family queries through it.

**Per-family rate limiting:**
- Free tier: 10 queries per day per family (hard cap in application layer)
- Paid tier: 100 queries per day per family (soft cap — warn at 80, hard stop at 150)
- Per-user within family: children default to 30 queries/day

**Per-family cost tracking:** Every API call records `family_id`, `profile_id`, model used, input tokens, output tokens, cached tokens. The dashboard shows families their usage. Internal analytics track per-family cost to ensure margins stay healthy.

**Model routing for cost optimisation:**
- Children: always Claude Haiku ($1/$5 per MTok) — fast, cheap, safe
- Adults, simple queries (shopping list, reminders, factual recall): Claude Haiku
- Adults, complex queries (scheduling, planning, personal advice): Claude Sonnet ($3/$15 per MTok)
- Intent detection: a lightweight classifier (keyword + regex, not LLM) determines query complexity and routes accordingly

**Prompt caching:** The system prompt and twin persona block are identical across requests for the same family. Anthropic's prompt caching reduces their cost by up to 90% after the first request. For a family sending 30 queries/day, the system prompt is effectively free after query #1.

**Abuse prevention:** If a family's usage pattern looks anomalous (e.g., automated scripting, thousands of queries), the rate limiter flags it. No family should ever approach Anthropic's organisational rate limits because per-family caps are far below them.

### WhatsApp Number Provisioning

For the beta (first 10 families): Hareesh manually buys PAYG SIMs and assigns one per family. Each SIM costs £1-5. This doesn't scale but it validates the product.

For scale (50+ families): Memu uses a VoIP provider (Twilio, MessageBird, or a UK provider like Andrews & Arnold) to programmatically provision virtual numbers. Each family gets a unique number assigned during onboarding. The Baileys session connects to this number automatically. The family adds it to their contacts and never thinks about where the number came from.

Cost per number: approximately £1-2/month via VoIP. This is included in the £8/month subscription — the family never sees it.

### Infrastructure

**Hetzner CPX31 (4 vCPU, 8GB RAM):** Handles 100-200 families. Runs the Node.js gateway, PostgreSQL with pgvector, and all Baileys sessions. Cost: ~€16/month.

**Scaling beyond 200 families:** Add a second CPX31. Use a simple load balancer. Baileys sessions are stateful (one WebSocket per family), so families are pinned to a specific instance. PostgreSQL can be moved to a dedicated managed database when needed.

**Backups:** Automated daily PostgreSQL backups to Hetzner's object storage. Each family's data is restorable independently.

### Security

**HTTPS everywhere:** memu.digital served via Cloudflare (free tier) with TLS. Dashboard, PWA, OAuth callbacks — all HTTPS.

**Secrets management:** Anthropic API key, database credentials, OAuth client secrets stored as environment variables, never in code, never in logs.

**Input validation:** All WhatsApp messages are sanitised before processing. SQL injection prevention via parameterised queries. XSS prevention on the dashboard.

**Audit trail:** Every admin action, every API call, every twin translation logged with timestamps. Append-only for the audit table.

---

## Part 4: Data Privacy and GDPR (The Competitive Moat)

### The Privacy Architecture

This is not a feature. It is the product's structural differentiator and its legal compliance framework simultaneously.

**What Claude (Anthropic) receives:** Anonymous queries. "What should we get Child-1 for their birthday? Context: Adult-2 mentioned Activity-7 last month. Calendar shows birthday in 3 weeks." Anthropic's servers process this. Under GDPR Article 26 (Recital 26 on anonymisation), anonymous data is not personal data. Memu is not transferring personal data to a US processor — it is transferring anonymous queries.

**What Memu's servers hold:** The entity registry (the mapping between real names and anonymous labels), conversation history, family profiles, observed context. This IS personal data. Memu is the data controller. Hetzner (Germany, EU) is the data processor for hosting. Both are fully GDPR-compliant entities.

**What the family controls:**
- Connect/disconnect any data source at any time (calendar, email, WhatsApp group)
- View the full entity registry (see exactly what anonymous labels map to)
- View the PII audit trail (see exactly what was sent to Claude on each query)
- Export all their data (full archive, one click)
- Delete their account (complete data purge, immediate)
- Each adult can leave unilaterally without the other's permission

### Compliance Checklist

- [ ] ICO registration as data controller (£40/year, UK)
- [ ] Privacy policy on memu.digital (plain English, what we collect, why, where, who sees it, rights)
- [ ] Terms of service (liability, acceptable use, data handling)
- [ ] Cookie policy (minimal — the dashboard uses session cookies only)
- [ ] Data Processing Agreement with Hetzner
- [ ] Anthropic API terms review (confirm no training on API inputs — currently confirmed)
- [ ] DPIA (Data Protection Impact Assessment) for the twin translation architecture
- [ ] Consent records stored per family (timestamp of each data source connection)

### The DPO-Ready Answer

When your colleague who heads data protection asks "How do you handle personal data?":

"Family data is stored on EU infrastructure (Hetzner, Germany). Every AI query is anonymised through a deterministic translation layer before it reaches any cloud AI provider. The AI receives 'Child-1 has Activity-3 at Location-2' — never real names, schools, or addresses. Under GDPR Recital 26, anonymous data is not personal data, so the AI query itself is outside GDPR scope. The entity registry that maps anonymous labels to real identities is encrypted at rest and scoped per-family with PostgreSQL Row-Level Security. Families can view, export, and delete their data at any time. Each connected data source (calendar, email, WhatsApp group) requires separate explicit consent that can be revoked independently."

---

## Part 5: Context Engine Architecture (Slice 2 and Beyond)

### The Provider Pattern

Every context source implements a common interface. This means adding Google Calendar, Baikal, Apple iCloud, Outlook, or any future provider is a matter of writing one adapter — the orchestrator doesn't change.

```typescript
interface ContextProvider {
  name: string;
  type: 'calendar' | 'email' | 'photos' | 'chat' | 'documents';
  connect(config: ProviderConfig): Promise<void>;
  disconnect(): Promise<void>;
  sync(): Promise<ContextEntry[]>;
  getStatus(): ProviderStatus;
}
```

### Slice 2a: Context Retrieval + Manual Seeding (This Week)

**What to build:** The context retrieval and prompt enrichment pipeline. Before every Claude call, the orchestrator:
1. Generates a vector embedding of the incoming message
2. Queries `context_entries` via pgvector for semantically similar entries
3. Retrieves today's calendar events (if calendar is connected)
4. Retrieves recent context (last 24 hours of observed messages)
5. Retrieves the user's last 5 conversation messages (multi-turn coherence)
6. Translates all retrieved context through the twin
7. Injects the anonymous context into the Claude prompt
8. Applies prompt caching on the system prompt + persona block

**How to test without observers:** Seed context manually. When a family member texts "Remember: Robin's school starts at 8:45am", the gateway stores this as a context entry with an embedding. Next time anyone asks about school times, semantic search finds it and injects it.

**Validation:** Ask "What time does Robin need to be at school?" and get the correct answer from seeded context.

### Slice 2b: The Memu PWA (Same Week as 2a)

**What to build:** memu.digital as a Progressive Web App — a first-class interface alongside WhatsApp, not a fallback.

**The adult experience (memu.digital):**
- Login with email/password (same account as WhatsApp setup)
- "Ask Memu" conversation interface with full message history (including messages from WhatsApp — same database)
- Shopping list (interactive — add, check off, clear)
- Morning briefing display (when Slice 3 is built, this is where it renders richly)
- "Add to Home Screen" prompt for mobile users

**The child experience (memu.digital/kids):**
- PIN login (set by parents)
- Large, friendly "Ask Memu" box
- Conversation history with age-appropriate design
- No access to adult features, settings, or other family members' conversations

**Technical:** Served by the same Fastify gateway on port 3100. Static HTML/CSS/JS in `src/dashboard/public/`. The conversation API endpoint (`POST /api/message`) accepts messages from both WhatsApp (via Baileys) and the PWA (via HTTP). Both write to the same `messages` table. The PWA reads from the same table to display conversation history. The channel field on each message records whether it came from WhatsApp or the web.

**Validation:** Send a message from WhatsApp. Open the PWA. See it in your conversation history. Send a message from the PWA. See the response. Both channels work. Both show the same history.

### Slice 2c: Google Calendar Observer (Next Week)

**What to build:** Google Calendar OAuth flow + polling observer.

1. OAuth consent screen registered at Google Cloud Console (one-time setup for Memu as a service)
2. During family onboarding, Memu sends a WhatsApp message with an OAuth link: "Want me to know your schedule? Tap here to connect Google Calendar." (Also available as a button in the PWA settings.)
3. Family taps link → Google sign-in → grants read-only calendar access → redirect back to memu.digital with auth code
4. Gateway exchanges code for OAuth token, stores encrypted per-family
5. Observer polls Google Calendar API every 15 minutes
6. New/changed events written to `context_entries` with source `google_calendar`
7. Events are translated through the twin before any AI query

**Also build:** CalDAV provider (for Baikal on Hareesh's Z2 and for Tier 2/3 self-hosters). Same interface, different implementation.

**Validation:** Ask "What's happening Thursday?" on WhatsApp OR on the PWA and get the answer from your actual Google Calendar.

### Slice 2d: WhatsApp Group Observer (Following Week)

**What to build:** The Baileys connector already receives group messages. Currently it ignores them unless Memu is mentioned. Change this: write observed messages to `context_entries` with source `whatsapp_group`. Apply the allowed-groups filter (only observe groups on the allowlist). Auto-detect new entities in group messages and propose them for the registry.

**Validation:** Rach says "Swimming is cancelled Thursday" in the family group. You ask Memu (on WhatsApp or PWA) "Is Robin's swimming on this week?" Memu answers correctly from group context.

### Slice 3: Morning Briefing (Week After)

**What to build:** A cron job (node-cron, runs daily at the family's configured time) that:
1. Gathers today's calendar events from `context_entries`
2. Gathers yesterday's unprocessed emails (if email observer connected)
3. Gathers recent group chat highlights (last 24 hours)
4. Gathers the shopping list
5. Translates all context through the twin
6. Sends the anonymous context to Claude Haiku with a briefing-generation prompt
7. Translates the briefing response back through the twin
8. Delivers via BOTH channels: WhatsApp group message AND rendered as a rich card on the PWA home screen

**Validation:** The family wakes up to a WhatsApp message from Memu summarising the day. They open the PWA and see the same briefing rendered beautifully with calendar items, action buttons, and the shopping list. Someone acts on it.

### Slice 4: Agentic Actions

**What to build:** Action detection in Claude responses, the approval framework, and action executors for calendar events, reminders, and shopping list. Actions can be triggered from either channel. Approval requests arrive on WhatsApp ("Shall I add this to the calendar? Reply Yes/No") and/or as interactive buttons on the PWA.

### Slice 5: Document Ingestion (Via WhatsApp + PWA Upload)

**What to build:** Families forward documents to Memu through the channels they already use.

**Via WhatsApp:** Forward a PDF, photograph a school letter, send a screenshot — Baileys receives the media, the gateway processes it:
- Images: OCR via Tesseract (runs locally, free)
- PDFs: Text extraction via pdf-parse
- Extracted text is chunked, embedded (pgvector), and stored in `context_entries` with source `document`
- Twin translates any detected entities

**Via PWA:** A "Upload Document" button on the dashboard. Drag-and-drop or file picker. Same processing pipeline.

**Validation:** Forward a school newsletter PDF to Memu on WhatsApp. Ask "When's the school play?" the next day. Memu answers from the ingested document.

### Slice 6: Email Observer (IMAP)

**What to build:** IMAP polling for school emails and appointment confirmations. Configurable in the PWA settings — enter IMAP server, credentials, and optionally filter by sender (e.g., only emails from @school.co.uk).

### Slice 7: Parent Dashboard (PWA Feature)

**What to build:** The management layer within the PWA at memu.digital/dashboard. PIN-protected for adults. Shows:
- Child conversation history with PII audit trail
- Entity registry (view, edit, confirm pending entities)
- Observer status (which sources are connected, last sync time)
- Usage and cost tracking
- Family profile management
- Data export (full archive download)
- Settings (morning briefing time, connected sources, content rules)

### Slice 8: Consumer Launch

**What to build:** memu.digital landing page, Stripe integration, automated onboarding flow, WhatsApp number provisioning, privacy policy, terms of service. Open beta with the first 50 families.

---

## Part 6: The Sovereignty Graduation Path

### Why This Matters Long-Term

The cloud tier is the hook. The sovereignty tier is the mission.

Every family that starts on Memu Cloud can graduate:

**Step 1 (Cloud, £8/month):** Family data on Hetzner. Twin anonymisation. AI never sees real names. Strongest privacy of any cloud family AI.

**Step 2 (Self-hosted, one-time hardware cost):** Family exports their data from Memu Cloud. Downloads the same memu-core Docker image. Runs it on a £150 mini PC at home. Imports their data. Everything continues exactly as before — same WhatsApp contact, same conversations, same context — but now on their own hardware. Zero-knowledge privacy. Nobody's cloud, nobody's servers, nobody's terms of service.

**Step 3 (Sovereign, existing memu-os stack):** Family replaces Google Calendar with Baikal. Replaces Google Photos with Immich. Replaces WhatsApp with Matrix. Complete independence from every Big Tech platform. This is the Tim Berners-Lee vision — data pods, personal sovereignty, the web as it was meant to be.

Each step is voluntary. Most families will stay at Step 1 forever, and that's fine — they still have the strongest privacy of any family AI product. But the *option* to go further is the philosophical backbone of the product and the community story that differentiates Memu from every commercial alternative.

The open-source codebase (memu-core on GitHub, AGPLv3) makes Step 2 verifiable. Anyone can audit the code, confirm the twin translation works, confirm no data is exfiltrated. This is what "structural privacy" means — it's not a policy you trust, it's code you can read.

---

## Part 7: Differentiation Summary

| Dimension | Nori | Google Family | OpenClaw | ChatGPT | **Memu** |
|---|---|---|---|---|---|
| Family coordination | ✅ Great | ❌ Device control only | ❌ Individual | ❌ Individual | ✅ Full family |
| Privacy architecture | Policy | Policy | App-level | Policy | **Structural (anonymous twin)** |
| Child safety | None | Screen time only | None | 13+ age gate | **Educational framework + parental visibility** |
| Agentic actions | Within app | None | Full (unsafe) | Limited | **Sandboxed (capability envelope)** |
| Zero migration | New app | Built-in ecosystem | Technical setup | New app | **WhatsApp contact** |
| Self-hostable | No | No | Yes | No | **Yes (cloud → home gradient)** |
| Open source | No | No | Yes (MIT) | No | **Yes (AGPLv3)** |
| Free tier | ✅ Core tools | ✅ Family Link | ✅ BYOK | ❌ ($20/mo) | **✅ 10 queries/day** |
| Data portability | No | Limited | Local files | No | **Full export, self-host migration** |
| GDPR position | Data controller (US startup) | Data controller (US corp) | User's responsibility | Data controller (US corp) | **AI queries are anonymous data (not personal data under GDPR)** |

---

## Part 8: Success Milestones

| Week | Milestone | Evidence |
|---|---|---|
| Done | Slice 1: Gateway + Twin | WhatsApp message → anonymous Claude → real response |
| 1 | Slice 2a: Context retrieval works | "Remember X" → later query finds X |
| 1 | Slice 2b: PWA live | memu.digital serves conversations, shopping list, child interface |
| 2 | Slice 2c: Calendar connected | "What's happening Thursday?" answered from real calendar |
| 3 | Slice 2d: Group observation | Group chat context appears in AI responses |
| 4 | Slice 3: Morning briefing | Family acts on the 7am briefing (WhatsApp + PWA) |
| 5 | Slice 4: Agentic actions | "Add dentist to calendar" actually creates the event |
| 6 | Slice 5: Document ingestion | Forward school PDF → Memu answers questions about it |
| 7 | Slice 6: Email observer | School emails appear in morning briefing |
| 8 | Slice 7: Parent dashboard | Child conversations visible, entity registry editable |
| 9 | Slice 8: memu.digital consumer launch | Landing page, Stripe, onboarding flow |
| 10 | 5 beta families onboarded | Hareesh's colleagues from work |
| 11 | Beta validation | 3/5 families would pay, 3/5 would miss it |
| 13 | Open beta launch | 50 families target |
| 16 | Revenue milestone | £400/month recurring |

---

## Part 9: What NOT To Build (Kill List)

- ❌ Desktop app (Electron/Tauri) — not until 200+ paying families
- ❌ SQLite alternative to PostgreSQL — one database, no abstraction overhead
- ❌ Photo observer — not until calendar + email + group chat + documents are validated
- ❌ OneDrive/Google Drive sync — document forwarding via WhatsApp/PWA upload covers 90% of need
- ❌ Custom native mobile app — PWA + WhatsApp covers everything without app store friction
- ❌ Multi-provider LLM router — Claude only until economics force a change
- ❌ Telegram/iMessage connectors — WhatsApp + PWA first, others only if families demand it
- ❌ Local LLM for interactive queries — too slow, Claude API is the product
- ❌ Matrix integration for memu-core — stays in memu-os for Tier 3 only

### Platform Risk Mitigation (Baileys)

Baileys (WhatsApp Web protocol) is an unofficial library. Meta could break it. The mitigation is architectural: the PWA is a co-equal first-class channel from day one. If Baileys breaks:

- Every family already has the PWA on their home screen
- All conversations, context, and the twin are in PostgreSQL — untouched
- Families continue using Memu through memu.digital without interruption
- WhatsApp becomes an optional channel that can be restored when/if Baileys is fixed, or replaced by an official API, DMA interoperability, or Telegram

The PWA is not the backup plan. It's the product. WhatsApp is the frictionless acquisition channel. Losing WhatsApp would hurt growth but not kill the product.

---

*"Six people at work said they want this. That's not a market analysis. That's a queue."*
