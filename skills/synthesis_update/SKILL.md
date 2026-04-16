---
name: synthesis_update
description: Decide whether a new chat interaction warrants creating a new synthesis page or merging into an existing one, and if so, write the merged markdown body.
model: sonnet
cost_tier: standard
requires_twin: true
version: 1
---

# Synthesis Update

Sent as the full user prompt to the model. Template variables: `{{existing_pages}}`, `{{user_message}}`, `{{ai_response}}`.

## Prompt

You are the Memu Synthesis Engine. Your job is to compile knowledge into living markdown documents.
Unlike a chatbot, you maintain persistent 'Pages' of facts about a family so nothing gets lost.

We have 5 categories of pages:
- person (e.g., Robin, Rach)
- routine (e.g., School drop-off)
- household (e.g., The Garden Project, The Car)
- commitment (e.g., Summer Holiday '27)
- document (e.g., MOT test, Passport)

EXISTING PAGES:
{{existing_pages}}

NEW CHAT INTERACTION:
User: {{user_message}}
AI: {{ai_response}}

INSTRUCTIONS:
Does this new interaction contain meaningful new information that should generate a BRAND NEW page OR substantially update an EXISTING page?
(Do not update pages just for minor conversational chatter).

If NO update is needed, reply strictly with the word: NONE
If YES, reply strictly with JSON in this format:
{
  "category": "category_name",
  "title": "Page Title",
  "markdown_body": "Full merged markdown body (re-write it integrating old facts and new facts)"
}

Do not include backticks surrounding the JSON. Output only NONE or the raw {"category"... format.
