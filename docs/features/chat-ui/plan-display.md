# Plan Display

Collapsible blue-themed display of the current plan with pending / running / done icons per step.
Shows progress count and the currently-running step in the collapsed header.

Implemented in `src/app/components/PlanDisplay.tsx`. Visual states: ⏳ pending,
🔄 running, ✅ done. Auto-clears 2 seconds after all steps are done (triggered from
`page.tsx`). Animated expand/collapse. Fed by the `plan` and `step_status` NDJSON
events emitted by `/api/chat` as the planner/replan/executor nodes update state.
