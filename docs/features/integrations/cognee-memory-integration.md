# Cognee Memory Integration

HTTP client integration for the Cognee memory engine (facts graph + semantic search).
Uses `/api/v1/add` + `/api/v1/cognify` to store, and `/api/v1/search` with `CHUNKS` / `SUMMARIES` types to retrieve.

Consumed by `src/lib/memory/distiller.ts` (write path) and `src/lib/agent/nodes/memory-retrieval.ts`
(read path). Base URL is `COGNEE_URL` (default `http://cognee:8000`). Dataset naming
convention is `memory_{userId}`. The Cognee service itself is configured via the docker
compose env to use OpenCode as LLM, Ollama as embedding provider, pgvector as vector DB,
Neo4j as graph DB, and Postgres for its internal relational state.
