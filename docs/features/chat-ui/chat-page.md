# Chat Page

Main React page orchestrating the full chat UX with streaming NDJSON parsing and HITL flow.
Manages messages, plan steps, activity items, memory, interrupts, and settings state.

Implemented in `src/app/page.tsx` as a client component. Generates a `threadId` on mount,
implements `readNDJSON` as an async generator, and uses `processStream` to switch on
event types. POSTs to `/api/chat`, and to `/api/chat/resume` for HITL continuations.
Uses Lucide icons and a Tailwind emerald-on-neutral terminal aesthetic. Wires together
all sub-components: `MarkdownRenderer`, `ApprovalCard`, `PlanDisplay`, `ActivityLog`,
`MemoryContext`, and `SettingsPanel`.
