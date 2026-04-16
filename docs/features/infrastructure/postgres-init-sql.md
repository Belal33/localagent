# Postgres Init SQL

Postgres bootstrap script enabling `pgvector` and creating the `episodic_memories` table with an IVFFlat cosine index.
Includes a unique index on `thread_id` (one episode per thread) and a btree on `user_id`.

Defined in `infra/init.sql` and auto-run by the postgres container on first boot.
`CREATE EXTENSION IF NOT EXISTS vector`; creates `episodic_memories(id UUID, user_id,
thread_id, summary, embedding vector(1024), created_at, metadata JSONB)` with an
IVFFlat index using `vector_cosine_ops` (`lists = 100`). LangGraph's `PostgresSaver`
auto-creates its own checkpoint tables on first `.setup()` call, so this file only
covers the application-specific episodic schema.
