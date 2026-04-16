# OpenCode Zen LLM

LLM integration using the OpenCode Zen "Go" plan as an OpenAI-compatible endpoint for MiniMax, GLM-5, Kimi, and MiMo models.
Two singleton instances: a main chat LLM (default `minimax-m2.7`) and a lighter planner LLM (default `minimax-m2.5`).

Configured in `src/lib/agent/graph.ts` and `src/lib/agent/nodes/shared.ts`. Uses
`@langchain/openai`'s `ChatOpenAI` with `baseURL: "https://opencode.ai/zen/go/v1"` and
the `OPENCODE_API_KEY` env var. Chat LLM: 64000 max tokens, temp 0.1. Planner LLM:
4096 max tokens, temp 0.2. The distiller uses its own instance at temp 0 for
deterministic fact extraction. Per-request overrides flow through LangGraph's
`configurable` from the settings panel.
