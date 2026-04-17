# CLAUDE.md - Memu Core Operating Instructions

**Last updated:** April 2026

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

### Session pickup point — start of next session (2026-04-17 onward)

**Phase 1 of `memu-core-build-backlog 15 April 2026.md` is complete** (Stories 1.0–1.5, all sections below). Tomorrow opens **Phase 2**, which is an architectural shift, not a drop-in feature.

**Don't skip the design pass.** Stories 2.1 (synthesis-first retrieval, `spaces/<family_id>/` filesystem substrate, progressive disclosure, visibility enforcement) and 2.2 (multi-cadence reflection) **must ship paired**. Four design questions to confirm with Hareesh before any code:
1. Where does `spaces/<family_id>/` live on disk? (container volume vs host bind-mount — flagged catastrophic-loss in `docs/INTEGRATION_CONTRACTS.md` §6)
2. `family_id` scoping is still a Tier-1 blocker (1.3 flagged 0 occurrences in schema). Phase 2 introduces per-family paths — natural moment to add it.
3. Visibility enforcement layer — orchestrator-side filter of catalogue, not a prompt instruction.
4. Git author attribution per commit — `simple-git` wrapper.

Re-read backlog lines 306–399 (Stories 2.1, 2.2) at session start. Memory file `project_memu_phase2_resume.md` carries the same context.

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
