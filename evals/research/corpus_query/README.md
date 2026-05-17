# corpus_query eval set

BS3 Phase W1 agent (`src/intelligence/workbench.ts` → `skills/corpus_query/SKILL.md`).

## What's tested here

The corpus_query agent is hybrid: deterministic pgvector similarity narrows to candidates; an LLM step re-ranks with per-result rationale. This eval set covers the **LLM rank step in isolation** — given a fixed candidate list and a query, did the model:

- Pick the right top-N artefacts?
- Drop noise that semantic search surfaced but doesn't actually answer the query?
- Give honest confidence (high when nailed, low when stretching, zero when nothing matches)?
- Stay inside the candidate set (no fabricated indices)?

The deterministic step (embedding + visibility filter) is covered by the existing pgvector + catalogue tests — not re-evaluated here.

## Scenario shape

Each scenario is a `.json` file under `scenarios/` with this structure:

```json
{
  "id": "scenario-id",
  "description": "what this scenario tests",
  "query": "natural-language query as the user would type it",
  "candidates": [
    {
      "uri": "memu://fixture/memo/abc",
      "category": "memo",
      "title": "Title visible in the prompt",
      "description": "One-line description",
      "bodyExcerpt": "First ~240 chars of body."
    }
  ],
  "expected": {
    "topIndices": [0, 2],
    "topIndicesTolerant": [0, 1, 2],
    "minConfidence": 0.6,
    "maxConfidence": 1.0,
    "shouldBeEmpty": false
  },
  "notes": "Optional commentary"
}
```

- `topIndices` — the indices the model SHOULD have ranked first (in any order). Tested as set equality on the model's top-N.
- `topIndicesTolerant` — broader set that still counts as "found it". Used for partial-credit scoring (recall@N).
- `minConfidence` / `maxConfidence` — sanity bounds on the model's self-reported confidence. The model should not say "0.95" when it's wrong, nor "0.1" when it nailed it.
- `shouldBeEmpty` — true for scenarios where the query genuinely has no good answer; ranked list should be empty and confidence 0.

## Running

The pure-function pieces (parsing, scoring, scenario validation) run as part of the standard test suite:

```bash
npx vitest run src/eval/corpusQuery.test.ts
```

The live-LLM evaluation against real LLM dispatch is gated on an env flag — it costs money per run and is intended for periodic regression checking:

```bash
MEMU_RUN_LLM_EVALS=true npx vitest run src/eval/corpusQuery.test.ts
```

When the live flag is unset, scenarios are validated for shape only.

## Scoring thresholds

- **Recall@3:** ≥ 80% across all non-empty scenarios
- **Empty-correctness:** 100% of `shouldBeEmpty: true` scenarios return zero results
- **Confidence calibration:** model confidence is within the scenario's `min/max` band on every scenario

A scenario failure does NOT automatically gate CI — the scenarios are seed quality and need real-corpus calibration. The pure-function tests DO gate (the truth-gate behaviour must hold).

## Adding scenarios

When you find a real query that produced a bad result on Hareesh's Z2 corpus:

1. Anonymise the candidates (run them through the Twin or hand-anonymise).
2. Save the candidates + the query + your judgement of "what the right answer would have been" as a new `.json` under `scenarios/`.
3. Run `npx vitest run src/eval/corpusQuery.test.ts` to confirm it loads.

The eval set grows with use — the goal is that every real-world failure mode becomes a scenario, so future model changes can't regress what we've already fixed.
