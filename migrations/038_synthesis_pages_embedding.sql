-- migrations/038_synthesis_pages_embedding.sql
--
-- Phase 1 of Build Spec 1 — embed every Space body so retrieval can
-- vector-shortlist the catalogue matcher's candidate set. Reuses the
-- exact model + dimensionality of context_entries.embedding (Xenova
-- all-MiniLM-L6-v2, 384-dim) per the spec rule "do not introduce a
-- second model or dimension".
--
-- Index sizing: spec says "size for tens to low hundreds of rows".
-- For ivfflat, lists = sqrt(rows) is the rule of thumb at this scale;
-- lists = 10 covers up to a few hundred rows comfortably. pgvector
-- falls back to sequential scan when the table is tiny anyway.
--
-- Idempotent.

ALTER TABLE synthesis_pages
  ADD COLUMN IF NOT EXISTS embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_synthesis_pages_embedding
  ON synthesis_pages
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);
