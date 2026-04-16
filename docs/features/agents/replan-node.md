# Replan Node

Evaluates each completed step using its full trajectory, then decides `continue` / `retry` / `done`.
The plan is IMMUTABLE: replan can only advance `plan[0]`, retry, or finish — it cannot rewrite steps.

Implemented in `src/lib/agent/nodes/replan.ts`. Extracts the current step's trajectory
by slicing `messages` from `state.stepStartIndex` onward, rendering agent messages,
tool calls, and tool results as a compact transcript for the evaluator LLM. Uses a zod
structured-output schema with `type: "continue" | "retry" | "done"` (no `steps` field —
regeneration is intentionally removed). On `"retry"` it increments `stepRetries`
(giving up at `MAX_RETRIES = 2` with an explicit failure response). On `"continue"` it
pops `plan[0]` and appends a trajectory summary to `pastSteps`; if no steps remain it
synthesizes `"done"`. On `"done"` it verifies no steps remain — if the LLM claims done
while remaining steps exist, the result is coerced back to `"continue"` to prevent
premature termination. Uses the planner LLM (`minimax-m2.5` by default) via
`getPlannerLLMFromConfig`.
