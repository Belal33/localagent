# NDJSON Event Protocol

Custom newline-delimited JSON protocol between the API routes and the client — **not** the Vercel AI SDK stream protocol.
Nine event types cover tokens, tool calls/results, plan updates, step statuses, node transitions, memory, interrupts, errors, and done.

Event schema documented inline in `src/app/api/chat/route.ts` and implemented in both
chat routes (`/api/chat` and `/api/chat/resume`). Consumed client-side by the
`readNDJSON` async generator in `src/app/page.tsx`, typed as a TypeScript discriminated
union `StreamEvent`. Response `Content-Type: application/x-ndjson; charset=utf-8`.
Events:

- `token` — streamed LLM text
- `tool_call` / `tool_result` — tool invocation pairs (grouped by `callId`)
- `node_start` — graph node transitions (for UI breadcrumbs)
- `plan` / `step_status` — plan visibility and step outcomes
- `memory` — retrieved facts + episodes + injected context text
- `interrupt` — HITL approval request payload
- `error` — terminal error object
- `done` — final turn completion marker
