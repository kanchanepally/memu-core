# Memu: Your Family's Chief of Staff

> The power of OpenClaw. The privacy of Signal. Built for families.

Memu is a WhatsApp contact that coordinates your family's life. It knows your calendar, reads your family group chat, watches your email — and answers questions using Claude with the full context of your family's world.

The difference: **the AI never learns who you are.**

Every family member's name, every school, every address, every friend's name is translated into anonymous labels before anything reaches Claude. "Alice has swimming at Springfield Leisure Centre" becomes "Child-1 has Activity-3 at Location-2." Claude gives a brilliant answer. Memu translates it back. Your family sees real names. Claude saw none.

This isn't a chatbot with a privacy filter. **It's a Family Chief of Staff** — one that proactively flags scheduling conflicts, reminds you about deadlines, suggests birthday presents based on conversations from last month, and creates calendar events on your behalf. It does everything a brilliant personal assistant would do, except it works for your family and it can't identify you to anyone.

## What a Chief of Staff Does (That a Chatbot Doesn't)

A chatbot answers when you ask. A Chief of Staff **anticipates.**

| Chatbot | Chief of Staff |
|---|---|
| "What's on the calendar Thursday?" → reads you the list | Texts you Wednesday evening: "Heads up — Alice's swimming clashes with the dentist tomorrow. Charlie is in London. You'll need to handle both." |
| "Add milk to the shopping list" → adds milk | Notices you've mentioned needing milk three times this week and haven't bought it. Adds it to the list and reminds you when you're near the shops. |
| "What should I get Charlie for her birthday?" → gives generic ideas | Already knows her birthday is in 3 weeks (calendar), she mentioned paddleboarding last month (family group chat), you took coastal walk photos together in September (photo metadata). Suggests a paddleboarding experience and offers to create the calendar event. |

This is possible because Memu isn't just translating your messages. It's building a **persistent, growing knowledge graph** of your family — from every observed source — and injecting the relevant context into every conversation. Claude becomes brilliant about your family because Memu gives it the context. And Claude stays anonymous because Memu translates the identity.

## How It Works (The Full Picture)

```text
YOUR FAMILY                        MEMU (your hardware)                    CLAUDE (cloud)
                                                     
  You text Memu    ──────►  Gateway receives message
  on WhatsApp                     │
                            Profile identified (Adult-1)
                                  │
                            Twin translates:
                            "Alice" → "Child-1"
                            "Springfield" → "School-1"
                                  │
                            Context assembled:
                            Calendar: Child-1 has Activity-3 Thu 4pm
                            Group chat: Adult-2 said "in London Thu"
                            Email: School-1 non-uniform Friday
                                  │
                            Anonymous prompt built     ──────►  Claude sees:
                                                                "Child-1, Activity-3,
                                                                 Adult-2 in Location-4,
                                                                 School-1 event Friday"
                                                                        │
                            Response received           ◄──────  Claude responds with
                                  │                              anonymous labels
                            Twin translates back:
                            "Child-1" → "Alice"
                            "Adult-2" → "Charlie"
                                  │
  You see the reply  ◄──────  Sent via WhatsApp
  with real names              Full audit trail stored
```

**What Claude sees:** Anonymous labels, family context, no identifying information.
**What Claude never sees:** Your names, your school, your address, your friends.
**What your family sees:** A warm, knowledgeable response with real names — as if Memu knows you personally.

## Five Things That Make Memu Different

### 1. The Anonymous Family Digital Twin
Not a PII stripper that pokes holes in your messages. A complete anonymous model of your family — relationships, schedules, preferences, routines — that gets richer over time. The AI gets *better* context than it would from raw messages, because the twin injects structured information alongside the anonymous query.

### 2. The Context Engine
Memu passively observes your family WhatsApp group, your calendar, and your email. It builds a searchable knowledge graph using vector embeddings (pgvector). When you ask a question, semantic search finds the relevant context from potentially thousands of entries in milliseconds. Claude doesn't search — Memu does, and hands Claude exactly what it needs.

### 3. The Proactive Engine
Every morning at 7am, Memu delivers a briefing to your family WhatsApp group — synthesised from today's calendar, yesterday's emails, and what was said in the group chat. Throughout the day, it nudges you about approaching deadlines, scheduling conflicts, and things you've mentioned but haven't acted on. It doesn't wait to be asked.

### 4. The Capability Envelope
When Memu takes actions (creating calendar events, setting reminders, managing shopping lists), the AI never gets credentials. Claude writes instructions using anonymous labels. Memu's gateway translates and executes the real action locally. The AI planned it. Your hardware did it. The AI never had access to your Google Calendar, your email, or anything else.

### 5. Family-Native Architecture
Every family member has their own private conversation with Memu. Dad's questions are invisible to Mum. Mum's are invisible to Dad. Children get age-appropriate AI with educational guardrails, rate limits, and full parental visibility. If the family changes — separation, divorce — any adult can leave with their data, instantly, without the other's permission. This isn't an individual AI assistant bolted onto a family. It's built for how families actually work.

## Quick Start

```bash
git clone https://github.com/kanchanepally/memu-core.git
cd memu-core
cp .env.example .env
# Add your Claude API key to .env
docker compose up
# Scan QR code to connect WhatsApp
# Start texting
```

Time to magic: **3 minutes.**

## What You Need

| Thing | Why | Cost |
|---|---|---|
| A Claude API key | The AI that answers questions (anonymously) | ~£2-5/month for a typical family |
| A cheap SIM card | Memu's own WhatsApp number (not yours) | £1-2 one-time |
| Docker | Runs Memu | Free |

**Optional (recommended):**
| Thing | Why | How |
|---|---|---|
| Google Calendar access | Memu knows your schedule | OAuth — click "Connect" in setup |
| Email access (IMAP) | Memu reads school emails | Enter IMAP credentials in setup |
| Immich or Google Photos | Memu uses photo context | API key or OAuth in setup |

See the [full setup guide](docs/SETUP.md) for step-by-step instructions on every connection.

## Architecture

Memu has two deployment modes:

**Standalone** (Tier 0/1): Gateway + its own PostgreSQL. Run on a laptop, VPS, or Memu Cloud. Everything in one `docker compose up`.

**Alongside existing infrastructure** (Tier 2/3): Gateway connects to your existing PostgreSQL, Ollama, Immich, and Baikal via Docker network. For self-hosters who already run a home server.

Both modes use the same codebase. Same features. Same privacy guarantees.

## Privacy Model

| What | Where it's processed | Where it's stored |
|---|---|---|
| Your real names and identities | Your hardware only (twin translation) | Your hardware only (encrypted) |
| Anonymous AI queries | Claude API (Anthropic's cloud) | Not stored by Anthropic (API terms) |
| Family context (calendar, chat, email) | Your hardware only | Your hardware only (PostgreSQL) |
| Conversation history | Your hardware only | Your hardware only (encrypted per user) |

**Tier 2+ (home hardware):** Mathematical zero-knowledge. Nothing identifiable ever leaves your house.
**Tier 1 (Memu Cloud):** Ephemeral processing for WhatsApp, zero-knowledge for web. [Full privacy architecture explained.](docs/PRIVACY.md)


## Community

- [Substack: We, Not Them](https://wenotthem.substack.com) — The journey of building Memu
- [GitHub Issues](https://github.com/kanchanepally/memu-core/issues) — Bug reports and feature requests

## License

AGPLv3 — Run it for your family freely. Modify and host for others? Share your code.

---

*Built by a parent who was tired of being the family's middleware.*

*"The question isn't whether families need AI coordination — Nori proved they do. The question is whether the architecture that delivers that coordination should require uploading your family's complete life to a startup's server."*
