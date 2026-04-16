# Memory

Hybrid memory system combining per-thread episodic summaries (Postgres + pgvector),
a Neo4j knowledge graph, and Cognee for facts — all embedded with local Ollama.

Read path runs in the memory-retrieval node (`agents/`) in parallel. Write path is a
fire-and-forget distiller that runs after each chat turn, extracting facts to Cognee and
an episode summary to pgvector.

## Features

- [`memory-db-singletons.md`](./memory-db-singletons.md) — Postgres checkpointer + Neo4j driver factories
- [`ollama-embeddings.md`](./ollama-embeddings.md) — 1024-dim embeddings via local Ollama
- [`episodic-memory-pgvector.md`](./episodic-memory-pgvector.md) — Per-thread summaries in pgvector
- [`episodic-memory-alt.md`](./episodic-memory-alt.md) — Legacy secondary episodic module
- [`memory-distiller.md`](./memory-distiller.md) — Post-turn fact + episode extraction
- [`neo4j-knowledge-graph.md`](./neo4j-knowledge-graph.md) — Entity triples + vector index (library)
