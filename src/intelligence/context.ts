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

// Slice 2a: Manual Seeding Endpoint Logic
// This writes observed facts directly into the knowledge graph
export async function seedContext(content: string, source: string = 'manual') {
  const familyId = 'test-family-1'; // Hardcoded until user auth/registration (Slice 8)
  const embedding = await embedText(content);
  // Format vector for postgres string parser: '[0.1, 0.2, ...]'
  const embeddingStr = `[${embedding.join(',')}]`;
  
  await pool.query(
    `INSERT INTO context_entries (source, content, embedding, metadata)
     VALUES ($1, $2, $3, $4)`,
    [source, content, embeddingStr, JSON.stringify({ family_id: familyId })]
  );
  
  return { success: true, content };
}

// Slice 2a: Context Retrieval Logic
// This searches the knowledge graph for facts semantically related to the user's incoming message
export async function retrieveRelevantContext(queryText: string, limit: number = 3): Promise<string[]> {
  const familyId = 'test-family-1';
  const queryEmbedding = await embedText(queryText);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  
  // Use pgvector cosine distance `<=>` operator
  // Scoped strictly by family_id to maintain multi-tenant SaaS safety
  const result = await pool.query(
    `SELECT content, 1 - (embedding <=> $1) as similarity
     FROM context_entries
     WHERE embedding IS NOT NULL
     AND metadata->>'family_id' = $2
     ORDER BY embedding <=> $1
     LIMIT $3`,
    [embeddingStr, familyId, limit]
  );
  
  // Filter out any results that are wildly irrelevant (similarity < 0.3)
  return result.rows
    .filter((r: any) => r.similarity > 0.3)
    .map((r: any) => r.content);
}
