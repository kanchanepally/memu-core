import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSystemPrompt, ConversationMessage } from './claude';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy-key');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export async function getGeminiResponse(
  prompt: string,
  context: string[] = [],
  history: ConversationMessage[] = []
): Promise<string> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    return `[Dummy Mode: No Gemini Key] I am the Chief of Staff. I hear you saying: "${prompt}". My anonymity is guaranteed.`;
  }

  const start = Date.now();
  try {
    const model = genAI.getGenerativeModel({
      model: DEFAULT_MODEL,
      systemInstruction: buildSystemPrompt(context),
    });

    const contents = [
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    const result = await model.generateContent({ contents });
    const response = result.response;
    const text = response.text();

    const latency = Date.now() - start;
    const usage = response.usageMetadata;
    console.log(
      `[LLM=gemini model=${DEFAULT_MODEL} latency=${latency}ms ` +
      `in=${usage?.promptTokenCount ?? '?'} out=${usage?.candidatesTokenCount ?? '?'}]`
    );

    return text || "I'm sorry, I couldn't form a response.";
  } catch (err) {
    const latency = Date.now() - start;
    console.error(`[LLM=gemini model=${DEFAULT_MODEL} latency=${latency}ms ERROR]`, err);
    return 'Error contacting Gemini. Please check the logs.';
  }
}
