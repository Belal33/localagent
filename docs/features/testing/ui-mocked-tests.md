# UI Mocked Tests

11 UI-flow tests that intercept `/api/chat` and return controlled NDJSON streams to exercise plan display, activity log, HITL, multi-turn, and loading states.
Runs fully offline with no LLM backend.

Implemented in `tests/e2e/ui-mocked.spec.ts`. Helpers: `makeNDJSON(events)`,
`mockChatAPI(page, events)`, and `sendMessage(page, text)`. Covers the full NDJSON
event vocabulary surfaced by `/api/chat` (`token`, `tool_call`, `tool_result`, `plan`,
`step_status`, `memory`, `interrupt`, `done`), so any regression in the stream
decoder in `page.tsx` is caught without needing a live LLM.
