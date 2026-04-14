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
  email TEXT,
  api_key TEXT UNIQUE,
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
  credentials JSONB, -- Stores Google OAuth refresh tokens
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
  visibility TEXT NOT NULL DEFAULT 'family'
    CHECK (visibility IN ('personal', 'family')),
  owner_profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_context_embedding ON context_entries
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_context_source ON context_entries(source);
CREATE INDEX idx_context_occurred ON context_entries(occurred_at DESC);
CREATE INDEX idx_context_visibility ON context_entries(visibility, owner_profile_id);

-- ============================================================
-- SLICE 5: COMPILED SYNTHESIS (ARCHITECTURE V2)
-- ============================================================

CREATE TABLE IF NOT EXISTS synthesis_pages (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('person', 'routine', 'household', 'commitment', 'document')),
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(profile_id, category, title)
);
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

-- ============================================================
-- INTELLIGENCE STREAM (Slice 2c/2d/3)
-- ============================================================
CREATE TABLE stream_cards (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  family_id TEXT NOT NULL,
  card_type TEXT NOT NULL CHECK (card_type IN (
    'collision', 'extraction', 'unfinished_business', 
    'reminder', 'document_extracted', 'calendar_added',
    'proactive_nudge', 'weekly_digest'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN (
    'whatsapp_group', 'calendar', 'email', 'document', 'manual', 'proactive'
  )),
  source_message_id TEXT,          -- links to the original context_entry
  actions JSONB DEFAULT '[]',      -- [{"label": "Reschedule", "type": "action_id"}, ...]
  status TEXT DEFAULT 'active' CHECK (status IN (
    'active', 'resolved', 'dismissed', 'expired'
  )),
  resolved_by TEXT REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ           -- auto-dismiss past events
);

CREATE INDEX idx_stream_family ON stream_cards(family_id, status, created_at DESC);
