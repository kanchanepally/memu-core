import { pool } from '../db/connection';
import { dispatch } from '../skills/router';

// Hardcoded categories as defined in memu-architecture-v2.md
export const SYNTHESIS_CATEGORIES = ['person', 'routine', 'household', 'commitment', 'document'];

export async function processSynthesisUpdate(profileId: string, anonymousMsg: string, aiResponse: string) {
    // 1. Fetch current active pages to provide as context
    const res = await pool.query('SELECT category, title, body_markdown FROM synthesis_pages WHERE profile_id = $1', [profileId]);
    const existingStr = res.rows.map(r => `Category: ${r.category}\nTitle: ${r.title}\nCurrent Body:\n${r.body_markdown}\n---`).join('\n\n') || 'No existing pages.';

    const { text: llmResult } = await dispatch({
      skill: 'synthesis_update',
      templateVars: {
        existing_pages: existingStr,
        user_message: anonymousMsg,
        ai_response: aiResponse,
      },
      profileId,
    });
    
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
