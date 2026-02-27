-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Episodic memory table: stores conversation summaries with vector embeddings.
-- The embedding dimension of 1024 matches mxbai-embed-large:latest (Ollama).
-- PostgresSaver and PostgresStore from @langchain/langgraph-checkpoint-postgres
-- auto-create their own tables via .setup(), so we only define our custom table here.
CREATE TABLE IF NOT EXISTS episodic_memories (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL DEFAULT 'default',
    thread_id  TEXT NOT NULL,
    summary    TEXT NOT NULL,
    embedding  vector(1024),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata   JSONB DEFAULT '{}'
);

-- IVFFlat index for fast cosine-similarity search over embeddings.
-- 'lists = 100' is appropriate for datasets up to ~1M rows.
CREATE INDEX IF NOT EXISTS idx_episodic_embedding
    ON episodic_memories USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_episodic_user
    ON episodic_memories (user_id);
