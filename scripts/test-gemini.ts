/**
 * Gemini smoke test.
 *
 * Proves the adapter can reach Google AI Studio with the configured key
 * before starting the full memu-core stack. Run it after adding
 * GEMINI_API_KEY to .env (or exporting it in the shell):
 *
 *   npx tsx scripts/test-gemini.ts
 *
 * Expected: a short text response from Gemini plus a log line showing
 * model / latency / token counts. Any failure includes enough context
 * to diagnose (missing key, bad model name, rate limit, network).
 */

import 'dotenv/config';
import { getGeminiResponse } from '../src/intelligence/gemini';

async function main() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.error('❌  GEMINI_API_KEY is not set. Add it to .env or export it in the shell.');
    process.exit(1);
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  console.log(`→ Smoke test against model=${model}`);

  const response = await getGeminiResponse(
    'Say hello from Memu in one short sentence.',
    [],
    []
  );

  console.log('\n--- Gemini response ---');
  console.log(response);
  console.log('-----------------------\n');

  if (response.startsWith('Error') || response.startsWith('[Dummy Mode')) {
    console.error('❌  Adapter returned a non-live response. Check logs above.');
    process.exit(1);
  }

  console.log('✅  Gemini adapter reachable. Safe to deploy.');
}

main().catch(err => {
  console.error('❌  Smoke test crashed:', err);
  process.exit(1);
});
