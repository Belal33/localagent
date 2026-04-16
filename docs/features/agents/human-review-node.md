# Human Review Node

Intercepts every tool call, runs the safety classifier, and uses LangGraph `interrupt()` to pause for human approval on risky ops.
Supports approve / reject (with reason) / edit-args decisions, returning a `Command` to route the graph.

Implemented in `src/lib/agent/nodes/human-review.ts`. Calls `classifyAllToolCalls`;
if every call is safe it returns `Command({ goto: "tools" })`. Otherwise it calls
`interrupt({ type: "approval_request", flaggedCalls, message })`, which serializes into
the NDJSON stream for the UI. The client resumes with `{ action, reason?, newArgs? }`:
on `"edit"` the node rebuilds the `AIMessage` with merged args, on `"reject"` it injects
rejection `ToolMessage`s and routes back to the `agent` node. Note: `classifyToolCall`
currently short-circuits to always-safe (see safety-classifier), so HITL gating is
effectively disabled in the running build even though the pipeline is intact.
