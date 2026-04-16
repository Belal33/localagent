# Ollama Embeddings

Generates 1024-dimensional vector embeddings via local Ollama running `mxbai-embed-large:latest`.
Singleton wrapper around `OllamaEmbeddings` with a configurable base URL.

Implemented in `src/lib/memory/embeddings.ts`. Uses `@langchain/ollama`'s
`OllamaEmbeddings` pointed at `AGENT_OLLAMA_URL` (default
`http://host.docker.internal:11434` so containers can reach the host's Ollama).
Exports `generateEmbedding(text)` and `generateEmbeddings(texts)` (batched).
These 1024-dim vectors back the pgvector episodic memory and the Neo4j entity vector index.
