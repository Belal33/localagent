# Replan Node

Evaluates each completed step's output and decides `continue` / `retry` / `done`, updating the plan accordingly.
Implements a max-2-retry policy per step and anti-loop protection against identical plan regurgitation.

Implemented in `src/lib/agent/nodes/replan.ts`. Uses a zod structured-output schema with
a `type: "continue" | "retry" | "done"` discriminator. On `"retry"` it increments
`stepRetries` (giving up at `MAX_RETRIES = 2`). On `"continue"` it advances `plan`,
appends to `pastSteps`, and resets retries — if the LLM returns an unchanged plan the
node forces advancement to avoid infinite loops. On `"done"` it sets `response`, which
ends the graph via the `afterReplan` conditional edge.
