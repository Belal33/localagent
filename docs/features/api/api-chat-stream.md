# API — Chat Stream

`POST /api/chat` — main streaming endpoint that converts incoming messages to LangChain format, invokes the graph via `streamEvents`, and emits NDJSON events.
Also triggers the fire-and-forget memory distiller after the turn completes.

Implemented in `src/app/api/chat/route.ts` with `maxDuration: 120`. Translates the AI
SDK-style message shape (`parts[]` or `content`) into `HumanMessage` / `AIMessage`, then
pipes the graph's `streamEvents(v2)` into a `ReadableStream` emitting NDJSON event types:
`token`, `tool_call`, `tool_result`, `node_start`, `plan`, `step_status`, `memory`,
`interrupt`, `error`, `done`. Handles non-streaming models via an `on_chat_model_end`
fallback. Catches `GraphInterrupt` to surface pending interrupts. Applies per-request
`chatModel` and `plannerModel` overrides through `configurable`. `recursionLimit: 300`.
