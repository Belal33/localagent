# Ollama Host Integration

Local Ollama integration for embeddings (and potentially chat models via `@langchain/ollama`).
Reached from inside Docker via `host.docker.internal:11434`; model `mxbai-embed-large:latest` provides 1024-dim vectors.

Used in `src/lib/memory/embeddings.ts` (LangChain `OllamaEmbeddings`) and
`src/lib/memory/episodes.ts` (raw `fetch` to `/api/embed` to avoid loading LangChain in
the hot write path). Health-checked via `/api/tags` in `/api/health`. Ollama is listed
as a required host prerequisite in `README.md` since it runs outside the compose stack.
