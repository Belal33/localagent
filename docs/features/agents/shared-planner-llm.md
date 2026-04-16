# Shared Planner LLM

Singleton factory for the lightweight planner/classifier/replan LLM (`minimax-m2.5` via OpenCode Zen).
Accepts a per-request model override from the LangGraph `RunnableConfig`.

Implemented in `src/lib/agent/nodes/shared.ts`. `getPlannerLLM(model)` returns a cached
`ChatOpenAI` with `maxTokens: 4096` and `temperature: 0.2`, bound to the OpenCode Zen
OpenAI-compatible endpoint. `getPlannerLLMFromConfig(config)` reads `plannerModel` from
`configurable`, allowing the UI's settings panel to override the planner per request
without rebuilding the graph or the singleton.
