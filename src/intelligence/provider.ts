import { getClaudeResponse, ConversationMessage } from './claude';
import { getGeminiResponse } from './gemini';

export type LLMProvider = 'claude' | 'gemini';

function resolveProvider(): LLMProvider {
  const raw = (process.env.MEMU_LLM_PROVIDER || 'claude').toLowerCase();
  if (raw === 'gemini') return 'gemini';
  return 'claude';
}

let loggedProviderOnce = false;
function logProviderOnce(provider: LLMProvider) {
  if (loggedProviderOnce) return;
  console.log(`[LLM provider selected: ${provider}]`);
  loggedProviderOnce = true;
}

export async function generateResponse(
  prompt: string,
  context: string[] = [],
  history: ConversationMessage[] = []
): Promise<string> {
  const provider = resolveProvider();
  logProviderOnce(provider);

  if (provider === 'gemini') {
    return getGeminiResponse(prompt, context, history);
  }
  return getClaudeResponse(prompt, context, history);
}

export { ConversationMessage };
