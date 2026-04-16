# API — Chat Resume

`POST /api/chat/resume` — resumes an interrupted graph with a human decision via `Command({ resume })`.
Uses `graph.stream()` with multi-mode streaming (`messages` + `updates`) for reliable resume event emission.

Implemented in `src/app/api/chat/resume/route.ts`. Reads the current `plan` and
`pastSteps` from the checkpointer state to preserve step tracking across the interrupt
boundary, then streams in `["messages", "updates"]` mode. Emits the same NDJSON event
vocabulary as `/api/chat` (`token`, `tool_call`, `tool_result`, `plan`, `step_status`,
`memory`, `interrupt`, `error`, `done`). Detects and re-surfaces any new interrupt
raised after the resume, enabling multi-step HITL flows.
