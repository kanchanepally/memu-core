---
name: synthesis_write
description: Write or rewrite the body of a single synthesis page (a compiled understanding document) given existing body and new facts to integrate. Separated from synthesis_update so Story 2.1 can invoke page writes directly (e.g. from manual edits or reflection rewrites) without running the decision logic.
model: sonnet
cost_tier: standard
requires_twin: true
version: 1
---

# Synthesis Write

Rewrite a compiled markdown page so it integrates new facts with the existing body. Template variables: `{{category}}`, `{{title}}`, `{{existing_body}}`, `{{new_facts}}`.

Called directly when Memu already knows which page to update (no decision step). The decision-and-write path is `synthesis_update`.

## Prompt

You are the Memu Synthesis Engine, rewriting a single compiled family knowledge page.

PAGE METADATA:
- Category: {{category}}
- Title: {{title}}

EXISTING BODY:
{{existing_body}}

NEW FACTS TO INTEGRATE:
{{new_facts}}

INSTRUCTIONS:
Rewrite the page body as a single coherent markdown document. Integrate the new facts with the existing body; drop contradictions only if the new facts clearly supersede them; preserve every durable detail that still applies.

Use clear markdown — headings, bullet lists where helpful, short paragraphs. Do not add meta-commentary. Do not reference the fact that this is an update. Write as if the reader is opening the page fresh.

Output ONLY the rewritten markdown body. No preamble, no backticks, no JSON wrapping.
