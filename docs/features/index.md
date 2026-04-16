# LocalAgent — Feature Index

A Next.js 16 + LangGraph AI agent with hybrid memory (pgvector + Neo4j + Cognee),
pluggable skills, HITL-capable tool gating, and a streaming NDJSON chat UI.

This directory documents every implemented feature, grouped by concern. Each subdirectory
contains one markdown file per feature plus an `index.md` overview. Open the category that
matches what you're looking for.

## Categories

- [`agents/`](./agents/index.md) — LangGraph orchestration, nodes, state, safety classifier
- [`skills/`](./skills/index.md) — Pluggable tool bundles (terminal, web search, filesystem, camofox browser, scraping)
- [`memory/`](./memory/index.md) — Hybrid memory: pgvector episodes, Neo4j KG, Cognee facts, embeddings, distiller
- [`api/`](./api/index.md) — Next.js route handlers: `/api/chat`, `/api/chat/resume`, `/api/health`
- [`chat-ui/`](./chat-ui/index.md) — React client: chat page, markdown renderer, approval card, plan/activity/memory panels, settings
- [`infrastructure/`](./infrastructure/index.md) — Docker Compose, Dockerfile, Postgres bootstrap, Next.js config
- [`integrations/`](./integrations/index.md) — External clients: OpenCode Zen, Tavily, Cognee, Scrapling MCP, Camoufox, Ollama
- [`testing/`](./testing/index.md) — Playwright config, smoke tests, mocked UI tests, real integration tests
- [`streaming/`](./streaming/index.md) — Custom NDJSON event protocol between API and client

## Quick Stack Reference

- **LLM**: OpenCode Zen (OpenAI-compatible) — chat `minimax-m2.7`, planner `minimax-m2.5`
- **Graph**: LangGraph 1.1 with `PostgresSaver` checkpointer
- **Memory**: Postgres 16 + pgvector (episodes/checkpoints), Neo4j 5 (KG), Cognee (facts)
- **Embeddings**: Local Ollama `mxbai-embed-large` (1024-dim)
- **Browser**: Camoufox (anti-detect Firefox) via `camoufox-js`
- **Scraping**: Scrapling MCP sidecar (HTTP transport)
- **UI**: Next.js 16.1, React 19.2, Tailwind 4, custom NDJSON streaming (no Vercel AI SDK protocol)
- **Tests**: Playwright against `localhost:3333`
