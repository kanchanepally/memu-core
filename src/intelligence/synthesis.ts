import { pool } from '../db/connection';
import { generateResponse } from './provider';

// Hardcoded categories as defined in memu-architecture-v2.md
export const SYNTHESIS_CATEGORIES = ['person', 'routine', 'household', 'commitment', 'document'];

export async function processSynthesisUpdate(profileId: string, anonymousMsg: string, aiResponse: string) {
    // 1. Fetch current active pages to provide as context
    const res = await pool.query('SELECT category, title, body_markdown FROM synthesis_pages WHERE profile_id = $1', [profileId]);
    const existingStr = res.rows.map(r => `Category: ${r.category}\nTitle: ${r.title}\nCurrent Body:\n${r.body_markdown}\n---`).join('\n\n') || 'No existing pages.';

    // 2. Ask LLM to determine if synthesis is required
    const prompt = `You are the Memu Synthesis Engine. Your job is to compile knowledge into living markdown documents.
Unlike a chatbot, you maintain persistent 'Pages' of facts about a family so nothing gets lost.

We have 5 categories of pages: 
- person (e.g., Robin, Rach)
- routine (e.g., School drop-off)
- household (e.g., The Garden Project, The Car)
- commitment (e.g., Summer Holiday '27)
- document (e.g., MOT test, Passport)

EXISTING PAGES:
${existingStr}

NEW CHAT INTERACTION:
User: ${anonymousMsg}
AI: ${aiResponse}

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

Do not include backticks surrounding the JSON. Output only NONE or the raw {"category"... format.`;

    const llmResult = await generateResponse(prompt, [], []);
    
    if (llmResult.trim() === 'NONE' || llmResult.trim().startsWith('NONE')) {
        return; // Nothing to synthesize
    }

    try {
        // Strip markdown blocks if the LLM wraps it
        const cleanJson = llmResult.replace(/```json/gi, '').replace(/```/g, '').trim();
        const update = JSON.parse(cleanJson);

        if (!SYNTHESIS_CATEGORIES.includes(update.category)) return;

        console.log(`[SYNTHESIS] Upserting Compiled Page: [${update.category}] ${update.title}`);

        await pool.query(
            `INSERT INTO synthesis_pages (profile_id, category, title, body_markdown) 
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (profile_id, category, title) DO UPDATE 
             SET body_markdown = EXCLUDED.body_markdown, last_updated_at = NOW()`,
            [profileId, update.category, update.title, update.markdown_body]
        );
    } catch(err) {
        console.error('[SYNTHESIS] Failed to parse JSON from AI or write to DB', err);
    }
}
