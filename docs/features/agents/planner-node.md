# Planner Node

Decomposes complex user requests into an ordered list of actionable steps using structured output.
Injects the full tool catalog into the planner prompt so steps align with available capabilities.

Implemented in `src/lib/agent/nodes/planner.ts`. Uses `withStructuredOutput(planSchema)`
where the zod schema is `{ steps: string[] }` and builds a dynamic system prompt that
enumerates every tool returned by `getAllPossibleTools()` (including placeholder skill-
activation tools). Writes `plan` and `currentStep` on the state. Produces zero extra LLM
roundtrips beyond the single structured-output call.
