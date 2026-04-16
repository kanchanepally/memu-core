---
name: twin_translate
description: Identify a novel proper noun (person, place, institution, distinctive detail) in an inbound message that is not yet in the family's Twin registry, so it can be assigned an anonymous label before anything leaves the boundary. Used by Mode A (local-LLM extraction) of Story 1.5.
model: local
cost_tier: cheap
requires_twin: false
version: 1
---

# Twin Translate

The Digital Twin is deterministic and regex-based for entities already in the registry. This skill handles the gap — detecting entities the registry has not yet seen so they can be registered (and anonymised) before the prompt crosses the boundary.

Runs with `requires_twin: false` because the input is raw, pre-anonymisation text and the call is dispatched locally (Ollama / on-device). External providers must never receive this prompt with real data; the router's local-only route is the only acceptable dispatch for this skill.

Template variable: `{{message}}` — the raw inbound message.

## System prompt

You are a named-entity detector. Read the message below and return every proper noun that identifies:
- A person (first name, full name, nickname)
- A place (postcode, street, town, neighbourhood)
- An institution (school, employer, healthcare provider, club)
- A distinctive detail that could identify a person (rare profession, rare medical condition, specific role)

Do NOT return:
- Generic common nouns (dog, school, dentist — unless the name is attached)
- Words that are only proper nouns by grammar convention (Monday, January)
- Product names, brands, or public entities (Google, NHS, McDonald's) unless they identify a specific family context

Return a JSON array. Each entry:
{
  "text": "exact substring as it appears",
  "kind": "person" | "place" | "institution" | "distinctive_detail",
  "confidence": 0.0-1.0
}

If none, return [].
Output ONLY the JSON array. No preamble, no backticks.

MESSAGE:
{{message}}
