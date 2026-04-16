# Memu: Your Family's Chief of Staff

> The power of a world-class AI, the privacy of a local device. Built for families.

Memu is a privacy-first family Chief of Staff. Accessed primarily via a dedicated **Mobile App** (with optional WhatsApp/Telegram fallbacks), Memu coordinates your family's life. It reads your calendar, answers questions, maintains a compiled synthesis of your family's dynamic context ("Spaces"), and actively reflects on this information to notice what you might have missed.

The difference: **the AI never learns who you are.**

Every family member's name, every school, every address, every friend's name is translated into anonymous labels before anything reaches the cloud AI model (e.g., Google Gemini, Anthropic Claude). "Alice has swimming at Springfield Leisure Centre" becomes "Child-1 has Activity-3 at Location-2." The AI gives a brilliant answer. Memu translates it back. Your family sees real names. The AI saw none.

## What a Chief of Staff Does (That a Chatbot Doesn't)

A chatbot answers when you ask. A Chief of Staff **anticipates.**

| Chatbot | Chief of Staff |
|---|---|
| "What's on the calendar Thursday?" → reads you the list | Texts you Wednesday evening: "Heads up — Alice's swimming clashes with the dentist tomorrow. Charlie is in London. You'll need to handle both." |
| "Add milk to the shopping list" → adds milk | Notices you've mentioned needing milk three times this week and haven't bought it. Adds it to the list and reminds you. |
| "What should I get Charlie for her birthday?" → Gives generic ideas | Already knows her birthday is in 3 weeks, she mentioned paddleboarding last month, you took coastal walk photos in September. Suggests a paddleboarding experience. |

## How It Works: The Five Pillars

Memu isn't a simple vector store retrieval tool. It's a structured cognitive architecture for families.

### 1. The Mobile App (Your Primary Interface)
Families interact with Memu primarily through the dedicated Expo mobile app. The app provides a seamless interface containing Chat, custom Spaces, Lists, and the Privacy Ledger. Optional integrations for WhatsApp and Telegram act as secondary channels.

### 2. Compiled Synthesis ("Spaces")
Instead of performing raw semantic search over a haystack of old messages, Memu actively compiles and maintains durable Markdown pages ("Spaces") for every family member, routine, and commitment. When you inform Memu that "Alice started ballet", it updates Alice's page. This compounding context is heavily integrated with the open `SKILL.md` Agent Skills format.

### 3. Reflection
Memu doesn't just wait to be spoken to. Every night, it runs a Reflection pass. It walks the compiled family Spaces to identify contradictions ("Wait, Alice has ballet on Tuesdays now, but her old swimming page says Tuesday"), stale facts, and unfinished business, bubbling them up into your Morning Briefing.

### 4. The Anonymous Family Digital Twin
A complete anonymous model of your family — relationships, schedules, routines. This is mechanically enforced at runtime via our **Twin Invariant Guard**. The AI never gets credentials, and it never gets direct access to PII.

### 5. Open Agent Skills
Procedural tasks (extraction, synthesis, reflection, vision) are defined using the open Agent Skills (`SKILL.md`) standard. Memu's Model Router dynamically dispatches these skills to the optimal model based on cost and capability tiers, allowing seamless portability if you want to shift to a tier featuring local Ollama execution.

## Quick Start (Developer Setup)

```bash
git clone https://github.com/kanchanepally/memu-core.git
cd memu-core
cp .env.example .env
# Follow instructions in .env to add your API keys
docker compose up
```

Time to magic: **3 minutes.**

*For end-user deployments accompanying hardware, refer to the Memu Home (memu-os) repository.*

## Architecture & Integration

Memu Core runs as the Intelligence Engine, interfacing with multi-channel inputs and deploying the Fastify API + Workers. 

It forms Tier 1 (Cloud SaaS standalone) but docks seamlessly as the intelligence layer for **Tier 2/3 (Self-Hosted)** when deployed alongside the hardware orchestration layer found in the `memu-os` repository.

For technical contracts covering the integration between Memu and Memu Home (memu-os), see `docs/INTEGRATION_CONTRACTS.md`.

## Privacy Model

Memu comes with a live **Privacy Ledger** visible via the mobile app. You can audit exactly what the cloud AI received and verify the anonymity of your family's data on every single request.

## Community & License

- [Substack: We, Not Them](https://wenotthem.substack.com)
- [GitHub Issues](https://github.com/kanchanepally/memu-core/issues)

**AGPLv3** — Run it for your family freely. Modify and host for others? Share your code.
