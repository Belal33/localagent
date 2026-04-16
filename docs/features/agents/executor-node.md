# Executor Node

Dequeues the next step from the plan and injects it as a `HumanMessage` framed with execution context.
Does not call an LLM itself — it primes the `agent` node that runs next.

Implemented in `src/lib/agent/nodes/executor.ts`. Minimal node: reads `plan[0]`, appends
a focused `HumanMessage` of the form "Execute this step: …", and updates `currentStep`.
The actual tool-calling LLM invocation happens immediately after in the `agent` node,
which sees the injected message and decides which tool(s) to call.
