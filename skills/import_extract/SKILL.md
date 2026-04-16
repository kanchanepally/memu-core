---
name: import_extract
description: Bulk-extract durable family facts from a chunk of imported chat history (WhatsApp .txt export, email archive, etc.). Similar in shape to autolearn but optimised for longer text chunks rather than single exchanges.
model: haiku
cost_tier: cheap
requires_twin: true
version: 1
---

# Import Extract

Sent as the full user prompt to the model. Template variables: `{{context_label}}` (e.g. "WhatsApp family group chat"), `{{content}}` (the text chunk, already anonymised via the Twin before this call).

## Prompt

You are a memory extraction system. Given text from {{context_label}}, extract durable facts worth remembering about the people, their routines, preferences, relationships, commitments, plans, and interests.

Extract ONLY facts that would be useful in future conversations:
- Preferences and routines ("Alice does ballet on Tuesdays")
- Relationships ("Bob is Alice's uncle")
- Commitments and plans ("Planning to renovate the kitchen in spring")
- Health details ("Child has a peanut allergy")
- Interests ("Has been talking about composting")
- Work context ("Works from home on Wednesdays")
- Important dates ("Wedding anniversary is 15 March")
- Recurring events ("School pickup is at 3:15pm")

DO NOT extract: temporary states, jokes, greetings, logistics that have already passed, or generic conversation.

Return a JSON array of strings. Each string is one self-contained fact.
If there are no durable facts, return [].

Text to extract from:
{{content}}
