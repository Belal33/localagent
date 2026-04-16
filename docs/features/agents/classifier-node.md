# Classifier Node

Lightweight node deciding whether a request is "simple" (direct ReAct) or "complex" (needs planning).
Short-circuits on <20-word messages and an E2E test phrase; otherwise asks the planner LLM.

Implemented in `src/lib/agent/nodes/classifier.ts`. Uses `getPlannerLLMFromConfig` (from
`shared.ts`, `minimax-m2.5` by default at temp 0.2) to classify non-trivial requests.
Returns `{ classification: "simple" | "complex" }`, which `afterClassifier` in `graph.ts`
routes to either the direct `agent` node or the `planner` node. Contains a hardcoded
shortcut for messages containing the phrase "complex task" used as an E2E test hook.
