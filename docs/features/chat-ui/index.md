# Chat UI

React client (Next.js App Router) under `src/app/`. Single streaming chat page plus
a set of collapsible side components for plan, activity, memory, approval, and settings.

Aesthetic: emerald-on-neutral terminal-inspired Tailwind. All streaming is consumed
from the custom NDJSON protocol (see `streaming/`).

## Features

- [`chat-page.md`](./chat-page.md) — Main page + NDJSON parsing + state orchestration
- [`markdown-renderer.md`](./markdown-renderer.md) — Markdown + syntax highlight + Mermaid
- [`approval-card.md`](./approval-card.md) — HITL approve / reject / edit UI
- [`plan-display.md`](./plan-display.md) — Collapsible plan-steps panel
- [`activity-log.md`](./activity-log.md) — Tool calls + node transitions panel
- [`memory-context-panel.md`](./memory-context-panel.md) — Retrieved facts + episodes panel
- [`settings-panel.md`](./settings-panel.md) — Chat & planner model selector
- [`root-layout.md`](./root-layout.md) — Fonts + global styles
