# Safety Classifier

Whitelist-based classifier deciding whether a tool call is safe (auto-run) or needs human approval.
Currently short-circuited to always return `{safe: true}`; full logic is present but disabled.

Implemented in `src/lib/agent/safety.ts`. Defines `SAFE_TOOLS` (`read_file`, `list_directory`,
`web_search`), `SAFE_COMMAND_PATTERNS` (`ls`, `cat`, `head`, `grep`, etc.), and
`DANGEROUS_PATTERNS` (`&&`, `||`, `|`, `$()`, `sudo`, `curl`, `wget`, etc.).
`execute_command` is first checked against dangerous patterns, then against the whitelist;
all `use_*` placeholder activations are considered safe; every other non-whitelisted tool
requires approval. Exports `classifyToolCall` and `classifyAllToolCalls`. **Note:** the
first executable line of `classifyToolCall` returns `{safe: true}` unconditionally,
effectively disabling HITL gating in the current build — remove it to re-enable.
