# MEMU-CORE: Repository Initialisation Brief

## For: Gemini (CTO / Co-builder)
## From: Hareesh + Claude (Product & Architecture)
## Date: March 2026

---

## 1. What This Is

We need a new GitHub repository called `memu-core` (or `memu-gateway`). This is the v3 Memu product — the Family Chief of Staff engine. It is a standalone Node.js service that connects to WhatsApp via Baileys, translates family context through an Anonymous Family Digital Twin, routes queries to Claude API, and delivers responses back via WhatsApp.

This is NOT a modification of the existing `memu-os` / `memu.digital` repository. It is a new, clean, lightweight codebase. The existing sovereign stack (Matrix, Immich, Baikal, Ollama) remains untouched. `memu-core` sits alongside it on the same hardware and observes existing services through their APIs.

---

## 2. The Existing Infrastructure (Do Not Touch)

The HP Z2 Tower (memu-hub) currently runs these services via Docker Compose:

| Container | Image | Ports | Purpose |
|---|---|---|---|
| memu_postgres | tensorchord/pgvecto-rs:pg15-v0.2.0 | 5432 (internal) | PostgreSQL with vector extensions |
| memu_redis | redis:6.2-alpine | 6379 (internal) | Cache |
| memu_synapse | matrixdotorg/synapse:latest | 8008 | Matrix homeserver |
| memu_element | ghcr.io/cinnyapp/cinny:v4.2.3 | 8080 | Chat UI |
| memu_photos | ghcr.io/immich-app/immich-server:release | 2283 | Photo server |
| memu_photos_ml | ghcr.io/immich-app/immich-machine-learning:v1.124.0 | internal | Immich ML |
| memu_calendar | ckulka/baikal:0.9.5-apache | internal | CalDAV server |
| memu_brain | ollama/ollama:latest | 11434 | LLM inference |
| memu_intelligence | memu-suite-intelligence (Python) | internal | Current Matrix bot |
| memu_bootstrap | memu-suite-bootstrap (Python/Flask) | 8888 (internal) | Setup wizard |
| memu_proxy | nginx:1.27-alpine | 80, 443 | Reverse proxy |

Docker network: `memu-suite_memu_net`
PostgreSQL databases: `immich` (Immich tables + household_memory, shared_lists, reminders), `memu_synapse`
PostgreSQL user: `memu_user`
Tailscale: Running on host OS (not Docker), hostname `memu-hub`
OS: Ubuntu 24.04
Hardware: Intel i7-8700 (12 threads), 16GB RAM, 227GB disk (41GB free)

**CRITICAL RULES:**
- Do NOT modify any existing container, volume, database, or config
- Do NOT use ports 80, 443, 2283, 8008, 8080, 11434, 8888, 5432, 6379
- Do NOT create tables in the `immich` or `memu_synapse` databases
- DO join the existing Docker network `memu-suite_memu_net` (for internal access to Ollama, Baikal, Immich APIs)
- DO create a NEW database called `memu_core` inside the existing PostgreSQL instance

---

## 3. The memu-core Architecture

### Tech Stack

| Component | Technology | Why |
|---|---|---|
| Runtime | Node.js 20 LTS with Fastify | Fast, lightweight, same language as Baileys |
| WhatsApp | Baileys (WhiskeySockets/Baileys) | WhatsApp Web protocol, used by OpenClaw/NanoClaw |
| Database | PostgreSQL + pgvector (existing instance, new database) | Already running, vector search for RAG |
| AI (interactive) | Anthropic Claude API (@anthropic-ai/sdk) | Sonnet for adults, Haiku for children |
| AI (batch/overnight) | Ollama via existing memu_brain container | Entity detection, summarisation, briefing generation |
| Embeddings | nomic-embed-text via Ollama (or Anthropic embed API) | Vector embeddings for semantic search |
| Calendar | CalDAV client (connecting to existing Baikal) + Google Calendar API | Read-only observation |
| Email | IMAP client (imapflow) | Polling for school emails, appointments |
| Scheduling | node-cron | Morning briefing, overnight batch jobs |
| Container | Docker (single container for the gateway) | Deployable anywhere |

### Port Allocation

**memu-core gateway: port 3100** (web dashboard / PWA / API)

### Database Strategy

Create a new database `memu_core` inside the existing PostgreSQL instance. This requires running one SQL command via the existing memu_postgres container:

```bash
docker exec memu_postgres psql -U memu_user -d postgres -c "CREATE DATABASE memu_core OWNER memu_user;"
docker exec memu_postgres psql -U memu_user -d memu_core -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Then apply the full schema (see Section 4 below).

---

## 4. Database Schema

```sql
-- ============================================================
-- MEMU CORE SCHEMA v3.0
-- Database: memu_core (separate from immich and memu_synapse)
-- ============================================================

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- TWIN: Profiles and Personas
-- ============================================================

CREATE TABLE profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'adult', 'child')),
  date_of_birth DATE,
  school_year INTEGER,
  ai_model TEXT DEFAULT 'claude-sonnet-4-6',
  system_prompt_override TEXT,
  daily_query_limit INTEGER,  -- NULL = unlimited, 50 default for children
  encryption_key_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE profile_channels (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,  -- 'whatsapp', 'telegram', 'web', 'matrix'
  channel_identifier TEXT NOT NULL,  -- phone number, username, session ID
  is_primary BOOLEAN DEFAULT FALSE,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (profile_id, channel)
);

CREATE TABLE personas (
  id TEXT PRIMARY KEY,  -- 'adult-1', 'child-1', etc.
  profile_id TEXT UNIQUE REFERENCES profiles(id) ON DELETE SET NULL,
  persona_label TEXT NOT NULL,  -- 'Adult-1', 'Child-1'
  attributes JSONB DEFAULT '{}',  -- age, interests, dietary requirements (anonymous)
  relationships JSONB DEFAULT '[]',  -- [{"persona": "adult-1", "relationship": "partner"}]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TWIN: Entity Registry
-- ============================================================

CREATE TABLE entity_registry (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'person', 'school', 'workplace', 'medical', 'location',
    'activity', 'business', 'institution', 'other'
  )),
  real_name TEXT NOT NULL,  -- "Ridgeway Primary" (encrypted at rest for cloud tier)
  anonymous_label TEXT NOT NULL,  -- "School-1"
  attributes JSONB DEFAULT '{}',
  detected_by TEXT DEFAULT 'manual',  -- 'manual', 'auto_ner', 'auto_pattern'
  confirmed BOOLEAN DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT REFERENCES profiles(id)
);

CREATE TABLE entity_relationships (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entity_id TEXT NOT NULL REFERENCES entity_registry(id) ON DELETE CASCADE,
  related_entity_id TEXT REFERENCES entity_registry(id),
  related_persona_id TEXT REFERENCES personas(id),
  relationship_type TEXT NOT NULL,  -- 'attends', 'works_at', 'friend_of', 'located_at'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONVERSATIONS AND MESSAGES
-- ============================================================

CREATE TABLE conversations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content_original TEXT NOT NULL,
  content_translated TEXT,  -- anonymous twin translation
  content_enriched TEXT,  -- full prompt with context injection
  content_response_raw TEXT,  -- Claude's anonymous response
  content_response_translated TEXT,  -- response with real names restored
  entity_translations JSONB,  -- [{"real": "Robin", "anonymous": "Child-1"}]
  context_sources JSONB,  -- which context was injected
  actions_requested JSONB,
  actions_executed JSONB,
  flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  latency_ms INTEGER,
  cloud_model TEXT,
  cloud_tokens_in INTEGER,
  cloud_tokens_out INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONTEXT STORE (observed family data)
-- ============================================================

CREATE TABLE context_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source TEXT NOT NULL CHECK (source IN (
    'whatsapp_group', 'whatsapp_dm', 'matrix',
    'google_calendar', 'ical', 'baikal',
    'gmail', 'imap',
    'google_photos', 'immich',
    'document', 'manual',
    'summary_daily', 'summary_weekly'
  )),
  source_id TEXT,  -- external message/event ID for deduplication
  content TEXT NOT NULL,
  content_summary TEXT,  -- LLM-generated summary
  participants JSONB,  -- who was involved (as persona IDs)
  occurred_at TIMESTAMPTZ,  -- when the event/message happened
  metadata JSONB DEFAULT '{}',
  embedding vector(384),  -- pgvector for semantic search
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_context_embedding ON context_entries
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_context_source ON context_entries(source);
CREATE INDEX idx_context_occurred ON context_entries(occurred_at DESC);

-- ============================================================
-- ACTIONS (agentic capability)
-- ============================================================

CREATE TABLE actions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_id TEXT REFERENCES messages(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'calendar_create', 'calendar_modify', 'calendar_cancel',
    'reminder_set', 'shopping_add', 'shopping_remove',
    'research', 'message_draft', 'message_send',
    'booking_research', 'booking_confirm'
  )),
  instruction_anonymous TEXT NOT NULL,
  instruction_translated TEXT NOT NULL,
  approval_level TEXT NOT NULL CHECK (approval_level IN (
    'auto_execute', 'notify_and_execute', 'request_approval', 'never_auto'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'executed', 'failed'
  )),
  approved_by TEXT REFERENCES profiles(id),
  executed_at TIMESTAMPTZ,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CHILD SAFETY
-- ============================================================

CREATE TABLE alerts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_id TEXT NOT NULL REFERENCES messages(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'content_flag', 'safety_concern', 'pii_leak', 'unusual_pattern'
  )),
  description TEXT NOT NULL,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_by TEXT REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE content_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('block_topic', 'flag_topic', 'allow_topic')),
  pattern TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('block', 'flag', 'allow')),
  applies_to TEXT REFERENCES profiles(id),  -- NULL = all children
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OBSERVER CONFIGURATION
-- ============================================================

CREATE TABLE allowed_groups (
  group_jid TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  group_name TEXT,
  observation_enabled BOOLEAN DEFAULT TRUE,
  memu_can_respond BOOLEAN DEFAULT TRUE,
  added_by TEXT REFERENCES profiles(id),
  added_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE observer_config (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  observer_type TEXT NOT NULL CHECK (observer_type IN (
    'whatsapp_group', 'google_calendar', 'ical', 'baikal',
    'gmail', 'imap', 'google_photos', 'immich'
  )),
  enabled BOOLEAN DEFAULT FALSE,
  config JSONB DEFAULT '{}',  -- provider-specific (OAuth tokens, IMAP creds, etc.)
  last_sync_at TIMESTAMPTZ,
  sync_interval_minutes INTEGER DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT AND SAFETY
-- ============================================================

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor_profile_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_profile_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- NO DELETE PERMISSIONS on audit_log in application layer

-- ============================================================
-- SETTINGS
-- ============================================================

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('anthropic_api_key', ''),
  ('morning_briefing_enabled', 'true'),
  ('morning_briefing_time', '07:00'),
  ('morning_briefing_group', ''),
  ('calendar_provider', 'baikal'),
  ('email_provider', 'none'),
  ('photo_provider', 'immich'),
  ('timezone', 'Europe/London'),
  ('weather_city', 'Ivybridge'),
  ('weather_country', 'UK');
```

---

## 5. Project Structure

```
memu-core/
├── README.md                    # The viral README (see Section 7)
├── LICENSE                      # AGPLv3
├── package.json
├── docker-compose.yml           # Standalone deployment (Tier 0/1)
├── docker-compose.home.yml      # Home deployment (connects to existing memu-suite)
├── .env.example
├── schema.sql                   # Full database schema above
│
├── src/
│   ├── index.ts                 # Fastify server entry point
│   ├── config.ts                # Environment config loader
│   │
│   ├── channels/                # Channel connectors (channel-agnostic)
│   │   ├── types.ts             # ChannelConnector interface
│   │   ├── whatsapp.ts          # Baileys WhatsApp connector
│   │   └── web.ts               # PWA/Web connector (future)
│   │
│   ├── twin/                    # Anonymous Family Digital Twin
│   │   ├── translator.ts        # Real ↔ anonymous translation engine
│   │   ├── registry.ts          # Entity registry management
│   │   └── personas.ts          # Persona management
│   │
│   ├── intelligence/            # AI orchestration
│   │   ├── orchestrator.ts      # Main message handling pipeline
│   │   ├── context.ts           # Context retrieval (semantic + temporal)
│   │   ├── prompts.ts           # System prompts (adult, child)
│   │   ├── router.ts            # Model routing (Haiku/Sonnet/Opus)
│   │   └── actions.ts           # Action detection and parsing
│   │
│   ├── observers/               # Context ingestion
│   │   ├── whatsapp-group.ts    # WhatsApp group observer
│   │   ├── calendar.ts          # Google Calendar / CalDAV observer
│   │   ├── email.ts             # IMAP observer
│   │   └── photos.ts            # Photo metadata observer (future)
│   │
│   ├── safety/                  # Child safety and content filtering
│   │   ├── filter.ts            # Response content filter
│   │   ├── alerts.ts            # Alert generation and parent notification
│   │   └── rules.ts             # Content rules engine
│   │
│   ├── actions/                 # Agentic action executors
│   │   ├── executor.ts          # Action execution router
│   │   ├── calendar.ts          # Calendar actions (create/modify/cancel)
│   │   ├── reminders.ts         # Reminder actions
│   │   ├── shopping.ts          # Shopping list actions
│   │   └── approval.ts          # Approval framework
│   │
│   ├── batch/                   # Overnight batch processing
│   │   ├── scheduler.ts         # Cron job scheduler
│   │   ├── entity-detection.ts  # NER via local LLM
│   │   ├── summarisation.ts     # Context summarisation
│   │   ├── embeddings.ts        # Vector embedding generation
│   │   └── briefing.ts          # Morning briefing assembly
│   │
│   ├── dashboard/               # Parent dashboard (web UI)
│   │   ├── routes.ts            # API routes for dashboard
│   │   └── public/              # Static HTML/CSS/JS
│   │
│   └── db/                      # Database layer
│       ├── connection.ts        # PostgreSQL connection pool
│       ├── profiles.ts          # Profile CRUD
│       ├── messages.ts          # Message storage
│       ├── context.ts           # Context entry CRUD + vector search
│       ├── entities.ts          # Entity registry CRUD
│       └── settings.ts          # Settings CRUD
│
├── tests/
│   ├── twin/                    # Twin translation tests
│   │   └── translator.test.ts
│   ├── intelligence/
│   │   └── orchestrator.test.ts
│   └── safety/
│       └── filter.test.ts
│
└── docs/
    ├── ARCHITECTURE.md          # Architecture overview
    ├── PRIVACY.md               # Privacy model explained
    ├── SETUP.md                 # Setup guide
    └── CONTRIBUTING.md
```

---

## 6. Docker Compose Files

### docker-compose.yml (Standalone — Tier 0/1, for new users)

```yaml
# For fresh deployments: laptop, VPS, or new hardware
# Includes its own PostgreSQL instance
services:
  gateway:
    build: .
    container_name: memu_core
    ports:
      - "3100:3100"
    environment:
      - DATABASE_URL=postgresql://memu:${DB_PASSWORD}@db:5432/memu_core
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OLLAMA_HOST=${OLLAMA_HOST:-}
      - ENABLE_CALENDAR_OBSERVER=${ENABLE_CALENDAR:-false}
      - ENABLE_EMAIL_OBSERVER=${ENABLE_EMAIL:-false}
      - ENABLE_PHOTO_OBSERVER=${ENABLE_PHOTOS:-false}
      - TZ=${TZ:-Europe/London}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: pgvector/pgvector:pg16
    container_name: memu_core_db
    environment:
      - POSTGRES_DB=memu_core
      - POSTGRES_USER=memu
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./schema.sql:/docker-entrypoint-initdb.d/schema.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U memu -d memu_core"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

### docker-compose.home.yml (Home deployment — Tier 2, for Hareesh's Z2)

```yaml
# For deployment alongside existing memu-suite stack
# Uses existing PostgreSQL, Ollama, and Docker network
# IMPORTANT: Run schema.sql against existing PostgreSQL first (see SETUP.md)
services:
  gateway:
    build: .
    container_name: memu_core
    ports:
      - "3100:3100"
    environment:
      - DATABASE_URL=postgresql://memu_user:${DB_PASSWORD}@memu_postgres:5432/memu_core
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OLLAMA_HOST=http://memu_brain:11434
      - IMMICH_API_URL=http://memu_photos:2283
      - IMMICH_API_KEY=${IMMICH_API_KEY}
      - BAIKAL_URL=http://memu_calendar:80
      - BAIKAL_USERNAME=${CALDAV_USERNAME}
      - BAIKAL_PASSWORD=${CALDAV_PASSWORD}
      - ENABLE_CALENDAR_OBSERVER=true
      - ENABLE_EMAIL_OBSERVER=${ENABLE_EMAIL:-false}
      - ENABLE_PHOTO_OBSERVER=true
      - TZ=Europe/London
    networks:
      - memu-suite_memu_net
    restart: unless-stopped

networks:
  memu-suite_memu_net:
    external: true
```

---

## 7. README Outline (The Viral Hook)

The README should open with:

```
# Memu: Your Family's Chief of Staff

The power of OpenClaw. The privacy of Signal. Built for families.

Add Memu to your family's WhatsApp. It reads your calendar, observes your
family group chat, and answers questions using the full power of Claude —
without the AI ever learning your family's name.

## How It Works

You text Memu: "What should we get Rach for her birthday?"

Memu knows: her birthday is in 4 weeks (calendar), she mentioned
paddleboarding last month (family group chat), you took coastal walk
photos in September (photo metadata).

What Claude sees: "What should we get Adult-2 for their birthday?
Context: birthday in 4 weeks, Adult-2 mentioned Activity-7 last month,
coastal walk photos in September."

What Claude never sees: Rach. Paddleboarding. Your address. Your school.
Your children's names.

## Quick Start

docker compose up
# Scan QR code
# Start texting

Time to magic: 3 minutes.
```

---

## 8. What To Build First (Slice 1)

Priority order for the first working version:

1. **Fastify server** — boots, serves health endpoint on port 3100
2. **PostgreSQL connection** — connects to database, runs schema
3. **Baileys connector** — displays QR code in terminal, connects to WhatsApp
4. **Profile lookup** — maps incoming phone number to a profile
5. **Twin translator** — loads entity registry, translates message real → anonymous
6. **Claude API call** — sends anonymous prompt, receives response
7. **Reverse translation** — translates response anonymous → real
8. **WhatsApp reply** — sends response back via Baileys
9. **Message storage** — writes full audit trail to messages table

That's Slice 1. One weekend. The test: Hareesh texts Memu on WhatsApp, Memu responds via Claude, the Claude API log contains zero real names.

---

## 9. Key Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "@whiskeysockets/baileys": "latest",
    "fastify": "^4",
    "@fastify/static": "^7",
    "pg": "^8",
    "pgvector": "^0.2",
    "node-cron": "^3",
    "imapflow": "^1",
    "dotenv": "^16"
  },
  "devDependencies": {
    "typescript": "^5",
    "tsx": "^4",
    "@types/node": "^20",
    "@types/pg": "^8",
    "vitest": "^1"
  }
}
```

---

## 10. Reference Documents

The full product specification (v3, 1081 lines, 21 sections) is available separately. Key sections for Gemini:

- **Section 3.1**: Anonymous Family Digital Twin (the translation architecture)
- **Section 3.2**: Privacy-Preserving Agentic Actions (capability envelope)
- **Section 5**: Technical Architecture diagram
- **Section 8**: Separation, Safety, and Family Change
- **Section 11**: Full database schema
- **Section 13**: Cloud Tier Privacy Architecture (three trust levels)
- **Section 14**: Data Lifecycle (ingestion → enrichment → retrieval)
- **Section 15**: Alignment with Anthropic best practices

---

## 11. What NOT To Do

- Do NOT build a React Native or mobile app. WhatsApp IS the app. The dashboard is a web page.
- Do NOT integrate with WhatsApp Business API. Baileys uses WhatsApp Web protocol.
- Do NOT store real names in plaintext in any log files, console output, or error messages.
- Do NOT give the AI direct access to any credentials (OAuth tokens, IMAP passwords, API keys).
- Do NOT send the full chat history to Claude on every request. Use context retrieval (semantic search + temporal + recent).
- Do NOT skip the twin translation for any message, even if it seems harmless.
- Do NOT auto-execute any action that affects someone other than the person who asked.
