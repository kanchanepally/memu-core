# CLAUDE.md - Memu Core Operating Instructions

**Last updated:** March 2026

---

## Project Identity

**Memu Core** is the early-adopter intelligence layer of the Memu platform. It's how families meet their Chief of Staff before committing to hardware.

**What it does:** Family AI coordination via a mobile app (primary), WhatsApp (optional), and Telegram (optional). Claude API provides the intelligence, anonymised through a Digital Twin so Claude never sees real names. Morning briefings, task extraction, shopping lists, calendar integration, child-safe AI, and a Privacy Ledger showing exactly what the AI received.

**What it is NOT:** A standalone product. It's one half of the Memu platform. The other half is memu-os (full self-hosted sovereignty). They compose together — memu-core can dock into memu-os, sharing infrastructure and gaining local AI, photos, and self-hosted chat.

**Stage:** Alpha. Intelligence pipeline working. Mobile app in development. Targeting Kickstarter June 2026.

---

## Platform Context

Memu Core exists within a broader platform. Before building, read:

| Document | Location | What It Covers |
|----------|----------|---------------|
| Platform Vision | `C:\Users\Lenovo\Code\memu-platform\01-VISION.md` | Why Memu exists, positioning, differentiation |
| Architecture | `C:\Users\Lenovo\Code\memu-platform\02-ARCHITECTURE.md` | Layer model, composability, deployment modes |
| Design System | `C:\Users\Lenovo\Code\memu-platform\03-UX-DESIGN-SYSTEM.md` | Tokens, components, interaction patterns |
| Roadmap | `C:\Users\Lenovo\Code\memu-platform\04-ROADMAP.md` | What we're building, when, dependencies |
| Pricing | `C:\Users\Lenovo\Code\memu-platform\05-PRICING-COMMERCE.md` | Tiers, Kickstarter, revenue model |
| Privacy Framework | `C:\Users\Lenovo\Code\memu-platform\06-PRIVACY-SECURITY.md` | Privacy by design, Digital Twin, compliance |
| Agent Framework | `C:\Users\Lenovo\Code\memu-platform\07-AGENT-FRAMEWORK.md` | Chief of Staff model, autonomy levels, safety |

**memu-os operating instructions:** `C:\Users\Lenovo\Code\memu\memu-os\CLAUDE.md`

---

## How We Work: The Operating Model

### The Build Cycle

Same as memu-os: LEARN > DECIDE > BUILD > TEST. Every loop must complete.

```
┌─────────────────────────────────────────────────────────┐
│                    THE MEMU LOOP                         │
│                                                          │
│   LEARN ──────> DECIDE ──────> BUILD ──────> TEST ──┐   │
│     ^                                                │   │
│     │                                                │   │
│     └────────────────────────────────────────────────┘   │
│                                                          │
│   Every loop must complete. No building without          │
│   learning. No learning without testing.                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Session Protocol

**At the start of every session:**

1. Read this file and the relevant platform docs
2. Check `C:\Users\Lenovo\Code\memu-platform\04-ROADMAP.md` -- what's the current priority?
3. Check `C:\Users\Lenovo\OneDrive\Obsidian-Ventures\01-Projects\Memu\decisions\` -- any recent decisions?
4. Run `git log --oneline -10` to see recent work
5. Ask: "What's the most important thing to build tonight?"

**At the end of every session:**

1. Run tests. Do not skip this.
2. Update this CLAUDE.md "Current State" section if anything significant shipped
3. Update `C:\Users\Lenovo\Code\memu-platform\04-ROADMAP.md` if priorities shifted
4. Log decisions in `C:\Users\Lenovo\OneDrive\Obsidian-Ventures\01-Projects\Memu\decisions\`
5. If a new pattern was learned, update platform docs as needed
6. Commit with a clear message describing what changed and why

### The Priority Filter

Before building anything:

```
1. Does this move toward Kickstarter readiness (June 2026)?
   -> If no, STOP. Defer it.

2. Does it complete a thin slice?
   -> Works end-to-end, independently valuable.
   -> If no, scope it down until it does.

3. Can a non-technical parent tell the difference?
   -> If they won't notice it, it's infrastructure, not product.

4. Does it make the demo video better?
   -> The demo video IS the product for Kickstarter.

5. Does it protect privacy by architecture?
   -> If it weakens the Digital Twin or exposes family data, STOP.
```

### What NOT to Build

- Features that only work when WhatsApp (Baileys) is available -- the mobile app must be self-sufficient
- Features that require family data to leave the device unencrypted or un-anonymised
- Frameworks, abstractions, or utilities for hypothetical future use
- Analytics, telemetry, tracking, engagement metrics
- Social features beyond the family boundary
- Gamification of children's AI interactions

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MOBILE APP (Expo)                      │
│           React Native + Gifted Chat + Push               │
│           iOS + Android from single TypeScript            │
│                                                           │
│   Screens: Today | Chat | Lists | Calendar | Ledger      │
│            Kids Mode | Settings                           │
├───────────────────────┬─────────────────────────────────┤
│   OPTIONAL CHANNELS   │                                   │
│   WhatsApp (Baileys)  │  Telegram Bot (official API)     │
│   PWA Dashboard (web) │  Matrix (when docked to memu-os) │
├───────────────────────┴─────────────────────────────────┤
│                                                           │
│   FASTIFY BACKEND (src/index.ts)                         │
│   ├── Auth (email/magic link)                            │
│   ├── /api/message       (chat with Memu)                │
│   ├── /api/dashboard/*   (briefing, stream cards)        │
│   ├── /api/stream/*      (card actions)                  │
│   ├── /api/auth/google   (calendar OAuth)                │
│   ├── /api/export        (data sovereignty)              │
│   ├── /api/family/*      (profiles, detach)              │
│   └── Push notification service (Expo Push)              │
│                                                           │
├─────────────────────────────────────────────────────────┤
│   INTELLIGENCE LAYER                                      │
│   ├── orchestrator.ts   (message pipeline)               │
│   ├── claude.ts         (Claude API, anonymised)         │
│   ├── extraction.ts     (stream card extraction)         │
│   ├── context.ts        (semantic search, pgvector)      │
│   ├── vision.ts         (document/photo extraction)      │
│   └── briefing.ts       (morning briefing generation)    │
│                                                           │
├─────────────────────────────────────────────────────────┤
│   PRIVACY LAYER                                           │
│   └── twin/translator.ts (Digital Twin anonymisation)    │
│       Real names <-> Anonymous labels                     │
│       All translations audited in messages table          │
│                                                           │
├─────────────────────────────────────────────────────────┤
│   DATA LAYER                                              │
│   PostgreSQL 16 + pgvector                                │
│   Local embeddings (Xenova/all-MiniLM-L6-v2)            │
│   Tables: profiles, personas, entity_registry,           │
│   conversations, messages, context_entries,               │
│   stream_cards, actions, alerts, audit_log               │
└─────────────────────────────────────────────────────────┘
```

### Deployment Modes

**Standalone:** `docker compose up` -- brings up Fastify + PostgreSQL. Mobile app connects via HTTPS.

**Docked (into memu-os):** `docker compose -f docker-compose.home.yml up` -- joins memu-os network, shares PostgreSQL instance (separate `memu_core` database), connects to Immich for photo context, Baikal for calendar, Ollama as local AI fallback.

---

## Technology Stack

| Component | Technology | Why This Choice |
|-----------|------------|----------------|
| Runtime | Node.js 20 LTS + TypeScript | Same language across backend and mobile |
| HTTP Server | Fastify v4 | Fast, schema-validated, good DX |
| Mobile App | Expo (React Native) | Fastest path to App Store, TypeScript, OTA updates |
| Mobile Chat UI | React Native Gifted Chat | Proven, 60fps, rich features |
| Push Notifications | Expo Push | Free, reliable, works with EAS |
| AI (adults) | Claude Sonnet (Anthropic SDK) | Capable, structured output |
| AI (children) | Claude Haiku (Anthropic SDK) | Simpler, faster, cheaper, safer |
| AI (vision) | Claude Sonnet Vision | Document/photo extraction |
| Embeddings | Xenova/all-MiniLM-L6-v2 | Local, 384-dim, zero cloud dependency |
| Database | PostgreSQL 16 + pgvector | Vector search + relational in one |
| WhatsApp | @whiskeysockets/baileys | Unofficial but functional; OPTIONAL channel |
| Telegram | Telegram Bot API | Official, free, stable; OPTIONAL channel |
| Calendar | googleapis | Google Calendar OAuth |
| Scheduling | node-cron | Morning briefings, batch jobs |
| Logging | pino | Structured, fast |

---

## Code Standards

### TypeScript

- Strict mode (`"strict": true` in tsconfig)
- Async/await for all I/O (no callback patterns)
- Type definitions for all function signatures and API responses
- No `any` types -- use `unknown` and narrow
- Error handling: catch specific errors, log context, fail gracefully
- Logging via pino, not console.log

### React Native (Mobile App)

- Functional components with hooks (no class components)
- Expo Router for navigation (file-based routing)
- Design tokens imported from shared token file
- System fonts only (no Google Fonts, no custom font loading)
- Accessibility: all interactive elements have accessibilityLabel
- Touch targets: minimum 44x44 points
- Test on both iOS and Android before shipping

### API Conventions

- RESTful routes: `/api/{resource}` (noun, not verb)
- POST for mutations, GET for queries
- Response shape: `{ success: boolean, data?: T, error?: string }`
- Error responses include actionable messages, not stack traces
- All routes validate input (Fastify schema validation)

### Database

- Migrations via schema.sql (auto-loaded in Docker Compose)
- No raw SQL in route handlers -- use parameterised queries via pg Pool
- All timestamps as TIMESTAMPTZ (timezone-aware)
- JSONB for flexible metadata columns
- Foreign keys with CASCADE for referential integrity

### Docker

- Explicit container names (`container_name: memu_core_*`)
- Health checks on all services
- `restart: unless-stopped`
- Volume mounts for data persistence
- No external ports except the Fastify server

---

## Testing

### Before Every Commit

```bash
# 1. TypeScript compiles cleanly
npx tsc --noEmit

# 2. Backend starts and responds
docker compose up -d
curl http://localhost:3000/health

# 3. API endpoints respond correctly
curl -X POST http://localhost:3000/api/message \
  -H "Content-Type: application/json" \
  -d '{"content": "What is happening today?", "profileId": "test"}'

# 4. Check logs for errors
docker compose logs memu-core --tail 50 | grep -i error

# 5. Digital Twin translation works
# Verify messages table shows content_original != content_translated
# Verify entity_translations JSONB is populated

# 6. Mobile app builds (when mobile/ exists)
cd mobile && npx expo export --platform web  # Quick web export test
```

### Test Principles

- **Test the pipeline, not the units.** A thin-slice test that sends a message and verifies it goes through translation, enrichment, Claude, and back is worth more than 20 unit tests on individual functions.
- **Test the Twin.** The Digital Twin is the privacy guarantee. Every new entity type, every edge case (names in URLs, names embedded in forwarded text) needs a test.
- **Test graceful degradation.** What happens when Claude API is down? When WhatsApp disconnects? When the database is unreachable? The app should degrade, not crash.
- **Test cost boundaries.** Verify that budget limits are respected, that Haiku is used for children, that caching prevents duplicate API calls.

### When to Add Tests

- New extraction patterns (school newsletter formats, email types)
- New entity types in the Twin
- New API endpoints
- New stream card types
- Any bug fix (write the test that would have caught it)

---

## Privacy Checklist

Before shipping any feature, verify:

```
[ ] No real names, addresses, schools, or PII sent to Claude API
[ ] Digital Twin translation runs on ALL messages before API calls
[ ] Entity translations are stored in audit trail (messages.entity_translations)
[ ] New data types are classified per 06-PRIVACY-SECURITY.md
[ ] Children's interactions use Haiku model, not Sonnet
[ ] No new telemetry, analytics, or external calls introduced
[ ] Data retention respects configured policies
[ ] Export endpoint includes new data types
[ ] Privacy Ledger can display new interaction types
```

---

## File Structure

```
memu-core/
├── CLAUDE.md                     # THIS FILE - Operating instructions
├── README.md                     # Public-facing: getting started, features
├── LICENSE                       # AGPLv3
│
├── docker-compose.yml            # Standalone deployment (includes PostgreSQL)
├── docker-compose.home.yml       # Docked deployment (joins memu-os network)
├── schema.sql                    # Database schema (auto-loaded)
├── .env.example                  # Environment variable template
├── package.json                  # Backend dependencies
├── tsconfig.json                 # TypeScript config
│
├── src/                          # Backend (Fastify + Intelligence)
│   ├── index.ts                  # Server entry point + API routes
│   ├── db/
│   │   └── connection.ts         # PostgreSQL connection pool
│   ├── channels/
│   │   ├── whatsapp.ts           # Baileys connector (OPTIONAL)
│   │   ├── telegram.ts           # Telegram Bot API (OPTIONAL, planned)
│   │   ├── mobile.ts             # Push notification service (planned)
│   │   └── calendar/
│   │       └── google.ts         # Google Calendar OAuth
│   ├── intelligence/
│   │   ├── orchestrator.ts       # Message pipeline (twin > context > claude > translate)
│   │   ├── claude.ts             # Claude API client + system prompts
│   │   ├── extraction.ts         # Stream card extraction from messages
│   │   ├── context.ts            # Semantic search (pgvector embeddings)
│   │   ├── vision.ts             # Document/photo extraction (Claude Vision)
│   │   └── briefing.ts           # Morning briefing generation
│   ├── twin/
│   │   └── translator.ts         # Digital Twin: real <-> anonymous translation
│   └── dashboard/
│       └── public/               # PWA dashboard (HTML/CSS/JS)
│           ├── index.html        # Landing page
│           ├── dashboard.html    # Briefing + stream cards
│           ├── kids.html         # Child-safe interface
│           └── css/style.css     # Design tokens + component styles
│
├── mobile/                       # Mobile App (Expo/React Native) - PLANNED
│   ├── app.json                  # Expo config
│   ├── package.json              # Mobile dependencies
│   ├── app/                      # Expo Router (file-based routing)
│   │   ├── (tabs)/               # Tab navigation
│   │   │   ├── today.tsx         # Briefing + stream cards
│   │   │   ├── chat.tsx          # Chat with Memu (Gifted Chat)
│   │   │   ├── lists.tsx         # Shopping list + tasks
│   │   │   ├── calendar.tsx      # Family calendar + conflicts
│   │   │   └── settings.tsx      # Preferences, AI config, family
│   │   ├── kids/
│   │   │   └── chat.tsx          # Child-safe AI chat
│   │   ├── ledger.tsx            # Privacy Ledger (what Claude saw)
│   │   └── auth/
│   │       └── login.tsx         # Magic link / email auth
│   └── components/               # Shared React Native components
│       ├── StreamCard.tsx
│       ├── BriefingPanel.tsx
│       ├── ShoppingList.tsx
│       └── tokens.ts             # Design tokens (JS, from shared source)
│
├── documents/                    # Specification & planning
│   ├── memu-core-init-brief.md
│   ├── memu-product-spec-v3-final.md
│   ├── memu-v3-implementation-plan.md
│   └── memu-validation-guide.md
│
└── tests/                        # Tests (planned)
    ├── pipeline.test.ts          # End-to-end intelligence pipeline
    ├── twin.test.ts              # Digital Twin translation
    └── api.test.ts               # API endpoint tests
```

---

## Design System

Memu Core follows the shared Memu design system defined in `C:\Users\Lenovo\Code\memu-platform\03-UX-DESIGN-SYSTEM.md`.

Key rules for this repo:

- **Accent:** `#667eea` to `#764ba2` gradient (NOT teal, NOT any other colour)
- **Fonts:** System fonts only. No Google Fonts. No custom font loading.
- **Mobile:** React Native components use design tokens from `mobile/components/tokens.ts`
- **PWA:** CSS custom properties from `src/dashboard/public/css/style.css`
- **Both must use the same token values.** If you change a colour in one, change it in both.

### Brand Alignment Status

The PWA dashboard currently uses teal (`#0F766E`) and Google Fonts (Inter). These need migrating to the shared design system before any new UI work. This is a prerequisite, not a nice-to-have.

---

## Channel Architecture

The backend serves multiple channels. All channels feed the same intelligence pipeline. No channel is a hard dependency.

```
                    ┌─────────────────┐
                    │  INTELLIGENCE   │
                    │  PIPELINE       │
                    │  (orchestrator) │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          v                  v                  v
   ┌────────────┐    ┌────────────┐    ┌────────────┐
   │ Mobile App │    │  WhatsApp  │    │  Telegram  │
   │ (PRIMARY)  │    │ (OPTIONAL) │    │ (OPTIONAL) │
   │            │    │            │    │            │
   │ Expo Push  │    │  Baileys   │    │  Bot API   │
   │ HTTPS/WS   │    │ Unofficial │    │  Official  │
   └────────────┘    └────────────┘    └────────────┘
```

**Why mobile app is primary:**
- We control the experience (not dependent on WhatsApp's platform decisions)
- Push notifications (reliable, ours)
- App store presence (discoverability)
- Kids mode (safe, contained environment)
- Privacy Ledger (can't show this in WhatsApp)
- Baileys could break at any time -- the mobile app must be fully functional without it

**When WhatsApp breaks:**
- Mobile app continues working with zero impact
- Families who relied on WhatsApp get a push notification: "WhatsApp connection paused. Chat with Memu directly in the app."
- WhatsApp chat export (.txt) can be imported for RAG context

---

## Cost Control

Cloud AI costs money. Families shouldn't worry about bills.

### Default Budget
- Monthly family budget: configurable, default ~5 GBP/month
- Per-query tracking in messages table (tokens_used, latency_ms)

### Model Tiering
| Task | Model | Approximate Cost |
|------|-------|-----------------|
| Adult conversation | Claude Sonnet | ~0.01-0.03 per query |
| Child conversation | Claude Haiku | ~0.001-0.003 per query |
| Stream card extraction | Claude Haiku | ~0.001 per message |
| Document vision | Claude Sonnet | ~0.01-0.05 per document |
| Morning briefing | Claude Sonnet | ~0.02 per briefing |
| Embeddings | Local (Xenova) | 0 (runs in Node.js) |

### Cost Reduction Strategies
- Batch extraction (process group messages in bulk, not real-time)
- Cache identical context queries
- Skip briefing if nothing is scheduled (silence on empty)
- Local embeddings (zero API cost for semantic search)
- If budget exhausted: fall back to keyword search + structured data display

---

## Current State (March 2026)

### Working
- WhatsApp gateway (Baileys) with auto-profile creation (optional on startup)
- Digital Twin anonymisation (bidirectional translation)
- Intelligence pipeline (observe > translate > enrich > reason > respond)
- Claude API integration (Sonnet for adults, Haiku for children)
- Semantic search via pgvector (local embeddings)
- Stream card extraction from messages and documents
- Document vision extraction (school newsletters, photos)
- Morning briefing generation (calendar + stream cards)
- Google Calendar OAuth integration
- URL scraping and context injection
- Data export endpoint
- Household detachment (divorce scenario)
- PWA dashboard (basic: briefing + stream cards + shopping list + chat drawer)
- Kids portal (basic: large-font chat)
- CORS enabled for mobile app connections
- Privacy Ledger API endpoint (`/api/ledger`)
- **Mobile app (Expo SDK 54)** -- 4 tabs (Today, Chat, Lists, Settings), custom chat UI, Privacy Ledger modal, brand icons (three-circle mark), connects to backend via HTTPS
- **Mobile chat → Claude pipeline working end-to-end** (message → Digital Twin → Claude → response)

### Building Now (Critical Path)
1. **Stream card confirm/edit/dismiss** -- human-in-the-middle (P0)
2. **Calendar tab** -- Google Calendar display in app (P1)
3. **Profile avatar → Settings** -- move settings out of tab bar (P1)
4. **Push notifications** -- morning briefing via Expo Push (P1)
5. **Onboarding flow** -- server connect + profile + calendar (P1)
6. **Message persistence** -- chat history across sessions (P1)

### Not Yet Built
- Telegram Bot channel
- WhatsApp export import (RAG context seeding)
- Share Extension ("Share to Memu" from any app)
- Email observer (IMAP)
- Photo observer (Immich integration, when docked)
- Billing/subscription system
- Child safety classification UI (schema exists, frontend doesn't)
- Comprehensive test suite
- Production monitoring

---

## Decision Log (Key Decisions)

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-28 | Build Expo mobile app as primary interface | Baileys is unofficial and fragile. Mobile app gives direct user relationship, push notifications, app store presence. |
| 2026-03-28 | Keep WhatsApp as optional channel, add Telegram | WhatsApp still valuable but not dependency. Telegram Bot API is official, free, stable. |
| 2026-03-28 | Align to shared design system (purple, system fonts) | Brand consistency across mobile app, PWA, memu-os. Teal and Google Fonts must go. |
| 2026-03-28 | Mobile app lives in memu-core/mobile/ | Same repo, same backend. Not a separate product. |
| 2026-03-29 | Upgrade to Expo SDK 54 (React 19, RN 0.81) | Expo Go on phone was v54; SDK must match client. |
| 2026-03-29 | WhatsApp startup made optional | `connectToWhatsApp()` wrapped in try/catch. Mobile app is primary. |
| 2026-03-29 | Unique message IDs for mobile/web | Was using hardcoded 'unknown' as PK, causing duplicate key errors after first message. |
| 2026-03-29 | Settings → profile modal, not tab | Settings is admin, not a daily action. Tab bar should be: Today, Chat, Calendar, Lists. |
| 2026-03-29 | Mobile App Spec created | `memu-platform/08-MOBILE-APP-SPEC.md` — screens, channels, backlog, competitive analysis. |

Full decision log: `C:\Users\Lenovo\OneDrive\Obsidian-Ventures\01-Projects\Memu\decisions\`

---

## Adding New Capabilities

### New API Endpoint
1. Add route in `src/index.ts`
2. Define request/response schema (Fastify validation)
3. Add corresponding mobile screen or component if user-facing
4. Update this CLAUDE.md if it changes the architecture
5. Test: `curl` the endpoint, verify response shape

### New Channel
1. Create `src/channels/{channel}.ts`
2. Implement: receive message, pass to orchestrator, return response
3. The orchestrator is channel-agnostic -- it takes text in, returns text out
4. Add channel-specific delivery (push notif, WhatsApp message, Telegram message)
5. Update the channel architecture diagram in this file

### New Stream Card Type
1. Define the type in extraction prompt (extraction.ts)
2. Add rendering in mobile app (`mobile/components/StreamCard.tsx`)
3. Add rendering in PWA dashboard (`dashboard.html`)
4. Test extraction from a real message
5. Test edit/confirm/dismiss flow

### New Intelligence Pattern (Proactive)
1. Define trigger and action in `07-AGENT-FRAMEWORK.md`
2. Implement in orchestrator or briefing engine
3. Ensure it follows the human-in-the-middle pattern (propose, don't act)
4. Add cost estimate (model, tokens, frequency)
5. Test that it respects AI volume settings (off/quiet/active)

---

## Founder Context

Same as memu-os: Hareesh is a solo founder building in evening sessions. Every session must produce a working thin slice. Prioritise ruthlessly. The goal is Kickstarter June 2026.

When suggesting work, ask:
- Can this be done in one evening session?
- Does it work end-to-end when done?
- Would a parent notice and value it?
- Does it strengthen the privacy story?
- Does it make the demo video better?

---

## License

AGPLv3 - All contributions must be open source.

---

*Maintainer: Hareesh Kanchanepally (@kanchanepally)*
