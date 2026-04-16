# LangGraph State Machine

LangGraph-based state machine orchestrating the full Plan-and-Execute cognitive workflow.
Wires all nodes (`memoryRetrieval → classifier → planner/agent → executor → humanReview → tools → replan`).

Defined in `src/lib/agent/graph.ts`. Builds a `StateGraph` over `AgentAnnotation` extended
with a `classification` field, then compiles lazily with a `PostgresSaver` checkpointer for
durable cross-restart persistence. Exposes `getAgentGraph()` (singleton) and `getLLM(model)`
which creates a `ChatOpenAI` bound to the OpenCode Zen endpoint (`opencode.ai/zen/go/v1`).
The `callModel` function dynamically binds tools based on `activeSkills`, merges memory
context into the system prompt, and includes a fallback when the LLM returns empty with
tools bound. Conditional routing helpers (`afterAgent`, `afterClassifier`, `afterReplan`)
control flow between the simple ReAct and full plan-execute paths. Uses
`@langchain/langgraph`, `@langchain/openai`, `@langchain/langgraph-checkpoint-postgres`.
