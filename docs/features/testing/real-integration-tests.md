# Real Integration Tests

Two integration tests that hit the real `/api/chat` with the LLM backend (requires running proxy + Ollama).
60-second timeout per test; excluded from CI via `--grep-invert "Real Chat"`.

Implemented in `tests/e2e/chat.spec.ts` as the `Real Chat Integration` suite. Sends
`"Say Hi there!"` and verifies a streaming response arrives and renders. Intended for
local verification that the full stack (Next.js + LangGraph + OpenCode Zen + Postgres
+ Cognee + Ollama) is wired correctly. Skipped in CI so the pipeline doesn't depend
on external paid APIs.
