# CLAUDE.md - Memu Core Operating Instructions

**Last updated:** April 2026

---

## Project Identity

**Memu Core** is the early-adopter intelligence layer of the Memu platform. It's how families meet their Chief of Staff before committing to hardware.

**What it does:** Family AI coordination via a mobile app (primary), WhatsApp (optional), and Telegram (optional). Claude API provides the intelligence, anonymised through a Digital Twin so Claude never sees real names. Morning briefings, task extraction, shopping lists, calendar integration, child-safe AI, and a Privacy Ledger showing exactly what the AI received.

**What it is NOT:** A standalone product. It's one half of the Memu platform. The other half is memu-os (full self-hosted sovereignty). They compose together — memu-core can dock into memu-os, sharing infrastructure and gaining local AI, photos, and self-hosted chat.

**Stage (2026-04-19):** Phases 1, 2, 3.1–3.4 complete. Mobile app personal-use ready post Indigo Sanctuary sprint. Milestone A done (Gemini provider plumbing + extraction → Gemini Flash). Milestone B1 + B2 done (preflight + db-init + docker-compose.home.yml — future scaffolding for B-dock). Active work reshaped into **B-live** (standalone-first on Z2 — own Postgres, own network, own data dir, no touching memu-os Immich/Synapse) → **B-dock** (merge into memu-os's Postgres once pgvecto-rs compatibility is verified) → **B-pod** (per-person LUKS drives in memu-os repo) → Milestone C (Tier-1 hosted for ~20 Founding-50 beta families). Kickstarter is **deferred**; commercial path is Founding-50 paid beta first. **Canonical:** `C:\Users\Lenovo\Code\memu-platform\memu-build-plan.md`.

---

## Platform Context

Memu Core exists within a broader platform. Before building, read:

| Document | Location | What It Covers |
|----------|----------|---------------|
| Platform README | `C:\Users\Lenovo\Code\memu-platform\README.md` | Umbrella entry — start here if you don't know which doc you need |
| Bible | `C:\Users\Lenovo\Code\memu-platform\01-BIBLE.md` | Why Memu exists, the structural privacy imperative, Pod portability promise |
| Architecture | `C:\Users\Lenovo\Code\memu-platform\02-ARCHITECTURE.md` | System topology, Solid-OIDC identity, three-tier model, agent skills |
| Design System | `C:\Users\Lenovo\Code\memu-platform\03-DESIGN-SYSTEM.md` | Indigo Sanctuary — colours, typography, components |
| Roadmap | `C:\Users\Lenovo\Code\memu-platform\04-ROADMAP.md` | Strategic trajectory + pointer to active milestone sequencing |
| Pricing/GTM (canonical) | `C:\Users\Lenovo\Code\memu-platform\Pricing and economics\files\memu-gtm-pricing-funding-strategy.md` | Founding-50 + Family + Family+ + Self-hosted, SEIS funding path, Gemini economics, distribution funnel |
| Privacy Framework | `C:\Users\Lenovo\Code\memu-platform\06-PRIVACY-SECURITY.md` | Privacy by design, Digital Twin, compliance |
| Mobile App Spec | `C:\Users\Lenovo\Code\memu-platform\08-MOBILE-APP-SPEC.md` | Primary mobile surface specification |
| Engineering build plan (cross-repo, canonical) | `C:\Users\Lenovo\Code\memu-platform\memu-build-plan.md` | **Read Parts 0–4 first.** Supersedes the old backlog + supplement + deployment guide. Milestone B is now **B-live / B-dock / B-pod**; active slice is B-live-1 (standalone compose on Z2). |

*Note: 07-AGENT-FRAMEWORK and the original Vision/Pricing/UX-Design-System docs have been archived under `_legacy_archive/` pending V3-style rewrites.*

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
│   IDENTITY LAYER (Solid-OIDC + WebID)                    │
│   ├── webid/server.ts    (/people/:slug Turtle+JSON-LD)  │
│   ├── oidc/provider.ts   (Panva oidc-provider v8, DPoP)  │
│   ├── oidc/adapter.ts    (Postgres durable / mem volatile)│
│   ├── oidc/jwks.ts       (JWKS persisted in oidc_jwks)   │
│   └── oidc/routes.ts     (/oidc/* + /.well-known/*)      │
│                                                           │
├─────────────────────────────────────────────────────────┤
│   DATA LAYER                                              │
│   PostgreSQL 16 + pgvector                                │
│   Local embeddings (Xenova/all-MiniLM-L6-v2)            │
│   Tables: profiles, personas, entity_registry,           │
│   conversations, messages, context_entries,               │
│   stream_cards, actions, alerts, audit_log,               │
│   synthesis_pages, oidc_payload, oidc_jwks               │
└─────────────────────────────────────────────────────────┘
```

### Deployment Modes

**Standalone:** `docker compose up` -- brings up Fastify + PostgreSQL. Mobile app connects via HTTPS.

**Docked (into memu-os):** `docker compose -f docker-compose.home.yml up` -- joins memu-os network, shares PostgreSQL instance (separate `memu_core` database), connects to Immich for photo context, Baikal for calendar, Ollama as local AI fallback.

### Identity: WebID + Solid-OIDC

Each profile is addressable as a WebID: `https://<base>/people/<slug>#me`, where `<base>` is set by `MEMU_WEBID_BASE_URL` (falls back to `PUBLIC_BASE_URL`, then `http://localhost:$PORT`). The profile document at `/people/:slug` is public and content-negotiated (Turtle or JSON-LD), declares `solid:oidcIssuer` = this server, and exposes both `pim:storage` and `solid:storage` for Pod compatibility.

The OIDC endpoints (mounted at `/oidc/*` and `/.well-known/*`) are Panva's `oidc-provider` v8 wrapped inside Fastify via `reply.hijack()`. DPoP, dynamic client registration, PKCE, userinfo, revocation, introspection, and resource indicators are all on. Durable records (clients, grants, initial/registration access tokens, replay detection) are persisted to `oidc_payload`; volatile records (access tokens, auth codes, sessions, interactions) stay in-memory for fresh-after-restart semantics.

Users authenticate at the interaction page with email + bcrypt password (`profiles.oidc_password_hash`). This is distinct from the mobile-app API-key scheme: `POST /api/profile/oidc-password` lets an API-key-authenticated user set or rotate their OIDC login password.

JWKS is generated once on first boot and persisted to `oidc_jwks`. Rotate `MEMU_OIDC_COOKIE_KEYS` before any external deployment.

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
├── skills/                       # Prompt skills (Agent Skills SKILL.md format)
│   ├── extraction/SKILL.md       # Stream-card extraction from chat messages
│   ├── synthesis_update/SKILL.md # Decide+write synthesis page updates
│   ├── synthesis_write/SKILL.md  # Rewrite a single synthesis page
│   ├── reflection/SKILL.md       # Contradiction / stale / unfinished / pattern (Story 2.2)
│   ├── briefing/SKILL.md         # Morning briefing assembly
│   ├── vision/SKILL.md           # Document / photo extraction
│   ├── twin_translate/SKILL.md   # Novel-entity extraction (local, Story 1.5)
│   ├── interactive_query/SKILL.md# System prompt for conversational turns
│   ├── autolearn/SKILL.md        # Per-exchange durable-fact extraction
│   └── import_extract/SKILL.md   # Bulk fact extraction from imported chat
│
├── src/                          # Backend (Fastify + Intelligence)
│   ├── index.ts                  # Server entry point + API routes
│   ├── skills/
│   │   ├── loader.ts             # SKILL.md parser + getSkill() / renderSkill()
│   │   └── loader.test.ts
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

## Current State (April 2026)

### Tool-use Session 1.5 — `findSpaces` + `addCalendarEvent` (2026-04-21)

Two bugs from the 2026-04-20 → 2026-04-21 dogfood pass shipped together as the second local-tools slice. Same harness as Session 1 (router tool loop, Twin invariant, capabilities-first SKILL.md); added two tools and bumped `interactive_query` to v3.

**`findSpaces({ query, category? })`** — closes the class of bug that surfaced as the **Robin/Robins duplicate** (2026-04-21) and the **"Memu feedback log" Space not found** (2026-04-20). When retrieval misses a Space, Claude had no way to discover it and would either (a) give up and ask the user for a URI, or (b) create a second duplicate under a slightly different slug. The tool runs `getCatalogue(familyId, profileId)` (visibility-filtered, same source of truth as the retrieval matcher), translates the anonymous query back through the Twin, case-insensitive substring match across name/slug/description, returns the top 10 as `{uri, title, category, slug, description}` with title+description passed through `translateToAnonymous` before returning to Claude (Twin invariant — outputs stay in the anonymous namespace). SKILL.md v3 rule: **call `findSpaces` before `createSpace` for any person/project/routine the user names by word** — the near-match path (Robin ≈ Robins) is the whole point.

**`addCalendarEvent({ title, start, end, location?, notes? })`** — Memu had Google Calendar **read** (morning briefing) but no write. Added `insertCalendarEvent()` in `src/channels/calendar/google.ts` returning a discriminated union `{ok: true, eventId, htmlLink} | {ok: false, reason: 'not_connected' | 'insufficient_scope' | 'invalid_time' | 'api_error', message}`. OAuth scope extended to include `calendar.events` write — existing tokens (readonly-only) will return `insufficient_scope` and the tool tells the user to reconnect in Settings. ISO 8601 start/end required; title and (location/notes if present) translate through `translateToReal` before the API call. Adult-only today — children's profiles shouldn't schedule events (not explicitly blocked yet; will land with the broader child-role guard next cycle).

**SKILL.md v3.** Capabilities section rewritten for five tools. Added an explicit past-tense-completion rule to `addToList` ("X is done" on a named Space is `updateSpace`, not `addToList`) that folds in the first-turn-misinterpretation observation from 2026-04-20. `findSpaces` block includes the Robin/Robins dedup-by-near-match example verbatim.

**Tests.** `src/intelligence/tools.test.ts` extended from 21 → 33 tests. New coverage: registry now asserts five tools (alphabetical), `findSpaces` schema + four validation branches (missing input, missing query, whitespace-only query, unknown category), `addCalendarEvent` schema (required title/start/end, optional location/notes) + four validation branches (missing input, missing/whitespace title, missing start/end). DB-touching happy paths for both tools deferred to manual QA per the same convention as `updateSpace`. Full suite: **335 tests passing across 22 files** (was 323). TypeScript clean.

**Session 2 (`web_search_20250305`) still queued** behind Session 1 + 1.5 deploy verification on Z2.

### Tool-use wire-up Session 1 — local `addToList` / `createSpace` / `updateSpace` (2026-04-20 evening)

Ships the architectural fix for the whole class of bug that the list reconciler papered over. `interactive_query` can now invoke three local tools mid-turn; tool execution is the source of truth for confirmations.

**Harness.** `src/intelligence/claude.ts` gained `ClaudeToolSchema`, `ClaudeContentBlock` (tool_use / tool_result variants), and passthrough of `tools` + `tool_choice` to the Anthropic SDK. `callClaude()` now returns the full content array + `stop_reason` so the router can loop. `src/skills/router.ts` got a multi-turn tool loop (`MAX_TOOL_ITERATIONS = 5`) that executes tool_use blocks via `ToolDefinition.execute()`, feeds `tool_result` blocks back to Claude, and accumulates tokens/latency across turns. `dispatch({ ..., tools, toolContext })` is the new threading surface; unknown tools return `{ok: false, error: 'unknown tool'}` as a tool_result rather than crashing the loop.

**Tools.** `src/intelligence/tools.ts` registers three executors. `addToList` validates list ∈ {shopping, task}, sanitises items (strips leading "some/a/an/the", caps at 120 chars), calls `translateToReal` per item before `addItem()`. `createSpace` validates title/category/body, translates through Twin, calls `upsertSpace` with confidence=0.6 and `sourceReferences=[message:${messageId}]`. `updateSpace` finds by URI or category+slug, verifies `familyId` match, preserves existing visibility/domains/people/tags, bumps confidence by 0.05. Returns stay structural (`{ok, id, uri, slug, category}`) — real names never flow back into the Claude loop.

**Skill prompt v2.** `skills/interactive_query/SKILL.md` bumped to v2 with an explicit "Your role" section framing Memu as an active knowledge manager (not a chatbot), a "Capabilities" section documenting the three tools with when-to-use examples, and a new Rule 5: "Tool-call success is the source of truth" — replaces the old "Confirm confidently" rule that caused the hallucinated-add regression in commit `9beb97d`'s backstory. Added Rule 9: prefer in-platform over external tools (no more "I should put this in Notion" suggestions when a Space does the job).

**Orchestrator wire-up.** `src/intelligence/orchestrator.ts` passes `interactiveQueryTools` + `toolContext` to `dispatch()` for the interactive_query path and logs tool-call summary as `[TOOL-USE]: addToList:ok createSpace:ok`. `listReconciler` (commit `9beb97d`) stays as a safety net during transition.

**Tests.** `src/intelligence/tools.test.ts` adds 21 tests covering tool-registry shape, schema required-field enums, and validation-branch coverage for all three executors (missing input, unknown list/category, empty items, missing body, no-uri/slug lookup fallback to "Space not found"). DB-touching happy paths covered by manual QA per the project convention. Full suite: **323 tests passing across 22 files** (was 302). TypeScript clean. Commit `3e038b5`.

**Session 2 queued.** Anthropic's first-party `web_search_20250305` tool lands next once Session 1 is deploy-verified on the Z2. Open questions: Twin guard of search *results* (ephemeral context, not persisted to `context_entries`), cost gating via `cost_tier` + budget-pressure, and capabilities-block rule on when Claude should reach for search vs. stay local.

### Dogfood fix — list reconciler for Claude's hallucinated confirmations (2026-04-20)

Bug 3 regression surfaced in Hareesh's first real-use of the APK: "buy some veg stock for the soup" → Claude replied "Done, I've added vegetable stock to your shopping list!" but nothing landed in the Lists tab. Root cause: the regex fast path in `src/intelligence/listCommands.ts` only catches explicit "add X to shopping list" phrasings; the `interactive_query` skill tells Claude to "Confirm confidently" so it confirmed a hallucinated add.

Fix: post-reply reconciler `src/intelligence/listReconciler.ts` scans Claude's final real-names reply for past-tense ("added/put X to your shopping|task list") or future-tense ("I'll add X to your …") patterns and actually inserts the items via `addItem()`. Idempotent — dedupes against pending items on the list. Wired into the orchestrator as step 5b between `translateToReal` and the audit write. 13 tests (covers the exact Hareesh phrasing, multi-item joins, articles, task/to-do, no false positives on "add milk to your coffee"). Commit `9beb97d`.

Long-term fix remains Claude tool-use via `skills/list_management/SKILL.md` — the reconciler is a robust safety net that closes the class of bug rather than the specific phrasing. See `memory/project_memu_first_use_bugs.md` and `backlog/INBOX.md` (2026-04-20 entry).

**Next session (2026-04-21): Bug 6 — PDF / document ingestion.** Per `memu-platform/memu-build-plan.md` Part 0 and INBOX. Scope: document picker in chat → `skills/document_ingestion/SKILL.md` → pdf-parse + mammoth extraction → Twin anonymise → extraction skill for stream cards → synthesis skill for document Space. Original files to attachments dir; full text to `context_entries` for embedding retrieval; Space holds structured summary. Estimate ~2–3 hours.

### Milestone B2 — docker-compose.home.yml + Dockerfile tightening (2026-04-19)

Second slice of Milestone B. `docker-compose.home.yml` was a stub carrying just the core env vars; B2 brings it up to the full surface required by Stories 1.2 / 1.4 / 1.5 / 3.1 / 3.3 / A3 before the B7 cutover.

**New env plumbed in:** `GEMINI_API_KEY` + `GEMINI_MODEL` (A3 skill routing), `MEMU_BYOK_ENCRYPTION_KEY` (Story 1.2 per-user keys), `MEMU_TWIN_GUARD_MODE` (default `log_and_anonymize` for prod), `MEMU_TWIN_NOVEL_MODE` (default `auto`), `MEMU_OIDC_COOKIE_KEYS` + `MEMU_WEBID_BASE_URL` + `PUBLIC_BASE_URL` (Solid-OIDC + WebID), the four model-alias overrides + `MEMU_BUDGET_PRESSURE` (router escape hatches), and explicit `MEMU_SPACES_ROOT=/app/spaces` + `MEMU_TMP_DIR=/app/tmp` so the on-disk roots match the volume mounts below.

**Host bind-mounts:** `/mnt/memu-data/memu-core/spaces` → `/app/spaces` (synthesis pages — catastrophic-loss per `docs/INTEGRATION_CONTRACTS.md` §5; this is the path B3 will add to the nightly file-backup scope), and `/mnt/memu-data/memu-core/tmp` → `/app/tmp` (snapshot + Article-20 export staging; safe to clear). Operator needs `mkdir -p /mnt/memu-data/memu-core/{spaces,tmp}` before first `up`.

**Healthcheck** duplicated from Dockerfile into the compose service (explicit block so `docker inspect` shows it regardless of build cache, and so the B4 watchdog integration has an unambiguous signal). 30s interval, 20s start period, 3 retries.

**Dockerfile fix piggy-backed onto B2.** The runtime image was missing `COPY skills ./skills` and `COPY migrations ./migrations`, so first boot would have crashed at skill-loader validation and migration-runner read. Both paths are now in the image.

Validated with `docker compose -f docker-compose.home.yml config --quiet` — clean. Live test is still deferred to B7 cutover; this slice is about shape, not smoke.

**What B2 doesn't touch (still B3+):** adding `memu_core` DB to `pg_dumpall` scope and `/mnt/memu-data/memu-core/spaces/` to the file-backup scope happens in memu-os (B3). Watchdog integration (B4) adds `memu_core` to `/usr/local/bin/memu-watchdog.sh`.

### Milestone B1 — preflight + db-init safety rails (2026-04-18)

First slice of Milestone B. Two new bash scripts in `scripts/` — **authored in memu-core, not memu-os** (see decision `2026-04-18-b1-scripts-location.md` in the Obsidian decisions log; dependency direction is memu-core → memu-os, so memu-core carries its own safety rails and memu-os stays oblivious).

**`scripts/preflight.sh`.** Read-only host audit — never modifies state. Six sections:
1. Run context — sudo + docker daemon responsive.
2. memu-os v1.1 signals — `tailscaled` running on host (not in a container), `memu-backup.timer` enabled, `memu-watchdog.sh` present at `/usr/local/bin/`. These three operational signals stand in for a missing version file.
3. Container health — enumerates all 11 memu-os containers (`memu_proxy memu_intelligence memu_photos memu_synapse memu_calendar memu_redis memu_postgres memu_element memu_photos_ml memu_bootstrap memu_brain`) and checks `docker inspect` state + healthcheck status per container.
4. Disk space — root filesystem ≥ 20GB free, `/mnt/memu-data` ≥ 50GB free.
5. Backup freshness — finds newest file under `/mnt/memu-data/backups`, passes when ≤ 2h old, warns between 2–24h (operator should take ad-hoc backup before deploy), fails > 24h.
6. memu-core side — `memu-suite_memu_net` Docker network exists, no stale `memu_core` container.

Exit codes: 0 pass, 1 any hard-fail, 2 warnings only. Colour-coded PASS/FAIL/WARN/INFO output.

**`scripts/db-init.sh`.** Creates the `memu_core` database inside memu-os's Postgres without touching Immich / Synapse / Baikal data. Whitelist-only — every operation is scoped to `memu_core`. Accepts `DB_PASSWORD` env var directly or reads it from `MEMU_OS_ENV_FILE=/path/to/memu-os/.env`. Flow: verify container running → authenticate as `memu_user` → audit-print existing database list (so the operator can eyeball what's on the instance before anything is created) → idempotent `CREATE DATABASE memu_core OWNER memu_user` (no-op if exists) → `CREATE EXTENSION IF NOT EXISTS vector` against `memu_core` only → post-init audit print.

Both scripts passed `bash -n` syntax check. Live validation deferred to session B7 cutover on the Z2 — running preflight against a live v1.1 host is the earliest real-world test signal, and db-init only runs once per dock.

**What B1 doesn't cover (B2+ work):**
- `docker-compose.home.yml` adjustments (B2) — the compose file exists but may need tweaks once preflight surfaces host-specific assumptions.
- Backup integration (B3) — adding `memu_core` DB to `pg_dumpall` scope + `spaces/<family_id>/` tree to file-backup scope.
- Watchdog integration (B4), mobile Tier-2 config (B5), validation script (B6), cutover (B7).

### Milestone A3 — extraction swapped to Gemini Flash (2026-04-18)

A3 of Milestone A shipped. `skills/extraction/SKILL.md` now declares `model: gemini-flash` (v2), so every inbound-message extraction is dispatched to Gemini 2.5 Flash instead of Claude Haiku. The Twin guard still runs ahead of the provider call (the skill is `requires_twin: true`), so the privacy invariant holds regardless of which provider is on the other end of the socket.

**Router plumbing (A2, verified live under A3).** `src/intelligence/gemini.ts` now threads `temperature` and `maxTokens` through to `getGenerativeModel({ generationConfig: { temperature, maxOutputTokens } })` — extraction depends on `temperature: 0` for deterministic stream-card JSON, and without this the Gemini defaults (temp 1.0, 8192 tokens) made replies drift. `src/skills/router.ts` forwards both fields from `DispatchInput` into the Gemini branch, matching the Claude branch. Dummy mode (no `GEMINI_API_KEY`) is preserved — extraction's regex `replyText.match(/\[[\s\S]*\]/)` returns `null` on the stub reply and the pipeline no-ops gracefully.

**Test churn.** `router.test.ts` and `loader.test.ts` were rewritten where they assumed extraction → Claude Haiku. The haiku-default shape is now tested against `autolearn` (still Haiku); Gemini-routing tests remain covered via `autolearn` + `MEMU_MODEL_OVERRIDE_HAIKU=gemini-flash*`. Full suite: **263 tests passing across 19 files** (was 258).

**Per-skill cost table** (anchored against volume in Hareesh's household, ~April 2026):

| Skill | Model | Tier | Typical input | Typical output | Est. cost/call | Daily volume | Daily £ |
|---|---|---|---|---|---|---|---|
| extraction | **gemini-flash** (A3) | cheap | ~400 tok | ~150 tok | ~£0.0002 | ~100 msgs | ~£0.02 |
| autolearn | haiku | cheap | ~600 tok | ~120 tok | ~£0.0005 | ~30 exchanges | ~£0.015 |
| twin_translate | local (→haiku if overridden) | cheap | ~200 tok | ~80 tok | ~£0.0003 | ~50 msgs | ~£0.015 |
| import_extract | haiku | cheap | ~2000 tok | ~300 tok | ~£0.001 | rare (bulk) | <£0.01 |
| synthesis_update | sonnet | standard | ~1500 tok | ~400 tok | ~£0.012 | ~20 | ~£0.24 |
| synthesis_write | sonnet | standard | ~1800 tok | ~800 tok | ~£0.016 | ~10 | ~£0.16 |
| interactive_query | sonnet | standard | ~1200 tok | ~400 tok | ~£0.010 | ~40 | ~£0.40 |
| briefing | sonnet | standard | ~2500 tok | ~600 tok | ~£0.018 | 1–2 | ~£0.03 |
| reflection | sonnet | standard | ~3000 tok | ~500 tok | ~£0.020 | 1 daily + 1 weekly | ~£0.02 |
| vision | sonnet-vision | premium | ~1200 tok + image | ~300 tok | ~£0.025 | <1 | ~£0.01 |

Household daily total: ~£0.93 (was ~£0.98 before A3). Swap saves ~£1.50/family/month — small per-family but meaningful at Founding-50 scale (~£900/year). Validation against the five evidence-dashboard metrics (cost < $3/family/month) continues to look comfortable. Actual live cost to be measured against the privacy-ledger `tokens_in`/`tokens_out` columns after ~1 week in production.

**What A3 doesn't touch.** autolearn and twin_translate are the next cheap-tier candidates for Gemini (both listed in the backlog's Gemini priority bucket), but the spec asks for *one* skill per milestone so provider drift is attributable. Next provider swap goes in once extraction has a week of ledger data showing Gemini output quality holds against Claude on real family traffic.

### Story 3.4 complete — cross-household Pod portability (2026-04-18)

**Phase 3 is now done end-to-end.** 3.4a (membership + grants schema/API), 3.4b (external Pod read pipeline + Twin extension), 3.4c (mobile UI), 3.4d (POD_PORTABILITY.md + scripted two-deployment test), and the daily finaliseExpiredLeaves cron all shipped 2026-04-18. The marriage / immigration / cohabitation flow works: someone with their own Memu deployment can join a household, share individual Spaces from their Pod by reference (not by copy), be referenced safely in the household's Claude calls (foreign WebID auto-registered in the Twin so it never leaks), leave with a 30-day grace period (cancellable), and rejoin cleanly with full historic continuity.

### Story 3.4d — POD_PORTABILITY.md + two-deployment scripted test (2026-04-18)

Final slice of 3.4. The code is the same 3.4a + 3.4b + 3.4c surface; what's new is the documentation + the verification harness.

**`docs/POD_PORTABILITY.md`.** Plain-language doc for a family who already runs Memu and now needs to share with someone whose Pod lives elsewhere. Same audience and tone as `docs/INTEGRATION_CONTRACTS.md`. Covers what portability does (per-Space grants, Twin auto-registration of foreign WebIDs, grace-period leave, cache cleanup), what it does not do (no copy, no write access, no field-level redaction, no DPoP-on-outbound yet), the lifecycle state machine with cron behaviour, the 12-step end-to-end test verbatim, the failure-mode catalogue (B offline → degrades to cache, B revoked → keeps cache pending admin attention, parse error → cache preserved + sweep continues), and the residual gaps explicitly. This is the public spec for Story 3.4.

**`scripts/test-pod-portability.ts`.** Self-contained runner that drives the 12-step flow against two real deployments via HTTP, exits non-zero on the first regression, and is idempotent against re-runs (pre-cleans any existing member row matching the WebID before starting). Reads six env vars: `MEMU_HOUSEHOLD_BASE`, `MEMU_HOUSEHOLD_API_KEY`, `MEMU_MEMBER_BASE`, `MEMU_MEMBER_WEBID`, `MEMU_MEMBER_DISPLAY_NAME`, `MEMU_MEMBER_API_KEY`. Each step prints `[N] label ... OK` or `[N] label ... FAIL <reason>`. Steps 1–11 from the doc are mechanical; step 5 (Claude reflection check) is left as a manual eyeball — automating "verify the WebID URL never appears in the prompt" requires intercepting the Twin guard's ledger, and a structured assertion would just duplicate the existing `twin_verified=true` test in `src/twin/guard.test.ts`.

**Cron — `30 4 * * *` Europe/London daily household sweep (`src/index.ts`).** Two passes:
1. `finaliseExpiredLeaves()` from `src/households/membership.ts` — flips any `leaving` member whose `leave_grace_until <= now` to `left`, in a transaction that cascade-revokes their `pod_grants`. Then `dropAllCacheForMember(memberId)` clears their `external_space_cache` rows.
2. `SELECT DISTINCT household_admin_profile_id FROM household_members` then iterates `syncHouseholdGrants(adminProfileId)` per household. Errors on individual households are logged and isolated — one bad household doesn't poison the sweep.
Sits at 04:30 to land cleanly after the Monday 04:00 git gc. Both passes are wrapped in their own try/catch so a Postgres outage doesn't crash the cron worker.

### Story 3.4c — mobile UI for join / leave / grants (2026-04-18)

Third slice of 3.4. Settings now has a "Household" section between Context and Privacy: "People in this household — Join, leave, share Spaces from another Pod" → `/household`.

**`mobile/app/household.tsx`** (~700 lines, file-based route via Expo Router). Three components in one file:
- **HouseholdScreen.** Masthead "Cross-household sharing / Who is part of this household.", an `includeLeft` toggle that toggles whether `left` rows are visible (audit), an Invite button. Each member row renders a status badge (ok/warn/danger/neutral tone), the WebID, and grace-period preview text "Leaves in N days · cancellable" when the member is in `leaving`.
- **InviteModal.** Paste WebID + display name, pick a `LeavePolicyForEmergent` from `LEAVE_POLICIES`, set grace days (with helper text 'How long after they tap "Leave" before access is fully revoked'). Maps `MembershipError` reasons to inline error text.
- **MemberDetailModal.** Status display, lifecycle action row that adapts to status (Accept invite / Start leaving / Cancel leaving / Remove now — the destructive actions go through `Alert.alert` confirmation), grants list with cached-Space metadata, "Add grant URL" form, "Sync from their Pod now" button that surfaces per-grant outcomes (`fresh` / `not_modified` / `error: <reason>`).

**`mobile/lib/api.ts`** gained the household section: 4 type interfaces (`MemberStatus`, `LeavePolicy`, `HouseholdMember`, `PodGrant`, `CachedExternalSpace`, `SyncReport`) and 11 methods (`listHouseholdMembers`, `inviteHouseholdMember`, `acceptHouseholdInvite`, `leaveHousehold`, `cancelHouseholdLeave`, `removeHouseholdMember`, `listMemberGrants`, `recordMemberGrant`, `revokeMemberGrant`, `syncMemberGrantsNow`, `listCachedMemberSpaces`).

Mobile typecheck clean.

### Story 3.4b — external Pod read pipeline + Twin extension (2026-04-18)

Second slice of 3.4. Granted external Pod Spaces are now actually fetched, parsed, cached, and the foreign WebIDs they surface get auto-registered in the Twin so the household's Claude never sees a raw cross-Pod URL.

**Migration 015 — `external_space_cache`.** Stores parsed external Spaces keyed by `(member_id, space_url)` UNIQUE with FK CASCADE on member delete. Carries the full Space projection (name/category/slug/description/visibility/confidence/people/domains/tags/sourceReferences/bodyMarkdown), plus `remote_last_updated` from the Space and `fetched_at` for staleness display.

**Conditional fetch (`src/spaces/solid_client.ts`).** New `fetchExternalSpaceConditional(url, opts)` returns a discriminated union `{kind: 'fresh', space, cacheHints} | {kind: 'not_modified', cacheHints}` so callers needing 304-aware caching get the etag/last-modified back from response headers and the request `If-None-Match` / `If-Modified-Since` get forwarded if supplied. The original `fetchExternalSpace()` is kept as a thin wrapper for callers who only want the Space. New `FetchOptions.ifNoneMatch` / `ifModifiedSince` are passed through to the HTTP request.

**`src/spaces/external_sync.ts` (~370 lines).** Pure helpers `extractForeignWebids(space)` (https-only filter, dedup, drops local profile ids and http:// URLs — same rule as `validateWebid`) and `buildConditionalHeaders(grant, opts)` (returns `{}` when `forceRefetch` is set even with hints). Twin: `registerForeignWebid(webid, displayName)` allocates a fresh `Person-N` label via `allocatePersonLabel()`, INSERTs with `detected_by='auto_pod_grant'` (distinct from `auto_ner` / `manual` so the Twin Registry UI can show provenance), calls `resetEntityNameCache()`. Cache CRUD: `upsertCache` / `findCache` / `listCachedSpacesForMember` / `dropCacheForGrant` / `dropAllCacheForMember`.

Orchestration: `syncGrant(member, grant, opts)` returns a `SyncOutcome` (`'fresh'` / `'not_modified'` / `'error'` with `reason` + `message`). On 304 it just calls `recordGrantSync(grant.id, cacheHints)` to update the grant's cache hints — no cache row touched. On fresh it upserts the cache, calls `recordGrantSync`, registers the member's own webid + every foreign webid in `space.people[]`. Errors don't poison sweeps — they're returned as a structured outcome so `syncMemberGrants(memberId)` and `syncHouseholdGrants(householdAdminProfileId)` can iterate cleanly.

**Cascade cleanup.** Because `revokeGrant` only flips `pod_grants.status` to `'revoked'` (doesn't delete the row, so FK CASCADE doesn't fire), the route layer composes the cleanup explicitly: `DELETE /api/households/members/:id/grants` calls `dropCacheForGrant`, `DELETE /api/households/members/:id` and `POST /leave` with `gracePeriodDaysOverride === 0` both call `dropAllCacheForMember` after `finaliseLeave`. Kept `revokeGrant` in `membership.ts` pure (no `external_sync` import) to avoid a cycle.

**New routes.** `POST /api/households/members/:id/grants/sync` (admin or self) and `GET /api/households/members/:id/grants/cached` (admin or self).

**Tests.** `src/spaces/external_sync.test.ts` (15 — `extractForeignWebids` URL filtering / http rejection / dedup / empty, `buildConditionalHeaders` no-hints / etag-only / lastModified-only / both / forceRefetch, `fetchExternalSpaceConditional` 200 fresh + hints / 304 not_modified / header forwarding / omission / 500 SolidClientError). DB-touching paths (Twin registration, cache upsert, grant orchestration) covered by manual QA per the story DoD. Full suite: 258 tests passing across 19 files (was 243).

### Story 3.4a — household membership + per-Space Pod grants (2026-04-18)

First slice of Story 3.4 (cross-household Pod portability — the marriage/immigration flow). The schema + service + API are in; live external-Pod fetch, Twin extension, mobile UI, and the two-deployment end-to-end test are 3.4b/c/d.

**Migration 014 — `household_members` + `pod_grants`.** Two new tables. `household_members` records adults whose primary Pod may live elsewhere (member_webid, member_display_name, optional internal_profile_id when they also have a profile on this deployment, status enum invited/active/leaving/left, leave_policy_for_emergent enum retain_attributed/anonymise/remove default retain_attributed, grace_period_days default 30, the four lifecycle timestamps). `pod_grants` records per-Space external read access from a member's Pod to this household (member_id FK, space_url, status active/revoked, granted_at/revoked_at, plus cache hints last_synced_at/last_etag/last_modified_header for 3.4b). Unique partial index on `(member_id, space_url) WHERE status='active'` so revoked grants accumulate as audit without conflicting. Same `household_admin_profile_id = primary admin profile_id` convention as Stories 2.1–3.3 — to be replaced when the proper households table lands.

**`src/households/membership.ts`.** Pure rule helpers: `allowedNextStatuses` / `canTransition` (state machine: invited → active|left, active → leaving|left, leaving → active|left, left terminal); `validateWebid` and `validateSpaceUrl` (https-only, fragment stripped on space URLs); `computeGraceUntil(now, days)` and `isLeaveFinalisable(member, now)` for grace-period maths. DB functions: `inviteMember` / `listMembers` / `findMember`, `acceptInvite` / `initiateLeave` / `cancelLeave` / `finaliseLeave` (transactional — cascade-revokes all active grants in the same UPDATE), `finaliseExpiredLeaves` for the cron, and the grants CRUD `recordGrant` (idempotent — returns existing active grant), `listGrants`, `revokeGrant`, `recordGrantSync` (cache-hint update for 3.4b).

**Routes mounted under `/api/households/*`:** POST /members (admin invite), GET /members (admin list), POST /members/:id/accept (admin or self), POST /members/:id/leave (admin or self, with policy + grace overrides), POST /members/:id/cancel-leave, DELETE /members/:id (admin force-remove), GET /members/:id/grants, POST /members/:id/grants (record), DELETE /members/:id/grants?spaceUrl= (revoke). Two helpers — `ensureAdminCaller` and `ensureAdminOrSelf` — express the auth model: admins do invites + force-remove + listing; the linked internal member can record/revoke their own grants and initiate own leave; children blocked across the board. `MembershipError` from the service layer is mapped to 400 with a `reason` field so the mobile UI can branch on `webid_must_be_https` / `illegal_transition` / `member_not_found` / etc. without scraping messages.

**Tests.** `src/households/membership.test.ts` (24 — state-machine transitions including all illegal jumps, https-only WebID + space URL validation, fragment stripping, grace-period maths including 0/negative/fractional, `isLeaveFinalisable` truth table, LEAVE_POLICIES catalogue matches the SQL CHECK). DB-touching paths (the route handlers, transactional `finaliseLeave`, `recordGrant`/`revokeGrant`) covered by manual QA per the story DoD. Full suite: 243 tests passing across 18 files (was 219).

### Story 3.3d — DPoP proof verification + Turtle parser (2026-04-18)

Fourth slice of Story 3.3. Two of the four 3.3d items shipped — the code-shaped pieces. Tier-2 wizard step (`profiles.external_pod_url`), Twin extension for foreign WebIDs, and external-client interop QA are still pending and each warrant their own session.

**DPoP proof verification (`src/oidc/bearer.ts`).** New `verifyDpopProof(proofJwt, opts)` (RFC 9449) checks:
- `header.typ === 'dpop+jwt'` and `header.jwk` present + `header.alg` set
- Signature verifies under the embedded JWK (proof of possession of the matching private key)
- `payload.htm` matches the request method (case-insensitive)
- `payload.htu` matches the request URI after `normalizeHtu` (strips query + fragment per §4.2)
- `payload.iat` within ±60s (configurable via `maxAgeSeconds`)
- `payload.jti` is present (no replay cache yet — that needs a TTL store; for now the iat window is the brake)
- `payload.ath === base64url(SHA-256(accessToken))` when an access token is supplied
- `expectedJkt` (from access token's `cnf.jkt`) matches `calculateJwkThumbprint(jwk)`

`verifyBearer` now extracts `cnf.jkt` from the access token payload and surfaces it as `cnfJkt` on `VerifiedBearer`. `solid_routes.ts` `authenticateOrReject` enforces it: when the token has `cnfJkt`, the request MUST carry a valid `DPoP` header binding the same key to this method+URI+token, otherwise 401 with `WWW-Authenticate: DPoP realm="memu", error="invalid_dpop_proof"`. Plain bearer tokens (no `cnf.jkt`) continue to work as before — this is additive: DPoP-bound tokens get their binding checked, non-DPoP tokens stay accepted.

Implementation note: removed the `oidc-provider/node_modules/jose` indirect-path require (it never actually existed at that location — jose is a top-level dep). bearer.ts now does `import * as joseLib from 'jose'` directly. jwks lazy-load is preserved because it pulls in `db/connection`, which would otherwise force every importer to set `DATABASE_URL`.

**Turtle parser (`src/spaces/solid_client.ts`).** New `parseSpaceFromTurtle(ttl, sourceUrl)` uses the `n3` package (just added: `n3@2.0.3` + `@types/n3`). Walks quads, groups by subject, picks the one carrying `memu:slug` or `memu:category` as the Space node (falls back to first subject), extracts `schema:name` / `schema:description` / `memu:uri` / `memu:category` / `memu:slug` / `memu:domain` / `memu:tag` / `memu:confidence` / `dcterms:modified` / `memu:bodyMarkdown`. Same safe-defaults behaviour as the JSON-LD parser (name → 'Untitled', category → 'document' via `coerceCategory`, confidence → 0.5).

`fetchExternalSpace` dispatch updated: `text/turtle` / `text/n3` / `application/n3` now route to `parseSpaceFromTurtle` instead of throwing `turtle_unsupported`. Round-trip verified by serialising via `serializeSpaceTurtle` and parsing back through the new parser. `SolidClientError` reasons gain `invalid_turtle`; `turtle_unsupported` is retired.

**Tests.** `src/oidc/bearer.test.ts` (+14 → 27 total): 3 for `normalizeHtu` (query/fragment stripping, trailing slash, parse-failure passthrough), 11 for `verifyDpopProof` covering happy path, every reason field (`dpop_wrong_typ`, `dpop_missing_jwk`, `dpop_htm_mismatch`, `dpop_htu_mismatch`, `dpop_iat_stale`, `dpop_missing_jti`, `dpop_ath_mismatch`, `dpop_jkt_mismatch`), htu compared with query/fragment stripped, and accessToken-omitted case. `src/spaces/solid_client.test.ts` (+3 → 19 total): Turtle round-trip, invalid-Turtle error, minimal-Turtle defaults, and a fetch-dispatch test that returns `text/turtle` and parses it. Removed the `turtle_unsupported` test. Full suite: 219 tests passing across 17 files.

**What's still pending in 3.3 overall:**
- Tier-2 wizard step writing `profiles.external_pod_url` (UI work; lands with wizard polish for 3.4).
- Twin extension for external WebIDs surfaced by fetched Spaces — when an `ExternalSpace.people` includes a foreign WebID we don't recognise, the Twin should auto-register the entity so subsequent Claude calls don't leak the URL.
- Replay cache for DPoP `jti` (needs Redis/pg TTL store). Iat window is the practical brake until then.
- External-client interop QA against PodSpaces / inrupt-test-pod / Penny — the actual conformance check needs a deployment.

### Story 3.3c — Solid client (read external Pods) (2026-04-18)

Third slice of Story 3.3. Memu can now fetch Spaces published by external Solid Pods (other Memu deployments, PodSpaces, NSS, anything that round-trips our published shape). The mirror image of `solid_routes.ts`: where the routes let outsiders read us, this lets us read them.

**`src/spaces/solid_client.ts`.** `fetchExternalSpace(url, opts)` does a content-negotiated HTTP GET (`Accept: application/ld+json, text/markdown;q=0.7, text/turtle;q=0.5`), 10s default timeout via AbortController, optional `Bearer <token>` for ACP-gated resources. Dispatches by response Content-Type:
- `application/ld+json` / `application/json` → `parseSpaceFromJsonLd`
- `text/markdown` / `text/plain` (or unset) → `parseSpaceFromMarkdown` (uses gray-matter — same library `store.ts` writes with, so the on-disk frontmatter shape parses cleanly)
- `text/turtle` → throws `SolidClientError` with `reason: 'turtle_unsupported'` and a clear message pointing the caller at the Accept header. Real Turtle parsing requires `n3` or `rdflib` and was deferred so we don't ship a half-correct hand-rolled parser. Targeted for 3.3d when external interop QA forces the issue.

`SolidClientError` carries a structured `reason` field (`unauthorized` / `http_error` / `fetch_failed` / `invalid_json` / `empty_graph` / `turtle_unsupported` / `unknown_content_type` / `no_fetch`) so callers can branch on the failure mode without scraping the message.

**Output shape: `ExternalSpace`.** `Omit<Space, 'familyId' | 'id'> & { sourceUrl }`. The local-only fields (`familyId`, internal `id`) are populated by the caller after fetch — an external Pod doesn't know our internal IDs and shouldn't. `visibility` defaults to `'private'` on fetch (the safest assumption for a Space we didn't publish ourselves). `sourceUrl` is preserved for re-fetch + dedup; `sourceReferences` defaults to `[sourceUrl]` for traceability.

**Round-trip verified.** Tests serialise a Space via `serializeSpaceJsonLd` (or `gray-matter.stringify`), parse it back through the client parsers, and assert the round-trip preserves name / category / slug / uri / confidence / domains / tags / lastUpdated / bodyMarkdown. So if the external Pod is another Memu, the wire format works in both directions; if it's not, the parsers tolerate missing fields with safe defaults (name → 'Untitled', category → 'document', confidence → 0.5).

**Migration 013 — `profiles.external_pod_url`.** Optional TEXT column. NULL = no external Pod (Memu is source of truth for this profile's Spaces); set = external Pod is authoritative, Memu caches but never overwrites. The Tier-2 wizard step "Do you already have a Solid Pod?" writes here.

**What's still pending (3.3d):**
- DPoP proof verification (HTTP-method/URL/body binding) on incoming requests. Still tolerated as plain Bearer.
- Turtle parser (`n3` package) so the client handles Pods that only serve `text/turtle`.
- The Tier-2 wizard step that sets `external_pod_url`. UI work; will land alongside wizard polish for 3.4.
- Twin extension for external WebIDs — when a fetched Space references a person via an external WebID URL (not in our `entity_registry`), the Twin needs to register them as a foreign entity so we don't leak the URL in subsequent Claude calls.
- External-client interop QA against PodSpaces / inrupt-test-pod / Penny — the actual conformance check.

**Tests.** `src/spaces/solid_client.test.ts` (16 — JSON-LD round-trip + minimal + unknown category + invalid JSON + empty graph; markdown round-trip + slug fallback + no-frontmatter; fetch dispatch by content-type; Authorization header presence/absence; 401/403/500 error reasons; turtle_unsupported reason). Full suite: 202 tests passing across 17 files.

### Story 3.3b — Solid write methods + containers + typeIndex (2026-04-18)

Second slice of Story 3.3. Memu now has a complete read+write Solid surface for Spaces — external Solid editors can PUT/DELETE individual Spaces, walk into per-category and per-person containers to discover what's published, and read the typeIndex to learn the Pod's shape.

**PUT `/spaces/:category/:slug`.** Accepts a `text/markdown` body and upserts the Space via the existing `upsertSpace()` store. Slug comes from the URL (Solid editors choose their own slugs and we honour that). On create: defaults visibility=`family`, name=slug, confidence inherited from store default. On update: existing visibility / domains / people / tags are preserved unless overwritten by a future PATCH. Returns 201 + `Location` on create, 204 on replace, with `Link: <acp_url>; rel="acl"`.

**DELETE `/spaces/:category/:slug`.** New `deleteSpace()` in `store.ts` — DB row deleted in a transaction with a `spaces_log` event=`deleted` entry, then best-effort filesystem cleanup (unlink the .md, append to `_log.md`, git commit attributed to the actor). Idempotent on the DB side: missing slug returns 404, but the store function itself is safe to call repeatedly.

**Write authorization (`authorizeWrite` in `solid_routes.ts`).** Caller must (a) pass bearer verification, (b) be `admin` or `adult` in the profiles table — children can read Spaces they're allowed to but cannot write, and (c) for existing Spaces, be in the derived allowed-readers set (you cannot edit a Space you can't see). For new Spaces the second-and-third-checks short-circuit since there's nothing to compare against. Coarse — finer write-ACP comes when the visibility model adds a separate `writers` field.

**Containers (`serializeContainer` in `solid.ts` + `GET /spaces/:segment/`).** LDP `BasicContainer` Turtle listing every Space the caller can see, filtered two ways:
- If `:segment` matches a known `SPACE_CATEGORIES` value → per-category container (all Spaces of that category).
- Otherwise treated as a `webid_slug` → per-person container (all Spaces where that profile is in `space.people`). 404s if no profile matches the slug.

In both cases the container is filtered by the caller's visibility — same `deriveAllowedReaders` check as the GET resource path. Empty containers are valid LDP and emit a clean `ldp:BasicContainer` shape with no `ldp:contains`. Each entry carries a `schema:name` triple in a separate subject block so a Pod browser can show titles without parsing the Space body.

**typeIndex (`serializeTypeIndex` + `defaultTypeIndexEntries` in `solid.ts` + `GET /typeIndex`).** Standard `solid:TypeIndex` document with one `solid:TypeRegistration` per category, each pointing at its container URL. The WebID profile doc (`webid.ts`) now emits `solid:publicTypeIndex <typeIndex>` so external Solid clients reading the WebID can discover the Pod's published kinds in one hop.

**Body parsing.** Registered Fastify content-type parsers for `text/markdown`, `text/turtle`, `text/plain`, `application/n3` — all passthrough to a string body. JSON is still handled by Fastify's default parser.

**What this still doesn't do (3.3c/d):**
- DPoP proof verification of method+url+body (still tolerated as plain Bearer; documented in the route comment). Will land before external interop QA.
- PATCH (N3 patches / SPARQL UPDATE) — clients that need partial updates can re-PUT the whole body. Real Solid editors expect PATCH eventually.
- Solid client (`solid_client.ts`) for reading external Pods and the Tier-2 wizard step "do you already have a Solid Pod?".
- External-client interop QA against PodSpaces / inrupt-test-pod / Penny.

**Tests.** `src/spaces/solid.test.ts` extended (+10 tests): `serializeContainer` (empty + populated + dot-termination + ACP pointer), `serializeTypeIndex` (TypeIndex declaration, one registration per category, correct `solid:forClass` per category). `src/webid/webid.test.ts` extended (+1 assertion): typeIndex pointer now in both Turtle and JSON-LD profile output. Full suite: 186 tests passing across 16 files. DB-touching paths (`deleteSpace`, the route handlers themselves, profile lookup by webid_slug) covered by manual QA per the story DoD.

### Story 3.3a — Solid HTTP read surface for Spaces (2026-04-18)

First slice of Story 3.3. Every Space is now addressable as a Solid resource at `https://<base>/spaces/<category>/<slug>` with content negotiation, an ACP resource at `?ext=acp`, and Solid-OIDC bearer auth gating reads. Default-deny: a caller whose WebID isn't in the derived allowed-readers set gets 403, even with a valid token.

**Bearer verification (`src/oidc/bearer.ts`).** `extractBearerToken()` accepts both `Bearer` and `DPoP` schemes (DPoP proof binding deferred to 3.3b along with write methods). `verifyBearer()` runs `jose.jwtVerify` against the local JWKS — no DB round-trip to oidc-provider's volatile token store, so reads stay cheap across restarts. Validates issuer + audience (= our base URL, matching `resourceIndicators.defaultResource`), pulls the `webid` claim, parses the `/people/<slug>` path, and looks up the Memu profile by `webid_slug`. `BearerVerificationError` carries a structured `reason` for ledger logging. jose + jwks loaded lazily inside `getKeySet()` so the pure helpers stay importable in test environments that can't resolve the nested `oidc-provider/node_modules/jose` path.

**Solid serialization (`src/spaces/solid.ts`).** Three representations of one Space:
- `text/markdown` — the body verbatim, default for browsers and humans
- `text/turtle` — RDF using foaf, schema.org, dcterms, and a `memu:` vocab (`https://memu.digital/vocab#`). Carries `memu:bodyMarkdown` literal so the human content is reachable from the RDF view too.
- `application/ld+json` — same statements as JSON-LD with explicit IRIs

`negotiateSpaceContentType()` picks markdown by default (browser-friendly), turtle/JSON-LD only when explicitly asked. `rdfTypeForCategory()` maps person→schema:Person, household→schema:Place, and routine/commitment/document to memu:* terms.

**ACP (`serializeAcp` in `src/spaces/solid.ts`).** Standard `acp:` + `acl:` vocabulary so Solid clients can validate authorisation independently. `deriveAllowedReaders()` reuses `resolveVisibility()` from `model.ts` — same source of truth as the orchestrator's `canSee()`. Profile ids without a `webid_slug` are dropped (fail closed). Explicit `https://` URIs in the visibility list pass through verbatim — that's the path for cross-household sharing in 3.4. Empty allowed-set → ACP with no `acp:Matcher` and a `memu:note` explaining the lock; we deliberately do NOT emit `acl:agentClass foaf:Agent` (would be public).

**Routes (`src/spaces/solid_routes.ts`).** Mounted outside `/api/` so the existing API-key preHandler skips them — Solid clients use the bearer instead. `GET /spaces/:category/:slug` and `HEAD /spaces/:category/:slug`:
1. Validate the second segment against `SPACE_CATEGORIES` enum (anything else 404s — per-person Pod root `/spaces/<webid_slug>/` is 3.3b).
2. `authenticateOrReject` extracts + verifies bearer; 401 with `WWW-Authenticate: Bearer` header on failure.
3. Resolve `family_id` from caller (single-family convention: lowest-created admin).
4. Load the Space, the family roster, and a profile-id → WebID lookup for the ACP.
5. If `?ext=acp` → return the ACP Turtle (still requires valid bearer to discourage casual probing).
6. Visibility check against derived allowed-readers; 403 if caller's WebID isn't in the set.
7. Set `Link: <acp_url>; rel="acl"`, `Last-Modified`, `Vary: Accept`, and the negotiated `Content-Type`.

**Family-id scoping reminder (still).** Same pattern as Stories 2.1–2.3: `family_id` = primary admin's profile_id. When the proper families table lands in 3.4, replace `resolveFamilyIdForCaller` with a profile→family lookup.

**Tests.** `src/spaces/solid.test.ts` (28 — content negotiation, URL building, Turtle/JSON-LD shape + escaping + RDF type mapping per category, ACP lookup, allowed-reader derivation including external WebIDs and fail-closed, ACP default-deny + populated). `src/oidc/bearer.test.ts` (13 — Bearer/DPoP scheme parsing, case + whitespace tolerance, slug parsing including URL-encoding, BearerVerificationError shape). DB-touching paths (`verifyBearer`, the route handlers, profile lookup) covered by manual QA per the story DoD. Full suite: 179 tests passing across 16 files (was 138 across 14).

**What this still doesn't do (3.3b/c/d):** PUT/PATCH/DELETE write methods, DPoP proof verification, Pod root `/spaces/<webid_slug>/` listing + typeIndex, the Solid client (`solid_client.ts`) that reads external Pods, the Tier-2 wizard step "do you already have a Solid Pod?", and the external-client interop QA against PodSpaces / inrupt-test-pod.

### Story 3.1 + 3.2 — Spaces stewardship & Article 20 export (2026-04-18)

First paired release of Phase 3. **3.3, 3.4, 3.5 still pending.** Memu now treats the family's compiled understanding as something the family **owns** — every commit is attributed to a real person, the directory carries an auto-maintained README explaining what it is, and on-demand snapshot + full Article 20 export endpoints let the family take everything to a competitor or read it on their own machine. The Solid Pod surface (3.3), cross-household portability (3.4), and physical Pod drives (3.5) are the next steps in giving the family genuine ownership.

**Story 3.1 — Spaces stewardship.** `src/spaces/store.ts` rewritten so every git commit on `spaces/<family_id>/` is attributed via `--author` to the actor profile (display_name + email looked up from `profiles`). New `ensureReadme()` writes a fixed README explaining the directory + Obsidian compatibility on first init (idempotent unless `force=true` on the very first repo creation). New `src/spaces/maintenance.ts` ships `gcFamilyRepo` / `gcAllFamilyRepos` (runs `git gc --quiet --auto`) and `snapshotFamilyRepo` (uses `tar -czf` to bundle the directory including `.git/`, writes to `MEMU_TMP_DIR`, logs to `spaces_log` with event=`snapshot`). Weekly cron `0 4 * * 1` Europe/London sweeps every family's repo. New `GET /api/spaces/snapshot` endpoint streams the tarball and best-effort cleans up the temp file on stream close — adults only.

**Story 3.2 — Article 20 export.** `src/export/article20.ts` builds a ZIP via `archiver` (added to deps) containing `data.json`, `README.md`, `spaces/` mirror, and `attachments/` (if present). `data.json` aggregates 13 categories: profile, personas, connected channels, messages, stream_cards, stream_card_actions (joined to family stream_cards), synthesis_pages, context_entries (embeddings stripped to keep human-readable), privacy_ledger, twin_registry, care_standards, domain_states, reflection_findings. SHA-256 of `data.json` is computed and embedded in the README so the archive is internally consistent, and recorded to a new `export_log` table (migration 012) for proof-of-export. `spaces_log` event vocab extended with `snapshot` and `exported`. `GET /api/export` rewritten to call `buildArticle20Export`, stream the ZIP with `Content-Disposition`, `Content-Length`, and `X-Export-Hash` headers — adults only (the archive contains adults_only / partners_only material). `category_counts` table in the README is locked by tests so it can't drift from the JSON shape.

**Tests.** `src/export/article20.test.ts` (6 — countCategories shape + cardinality, channel key alias, deterministic SHA-256, hash sensitivity to payload changes). DB-touching paths (`gatherFamilyData`, `buildArticle20Export` end-to-end, INSERTs to `export_log` + `spaces_log`) covered by manual QA per the story DoD. Pre-existing `loader.test.ts` synthesis_update test was patched to include the `enabled_standards` + `now_iso` template vars introduced by Story 2.3. Full suite: 138 tests passing across 14 files.

**Phase 3 deviation.** Original spec for export endpoint was JSON-only. Replaced with the ZIP archive because the spec explicitly says "ZIP file" and the family experience of opening a single archive is markedly better than parsing one giant JSON. The legacy JSON shape is no longer returned — clients hitting `/api/export` now receive `application/zip`.

### Session pickup point — start of next session (2026-04-18 onward)

**Phase 1, Phase 2, and Phase 3 (Stories 3.1, 3.2, 3.3a–d code, 3.4a–d + cron) are complete.** Per Hareesh's instruction at end of the 3.4 session: pause before 3.5 for discussion. Open questions before committing to 3.5:

- **Is 3.5 (physical modular Pod drives — LUKS USB per person + family) actually memu-core, or is it a post-Kickstarter Memu Home story?** It's hardware-shaped (udev watching, LUKS lifecycle, hot-plug write journal) and arguably belongs in memu-os. Worth re-reading the backlog priority filter before committing the surface.
- **Three 3.3d residual items still open**, each its own session: Tier-2 wizard step writing `profiles.external_pod_url` (UI; naturally lands with 3.4 wizard polish), and end-to-end interop QA against PodSpaces / inrupt-test-pod / Penny (needs a deployment). Twin extension for foreign WebIDs surfaced by fetched Spaces is now covered by 3.4b's `registerForeignWebid` (`detected_by='auto_pod_grant'`) — the residual is whether to extend the same machinery to the 3.3c read path for Spaces fetched outside a household-grant context (e.g. anonymous public Pod browsing).
- **Phase 5 (Tier-2 convergence onto the Z2) is gated by the cross-repo architecture review (#38).** memu-os runs the family in production today (Synapse, Immich, Baikal, Ollama). memu-core does not "deploy to" the Z2; it docks alongside via Phase 5: preflight (5.1), co-existence Compose sharing only Postgres (5.2), DB-init safety (5.3), backup integration (5.4), watchdog integration (5.5), mobile Tier-2 config (5.6). Treat any cross-repo touchpoint as high-risk by default.

**Decision wanted from Hareesh:** 3.5 next, Phase 5 next (after the cross-repo review), or pause Phase work and ship something Kickstarter-shaped (demo video polish, onboarding flow, beta pipeline)?

### Story 2.3 + 2.4 — Care standards & domain health (2026-04-17)

**Story 2.3 — Minimum Standards of Care.** New `care_standards` table (migration 010) with TEXT ids, partial unique index on `(family_id, domain, description) WHERE custom = FALSE` so re-seeding is idempotent. `src/care/defaults.ts` ships 16 defaults across 9 domains (dental 180d each_person, GP 365d each_adult, MOT 365d household, intentional evening together 30d couple, etc.). `src/care/standards.ts` exposes `seedDefaultStandards / listStandards / setStandardEnabled / createCustomStandard / deleteCustomStandard / markCompleted / evaluateStandards`. The reflection daily pass now calls `runStandardsCheck` after the LLM scan: anything `evaluateStandards` grades `overdue` raises a `care_standard_lapsed` stream card with actions `[Mark done, Snooze]`, deduped via `reflection_findings` finding-hash. Completion detection: `synthesis_update` skill v2 takes `{{enabled_standards}}` (id — description list), emits `completed_standards: [{id, completed_at}]`, processSynthesisUpdate calls `markCompleted` for each known id. CRUD at `/api/care-standards` (GET list with `?enabled=true`, POST create, POST seed, POST :id/toggle, POST :id/complete, DELETE :id) — children blocked from mutations.

**Story 2.4 — Domain health states.** New `domain_states` table (migration 011) with unique key on `(family_id, domain)` for clean UPSERT. `src/domains/health.ts` computes per-domain green/amber/red from care_standards counts (overdue → red, approaching → amber) plus recent (≤14d) reflection findings linked to the domain via `synthesis_pages.domains[]` URI matching. Multiple amber signals or any contradiction → red. Notes carry one-line summary ("Dental check-up overdue by 3 weeks; 1 unresolved contradiction"). The reflection daily pass calls `computeDomainStates` after the standards check so newly-overdue items propagate. The briefing skill v2 takes a new `{{domain_header}}` template var rendered as the spec header (`✓ Health, Shelter` / `⚠ Domain — note` / `✕ Domain — note`) and is told to open with it verbatim. `briefing.ts` (both PWA + WhatsApp paths) injects the header. `GET /api/domains/status` returns the full state for adults; children get domain + health only (notes/counts stripped, since notes can leak `partners_only` or `adults_only` content).

**Family-id scoping reminder:** like Stories 2.1–2.3, `family_id` continues to be the primary admin's profile_id. When the proper families table lands (Phase 3) the seeder, evaluator, and domain-health compute all need the join updated.

**Tests:** `src/care/defaults.test.ts` (7 — catalogue shape, scope validity, uniqueness), `src/domains/health.test.ts` (8 — header rendering, ordering, multi-word domains, no-notes case). Plus the existing 11 reflection tests. DB-touching paths (seeder, evaluator, computeDomainStates) covered by manual QA per the story DoD.

### Mobile navigation overhaul (2026-04-16)

The bottom tab bar is hidden. Navigation moved to a side drawer that opens by tapping the LogoMark in the top-left of any tab screen. Drawer at `mobile/components/SideDrawer.tsx` with context at `mobile/lib/drawer.tsx`. Sections: Today / Chat / Spaces / Calendar / Lists — divider — Settings.

Status pills in the header (`Node Syncing`, `Private`, `Curated`, `Offline`, `Live`, `Your node`) were removed — they obscured the wordmark and added little signal. `statusLabel` / `statusPulse` props on `ScreenHeader` are kept for back-compat but no longer rendered; can be cleaned up later.

Out-of-tabs screens (`ledger.tsx`, `twin-registry.tsx`, `memory.tsx`, `import.tsx`) live outside the `(tabs)` group and use the close-button pattern (`rightIcon="close"` → `router.back()`); the drawer context isn't available there.

When adding a new top-level screen: register it in `(tabs)/_layout.tsx` Tabs.Screen list AND add a row to `SideDrawer.tsx` PRIMARY/SECONDARY array.

### Story 1.5 — Novel-entity detection + Twin registry UI (2026-04-16)

The Twin guard (Story 1.4) only protects against names already in `entity_registry`. Story 1.5 closes the gap for *unseen* proper nouns: an inbound message mentioning "the new piano teacher Mrs. Patel" no longer leaks, because the orchestrator now detects and registers novel entities before translation.

Flow:
1. Orchestrator calls `detectAndRegisterNovelEntities(rawText)` as step 0 of the pipeline (before `translateToAnonymous`).
2. That function invokes the `twin_translate` skill (`model: local`, `skills/twin_translate/SKILL.md`) which returns a JSON array of `{text, kind, confidence}` hits.
3. For each hit ≥0.5 confidence not already in the registry, we allocate a new anonymous label (`Person-N`, `Place-N`, `Institution-N`, `Detail-N`) and INSERT with `detected_by='auto_ner'`, `confirmed=FALSE`.
4. `resetEntityNameCache()` bust so the very next `translateToAnonymous` / guard check in the same request picks up the new rows.

Modes (`MEMU_TWIN_NOVEL_MODE`):
- **auto** — detect + auto-register (default).
- **prompt** — detect, log, but don't register; requires family approval (not yet implemented, currently degrades to no-op).
- **off** — skip entirely.

Tier-2 note: `twin_translate` is `model: local`. With Ollama unwired, set `MEMU_MODEL_OVERRIDE_LOCAL=haiku` to route it to Claude Haiku. The tradeoff — raw proper nouns sent to Haiku for extraction — is documented in `docs/INTEGRATION_CONTRACTS.md` §7.

**Deviation from spec:** The spec called for a new `quasi_identifiers` table. The existing `entity_registry` already supports the full `CHECK` enum (person/school/workplace/medical/location/activity/business/institution/other) plus `detected_by` + `confirmed` columns, so we reused it rather than creating parallel structure. Entry point and detection are the only new surface.

**Twin Registry mobile screen.** New screen at `mobile/app/twin-registry.tsx` (linked from Settings → Privacy → "Twin Registry"). Lists all mappings grouped by `entity_type`, flags auto-detected entries as "Auto-detected" until the user confirms them, supports add / edit / delete. Four new backend CRUD routes at `/api/twin/registry[/:id]`, four new mobile API methods (`getTwinRegistry` / `addTwinEntity` / `updateTwinEntity` / `deleteTwinEntity`).

Tests: `src/twin/novel.test.ts` covers mode resolution (auto default, explicit values, invalid fallback).

### Story 1.4 — Twin enforcement as runtime invariant (2026-04-16)

The Digital Twin is now a runtime invariant, not a developer convention. Every dispatch for a skill with `requires_twin: true` in its frontmatter passes through `src/twin/guard.ts` immediately before the provider call. The guard loads the family's `entity_registry.real_name` list and scans system prompt + user prompt + history for whole-word matches (case-insensitive, regex-escaped).

Modes (`MEMU_TWIN_GUARD_MODE`):
- **throw** — refuse to dispatch, raise `TwinViolationError`, write `status='error'` + `twin_violations` to the ledger. Default in development.
- **log_and_anonymize** — auto-translate the leaking fields through `translateToAnonymous`, proceed with dispatch, write `status='ok'` + `twin_verified=true` + `twin_violations` to the ledger. Default in production.
- **off** — skip the check entirely. Not recommended.

Ledger shape extended by migration 007: `twin_violations JSONB` column records which entities were about to leak. Every ok dispatch of a `requires_twin: true` skill now sets `twin_verified=true` when the check passed cleanly (empty violations) or when auto-anonymisation salvaged it.

The guard is applied at the lowest possible level — inside `router.dispatch()` — so every call path is covered, including ones that don't yet exist. Skills with `requires_twin: false` or undefined skip the guard entirely.

Tests (`src/twin/guard.test.ts`, 17 tests): word-boundary detection, case insensitivity, regex escape for names with dots/apostrophes, mode resolution (dev/prod/override/invalid), throw-mode error carries skill name + violations, system/user/history all scanned, off-mode bypass.

What this unlocks: Tier 1 multi-tenancy, EDPB Opinion 28/2024 anonymisation defensibility, and the parent-facing Privacy Ledger claim "Memu cannot send your real name even if the developer forgot". The guarantee is now mechanical.

### Story 1.3 — Integration contracts documentation (2026-04-15)

New file `docs/INTEGRATION_CONTRACTS.md` documents the cross-repo integration surface for Tier 2 deployment. Nine contracts: Postgres (separate `memu_core` database, never touches Synapse/Immich/Baikal), Docker network (`memu-suite_memu_net`), Baikal CalDAV (read-only), Immich REST (planned, read-only), Matrix/Synapse (placeholder for Tier 3), file system bind-mounts (including the forthcoming `spaces/<family_id>/` tree as catastrophic-loss territory), `family_id` scoping (**flagged as a gap** — 0 occurrences in schema today, required before Tier 1), mobile ↔ backend API contract, env variable surface.

Each contract lists what memu-core expects, what memu-os provides, and the blast radius when either side breaks it. The document is the source of truth for cross-repo change management.

### Story 1.2 — BYOK for adults (2026-04-15)

Adult profiles can paste their own Anthropic API key in Settings. The key is encrypted AES-256-GCM at rest (table `profile_provider_keys`, migration 006) using a master key in `MEMU_BYOK_ENCRYPTION_KEY` — generate with `openssl rand -base64 32`. If the master key is unset, BYOK is silently unavailable and the deployment key is always used.

Key behaviours:
- **Scope of use.** Only calls *on behalf of a single user* use that user's BYOK key — currently `interactive_query` (chat) and `autolearn`. Family-level pipeline steps (extraction, synthesis, briefing, vision, import) use the deployment key because they process group content not attributable to one user. Opt-in is explicit: `dispatch({ ..., useBYOK: true })`.
- **Children blocked.** `setProviderKey()` refuses profiles with `role = 'child'`. The Settings UI hides the entire AI-provider section when the backend returns a `reason` string (child or BYOK disabled).
- **Ledger tracks which key was used.** Every dispatch logs a `key_identifier` — either `deployment:claude` or `byok:<profileId>:<provider>:<hint>`. Hareesh verifies his Anthropic console shows the call; Rach's call shows `deployment:claude`.
- **Toggle without revoking.** Keys can be disabled (kept stored) or removed entirely. Disabled keys resolve to null so dispatch falls back to deployment.
- **Key hint stored separately.** `key_hint` column (`…xyz9`) lets the UI show which key is in use without decrypting.

Files: `src/security/byok.ts` (crypto + CRUD), `src/security/byok.test.ts` (round-trip tests), `migrations/006_byok.sql`, `/api/profile/byok` routes (GET/POST/DELETE/toggle), `mobile/lib/api.ts` methods, `mobile/app/(tabs)/settings.tsx` AI-provider section.

Providers plumbed: `anthropic`, `gemini`, `openai`. Only `anthropic` is surfaced in the mobile UI — the rest will follow when there's a reason to expose them.

### Story 1.1 — Model router with skills-driven dispatch (2026-04-15)

Every LLM call now routes through `src/skills/router.ts`. The router reads the `model` / `cost_tier` / `requires_twin` fields from each skill's frontmatter and resolves them to a concrete provider + model. There are no hardcoded model strings anywhere outside the router.

Key behaviours:
- **Per-skill model choice.** Change `model: haiku` to `model: sonnet` in a `SKILL.md` and extraction now uses Sonnet on the next run — no code changes required. The Sonnet-for-extraction bug is fixed by `skills/extraction/SKILL.md` specifying `model: haiku`.
- **Env overrides.** A Tier 3 deployment can substitute local models for any alias: `MEMU_MODEL_OVERRIDE_HAIKU=local`, `MEMU_MODEL_OVERRIDE_SONNET=local`, etc. Skills don't change; routing changes.
- **Budget-pressure downgrades.** `MEMU_BUDGET_PRESSURE=true` downgrades premium→haiku and standard sonnet→haiku without editing skills.
- **Privacy Ledger.** Every dispatch is logged to the `privacy_ledger` table (migration 005) — skill name, requested vs dispatched model, provider, cost tier, requires_twin, token counts, latency, key identifier, dry_run flag. Append-only.
- **Dry-run mode.** `dispatch({ skill, dryRun: true, ... })` returns the plan without calling the provider. Useful for Settings-UI previews and tests.
- **requires_twin flag is plumbed** (written to ledger) but not yet enforced as a runtime invariant — that's Story 1.4.
- **Local/Ollama.** Not wired yet. Calls that resolve to `provider: 'ollama'` throw a clear error until Tier 3 work lands.

Concrete model strings live in router env defaults (`MEMU_CLAUDE_HAIKU_MODEL`, `MEMU_CLAUDE_SONNET_MODEL`, `MEMU_GEMINI_FLASH_MODEL`, `MEMU_GEMINI_FLASH_LITE_MODEL`, `MEMU_OLLAMA_MODEL`) so provider-side model upgrades don't require a code change either.

Deleted: `src/intelligence/provider.ts` (the single-env-var switch). `claude.ts` and `gemini.ts` are now thin SDK wrappers exposing `callClaude()` / `callGemini()` — the router is the only caller.

### Story 1.0 — Agent Skills adopted as prompt format (2026-04-15)

All procedural prompts lifted out of TS string literals into `skills/<name>/SKILL.md` files following the Agent Skills open standard (Anthropic Dec 2025, adopted by OpenAI Codex, Gemini CLI, etc.). Prompts are now:

- **Versionable** — diff-able markdown, git history shows prompt evolution
- **Portable** — same SKILL.md runs across Claude / Gemini / Ollama
- **Readable by non-developers** — open in any text editor and edit the prompt without touching code

`src/skills/loader.ts` parses frontmatter with gray-matter, validates required fields (`name`, `description`, `model`, optionally `cost_tier`, `requires_twin`, `version`), and exposes `getSkill(name)` / `renderSkill(name, vars)`. Boot calls `validateAllSkills()` so a broken skill crashes startup, not the first LLM call.

Current skills: `extraction`, `synthesis_update`, `synthesis_write`, `reflection`, `briefing`, `vision`, `twin_translate`, `interactive_query`, `autolearn`, `import_extract`. Every inline prompt in extraction / synthesis / briefing / vision / claude / autolearn / import has been refactored to read from the skill.

Model choice is still hardcoded in call sites (Story 1.1 — ModelRouter — is next and routes via skill frontmatter).

### Indigo Sanctuary sprint — Sessions A–M shipped (2026-04-15)

A 13-session polish pass took the mobile app from rough beta to personal-use-ready. All sessions complete except M (final device walk-through + EAS build + Z2 push):

- **A–B:** Indigo Sanctuary design tokens (Manrope headline + Inter body, primary #5054B5, tertiary #645A7A), reusable shells (Masthead, AIInsightCard, StatusPill, ScreenHeader, ScreenContainer, GradientButton).
- **C–H:** Every tab redesigned and fully wired — Today (hero synthesis + calendar strip + stream + shopping footer), Chat (Family/Personal layer toggle), Spaces (asymmetric grid + detail modal + **manual create FAB** as of 2026-04-15), Lists, Calendar, Settings.
- **I:** Privacy Ledger mobile polish (v5 Sanctuary).
- **J:** Per-person context isolation — `migrations/003_context_visibility.sql` adds `visibility` + `owner_profile_id` to `context_entries`; orchestrator respects Family vs Personal boundary at query time; UI toggle in Chat.
- **K:** Morning briefing push — `src/channels/mobile.ts` (Expo Push via fetch) + `push_tokens` table + `node-cron '0 7 * * *' Europe/London` + deep-link handler in `_layout.tsx`.
- **L:** `ErrorBoundary` + `crashlog.ts` (SecureStore, last 3 entries) + `ToastProvider` + mailto escape hatch. No telemetry.
- **M (in progress):** TS green both sides (already passing), device test, EAS APK, Z2 deploy.

### Also shipped 2026-04-15
- **Shopping extraction fix** — `src/intelligence/extraction.ts` prompt now emits one card per item (title = item, body = quantity/note), `max_tokens` 300→800. "Buy milk and eggs" → two cards.
- **Manual Space creation** — `POST /api/spaces`, `createSpace()` in mobile API, FAB + category picker modal in Spaces tab.
- **Migration runner** — `src/db/migrate.ts` with `schema_migrations` tracking, auto-applied at boot.

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
- PWA dashboard (briefing + stream cards + shopping list + chat drawer + card actions + edit modal)
- Kids portal (large-font chat with conversation history)
- CORS enabled for mobile app connections
- Privacy Ledger API endpoint (`/api/ledger`)
- **Mobile app (Expo SDK 54)** -- 4 tabs (Today, Chat, Lists, Settings), custom chat UI, Privacy Ledger modal, brand icons (three-circle mark), connects to backend via HTTPS
- **Mobile chat → Claude pipeline working end-to-end** (message → Digital Twin → Claude → response)
- **Stream card confirm/edit/dismiss** -- human-in-the-middle pattern working on mobile + PWA
- **Conversation history** -- multi-turn chat across all surfaces (mobile, PWA, kids portal). Last 10 exchanges sent to Claude for context. Chat persists across app restarts via `GET /api/chat/history`. Claude receives anonymous conversation history so Digital Twin privacy is maintained across turns.
- **General-purpose AI mode** -- system prompt updated so Memu works as both Chief of Staff AND general AI assistant. Users can ask about anything (work, knowledge, drafting, creative) not just family topics. Digital Twin anonymisation runs regardless of topic.

### Building Now (Critical Path -- Beta Sessions 5-8)
1. ~~Stream card confirm/edit/dismiss~~ -- DONE (Session 3)
2. ~~Conversation history + message persistence~~ -- DONE (Session 4)
3. **Auto-learning** -- extract facts/preferences from every conversation into `context_entries` automatically (Session 5)
4. **WhatsApp .txt import** -- parse exported chat for context seeding (Session 6)
5. **Push notifications** -- morning briefing via Expo Push (Session 7)
6. **Onboarding flow** -- server connect + profile + calendar (Session 8)

### Also Needed Before Beta
- Stable deployment (VPS or Tailscale, not ngrok)
- Device walk-through + EAS APK build (Session M close-out)

### Candidate architectural shifts (identified 2026-04-15, NOT YET DECIDED)
These came out of the next-priorities review + Skills research at end of 13-session sprint. Needs a planning session before any code:
1. **Synthesis-first retrieval** — flip the answer path from vector RAG (`context.ts`) to compiled pages (`synthesis_pages`). Scaffolding exists; retrieval still uses `context_entries`.
2. **Skills-shaped prompts** — lift system prompts from TS string literals in `extraction.ts`, `synthesis.ts`, `briefing.ts`, `vision.ts` into `skills/*/SKILL.md` with YAML frontmatter. Open standard (Anthropic + Gemini CLI both adopted). Portable to Ollama when docked.
3. **Progressive disclosure for Spaces** — each Space *is* effectively a skill: metadata (title + category + ~1-line description) in system prompt, full `body_markdown` loads only when relevant. Collapses synthesis shift + model router into one move.
4. **Model router with tier frontmatter** — `model: haiku | sonnet | local-ollama` in each skill's YAML; `provider.ts` reads it. Replaces the single env-var provider switch.
5. **Reflection loop** — new capability: scheduled pass that notices patterns across recent conversations (not built, not started).
6. **BYOK per user** — per-profile Anthropic key column + settings UI.

### Not Yet Built
- Telegram Bot channel
- Share Extension ("Share to Memu" from any app)
- Email observer (IMAP)
- Photo observer (Immich integration, when docked)
- Billing/subscription system
- Child safety classification UI (schema exists, frontend doesn't)
- Comprehensive test suite
- Production monitoring
- DPIA template, Hetzner exit plan, tier-migration procedure, integration contracts doc (writing tasks, not code)

### Open question — platform convergence
At end of this sprint, memu-core has moved fast (mobile app, Spaces, push, per-person isolation, Indigo Sanctuary). memu-os has its own parallel track (Matrix/Immich/Ollama, touchscreen dashboard). The two were supposed to compose, but it's not clear from reading either CLAUDE.md whether the **docking contract** — how memu-core plugs into memu-os — still holds. Needs a cross-repo review session: compare `memu-platform/02-ARCHITECTURE.md` against what's actually in both codebases, reconcile the Skills question across both, and decide whether anything has quietly diverged.

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
| 2026-04-02 | Kickstarter deferred, app-first strategy | June 2026 not realistic. Ship Memu app first, get 10 families using it, then Kickstarter for Memu Home. |
| 2026-04-02 | Two modes, one experience | Memu is both proactive Chief of Staff AND general-purpose private AI. Users never pick a mode. |
| 2026-04-02 | Digital Twin + Privacy Ledger is the marketing wedge | Not hardware, not self-hosting. "See exactly what the AI received" is the viral moment. |
| 2026-04-02 | Naming simplified | User-facing: "Memu" (the app) and "Memu Home" (the box). Internal repo names stay. |
| 2026-04-02 | DMA interoperability noted as strategic opportunity | When EU DMA group messaging interop arrives (~2027), Memu's Matrix infrastructure gets official WhatsApp bridge for free. |
| 2026-04-15 | Indigo Sanctuary 13-session polish sprint shipped | App is personal-use-ready. Per-person isolation, morning push, crash recovery, manual Space create, shopping fix all in. |
| 2026-04-15 | Skills / progressive disclosure flagged as likely next architectural shift | Open standard adopted by both Anthropic and Gemini CLI. SKILL.md format is provider-portable. Would collapse synthesis-layer shift + model router + Ollama path into one move. Needs a planning session before commit. |
| 2026-04-15 | Platform-convergence review identified as needed | memu-core and memu-os moved in parallel. Docking contract in `memu-platform/02-ARCHITECTURE.md` may have drifted from both codebases. Schedule a cross-repo review before the next major feature. |

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
