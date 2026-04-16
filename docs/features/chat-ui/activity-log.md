# Activity Log

Collapsible log of tool calls, tool results, and graph node transitions during an agent turn.
Groups `tool_call` + `tool_result` by `callId` and highlights `use_*` skill activations specially.

Implemented in `src/app/components/ActivityLog.tsx`. Node labels include emojis
(`🧭 Classifying request`, `📋 Creating plan`, etc.). Each item supports expand/collapse
showing the args JSON and the result output. Differentiates normal tools (emerald theme)
from skill-activation placeholders (violet theme + Zap icon + "skill" badge) so users
can visually follow when the agent promotes a new skill mid-turn.
