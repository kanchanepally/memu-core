/**
 * Gemini end-to-end smoke test.
 *
 * Proves two things A2 actually cares about:
 *  1. The router plans `gemini-flash` to the Gemini provider + concrete model.
 *  2. The Gemini adapter can reach Google AI Studio with the configured key.
 *
 * Run after adding GEMINI_API_KEY to .env (or exporting it in the shell):
 *
 *   npx tsx scripts/test-gemini.ts
 *
 * No database required — this bypasses the ledger. For a dispatch-level
 * smoke that also writes to privacy_ledger, run the Vitest suite against
 * a live DB: `npm test`.
 */

import 'dotenv/config';
import { planDispatch } from '../src/skills/router';
import { callGemini, toGeminiContents } from '../src/intelligence/gemini';

async function main() {
  // --- Step 1: prove router plans gemini-flash correctly --------------------
  // We override `extraction` (authored as model: haiku) to route via Gemini.
  // This exercises the full alias → provider resolution path without needing
  // a skill to have been swapped to Gemini yet (that's A3).
  process.env.MEMU_MODEL_OVERRIDE_HAIKU = 'gemini-flash';
  const plan = planDispatch('extraction');
  console.log('→ Router plan for extraction (overridden to gemini-flash):');
  console.log(`    provider       : ${plan.provider}`);
  console.log(`    effectiveModel : ${plan.effectiveModel}`);
  console.log(`    concreteModel  : ${plan.concreteModel}`);
  console.log(`    overridden     : ${plan.overridden}`);

  if (plan.provider !== 'gemini') {
    console.error('❌  Router did not route gemini-flash alias to provider=gemini.');
    process.exit(1);
  }

  // --- Step 2: prove the adapter reaches Gemini live ------------------------
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.error('\n❌  GEMINI_API_KEY is not set. Add it to .env or export it in the shell.');
    process.exit(1);
  }

  const model = plan.concreteModel;
  console.log(`\n→ Live adapter call against model=${model}`);

  const result = await callGemini({
    model,
    contents: toGeminiContents('Say hello from Memu in one short sentence.'),
  });

  console.log('\n--- Gemini response ---');
  console.log(`text       : ${result.text}`);
  console.log(`tokensIn   : ${result.tokensIn}`);
  console.log(`tokensOut  : ${result.tokensOut}`);
  console.log(`latencyMs  : ${result.latencyMs}`);
  console.log(`dummy      : ${result.dummy}`);
  console.log('-----------------------\n');

  if (result.dummy) {
    console.error('❌  Adapter returned dummy mode — key not picked up live.');
    process.exit(1);
  }

  console.log('✅  Router routes gemini-flash to Gemini; adapter reached the API live.');
  console.log('    A2 DoD satisfied: model:gemini-flash executes end-to-end.');
}

main().catch(err => {
  console.error('❌  Smoke test crashed:', err);
  process.exit(1);
});
