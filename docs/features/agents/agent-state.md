# Agent State

Typed state annotation defining every field threaded through the LangGraph workflow.
Includes messages, planning state, active skills, step retries, memory context, and retrieved memories.

Defined in `src/lib/agent/state.ts`. Extends `MessagesAnnotation` with: `plan` (remaining
steps), `pastSteps` (completed tuples), `currentStep`, `response`, `activeSkills` (deduped),
`stepStatus` (`"success"` / `"failed"`), `stepRetries` (max 2), `memoryContextText`,
`retrievedMemory` (Cognee chunks), and `retrievedEpisodes` (past-conversation summaries).
Each field uses a custom reducer so partial node updates merge correctly. Exported as
`AgentAnnotation` alongside the `AgentState` TypeScript type.
