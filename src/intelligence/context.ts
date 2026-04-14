import { pipeline } from '@xenova/transformers';
import { pool } from '../db/connection';

// Singleton for the embedding pipeline to save memory overhead
let extractor: any = null;

async function getExtractor() {
  if (!extractor) {
    // all-MiniLM-L6-v2 produces a 384-dimensional vector, matching our schema.sql exactly.
    // It runs locally inside the Node.js process. No external API needed, zero-knowledge preserved.
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
  }
  return extractor;
}

export async function embedText(text: string): Promise<number[]> {
  const ex = await getExtractor();
  // We use mean pooling and normalize to get valid cosine similarity vectors
  const output = await ex(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export type Visibility = 'personal' | 'family';

// Write a fact into the context store, scoped by visibility layer.
// - visibility='personal' pins the fact to owner_profile_id (seen only by that profile)
// - visibility='family' shares the fact across every profile in the household
export async function seedContext(
  content: string,
  source: string = 'manual',
  profileId?: string,
  visibility: Visibility = 'family',
) {
  const embedding = await embedText(content);
  const embeddingStr = `[${embedding.join(',')}]`;

  await pool.query(
    `INSERT INTO context_entries (source, content, embedding, metadata, visibility, owner_profile_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      source,
      content,
      embeddingStr,
      JSON.stringify({ profile_id: profileId || 'unknown' }),
      visibility,
      visibility === 'personal' ? (profileId || null) : null,
    ],
  );

  return { success: true, content };
}

// Retrieve context for a profile, respecting the personal/family boundary.
// - 'family' layer: any family-visible entry (shared) + this profile's personal entries.
// - 'personal' layer: only this profile's personal entries (strict solo mode).
export async function retrieveRelevantContext(
  queryText: string,
  limit: number = 3,
  profileId?: string,
  layer: Visibility = 'family',
): Promise<string[]> {
  const queryEmbedding = await embedText(queryText);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  let result;
  if (profileId) {
    if (layer === 'personal') {
      result = await pool.query(
        `SELECT content, 1 - (embedding <=> $1) as similarity
           FROM context_entries
          WHERE embedding IS NOT NULL
            AND visibility = 'personal'
            AND owner_profile_id = $2
          ORDER BY embedding <=> $1
          LIMIT $3`,
        [embeddingStr, profileId, limit],
      );
    } else {
      result = await pool.query(
        `SELECT content, 1 - (embedding <=> $1) as similarity
           FROM context_entries
          WHERE embedding IS NOT NULL
            AND (
              visibility = 'family'
              OR (visibility = 'personal' AND owner_profile_id = $2)
              OR metadata->>'profile_id' = $2
              OR metadata->>'family_id' = $2
            )
          ORDER BY embedding <=> $1
          LIMIT $3`,
        [embeddingStr, profileId, limit],
      );
    }
  } else {
    result = await pool.query(
      `SELECT content, 1 - (embedding <=> $1) as similarity
         FROM context_entries
        WHERE embedding IS NOT NULL
          AND visibility = 'family'
        ORDER BY embedding <=> $1
        LIMIT $2`,
      [embeddingStr, limit],
    );
  }

  // Filter out any results that are wildly irrelevant (similarity < 0.3)
  return result.rows
    .filter((r: any) => r.similarity > 0.3)
    .map((r: any) => r.content);
}
