# Core Skill — Terminal

`execute_command` tool that runs bash commands inside the container's workspace with a 30-second timeout.
Always active; the agent's primary OS-interaction primitive.

Implemented in `src/lib/agent/skills/core/terminal.ts`. Uses a promisified `child_process.exec`,
wrapping the user command with `timeout 30s bash -c <cmd>`. Runs with `cwd = WORKSPACE_ROOT`
(default `/workspace`) and `maxBuffer: 1MB`. Returns combined output as `STDOUT:` / `STDERR:`
sections so the LLM can inspect failures. Part of the `core` skill which is flagged
`alwaysActive: true`, so it is bound to every LLM call without requiring activation.
