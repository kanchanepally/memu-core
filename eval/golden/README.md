# Golden Query Set

Each `.md` file is one golden query: a real question, the Spaces a
correct retrieval should surface, and which retrieval tier *should*
answer it. Edit freely — every change is diffable.

## File format

```
---
expected_space_uris:
  - memu://<collective_id>/<category>/<uri>
  - memu://...
expected_retrieval_state: sourced | fallback | empty | direct | catalogue | embedding | none
notes: optional commentary
---
The query text goes here. Multiple lines fine.
```

`expected_retrieval_state` can be a tier path (`direct` / `catalogue` /
`embedding` / `none`) for fine-grained assertions, or a user-facing
state (`sourced` / `fallback` / `empty`) when you only care which
bucket the answer should land in.

## Adding a query

1. Copy any existing `.md` as a template.
2. Name the file `<short-kebab-slug>.md` — the filename becomes the
   query id in reports.
3. Paste the query text into the body.
4. Run `npm run eval:replay -- --collective <your-collective-id>` to
   see what retrieval actually returns; fill in `expected_space_uris`
   from the actual list (the seed values are placeholders).
5. Commit.

The aggregate recall % is computed across this whole directory.
