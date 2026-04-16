# Settings Panel

Slide-in right panel for selecting the chat model and planner model (per-request override via the API).
Hardcodes the six OpenCode Go-plan models (MiniMax, GLM-5, Kimi, MiMo variants).

Implemented in `src/app/components/SettingsPanel.tsx`. Exports `GO_MODELS`,
`DEFAULT_SETTINGS` (`chatModel: minimax-m2.7`, `plannerModel: minimax-m2.5`), and the
`ModelSettings` type. Uses draft state so changes only apply on explicit Save, with
dirty-state tracking that disables the Save button when unchanged. The chosen models
are passed to `/api/chat` and `/api/chat/resume` via `configurable`, routed through
the graph's `callModel` and `getPlannerLLMFromConfig`.
