# Executor Node

Selects the next step from the plan and marks the trajectory start index.
It does NOT inject any message — step focus is enforced by `callModel`'s dynamic system prompt.

Implemented in `src/lib/agent/nodes/executor.ts`. Reads `plan[0]`, sets it as
`currentStep`, and writes `stepStartIndex = state.messages.length` so the replan node
can later slice exactly the messages produced while this step ran (agent text + tool
calls + tool results). The agent node (`graph.ts:callModel`) sees `currentStep` + the
remaining plan in state and builds a `[CURRENT PLAN EXECUTION]` system prompt block
instructing the LLM to focus ONLY on that step. This avoids the earlier failure mode
where injecting step instructions as a `HumanMessage` made the model respond
conversationally instead of invoking tools.
