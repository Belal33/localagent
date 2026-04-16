# Agents

LangGraph-based cognitive architecture implementing a Plan-and-Execute loop with
optional simple ReAct fast-path, durable checkpoints, and HITL-capable tool gating.

The graph lives in `src/lib/agent/graph.ts` and is composed from the nodes in
`src/lib/agent/nodes/`. Shared state is declared once in `state.ts`; a whitelist-based
safety classifier in `safety.ts` decides which tool calls require human approval.

## Features

- [`langgraph-state-machine.md`](./langgraph-state-machine.md) — Top-level graph wiring all nodes
- [`agent-state.md`](./agent-state.md) — Typed `AgentAnnotation` state
- [`classifier-node.md`](./classifier-node.md) — Simple-vs-complex routing
- [`planner-node.md`](./planner-node.md) — Step decomposition with structured output
- [`executor-node.md`](./executor-node.md) — Step dequeue + HumanMessage injection
- [`replan-node.md`](./replan-node.md) — Continue/retry/done evaluation + anti-loop
- [`human-review-node.md`](./human-review-node.md) — HITL interrupt + approve/reject/edit
- [`memory-retrieval-node.md`](./memory-retrieval-node.md) — Parallel fetch from Cognee + episodes
- [`safety-classifier.md`](./safety-classifier.md) — Whitelist-based tool-call risk check
- [`shared-planner-llm.md`](./shared-planner-llm.md) — Singleton light LLM factory
