# Filesystem Skill

Lazy-loaded skill bundling five file tools: `read_file`, `write_file`, `list_directory`, `delete_file`, `download_file`.
All paths are sanitized and constrained to `WORKSPACE_ROOT`.

Implemented in `src/lib/agent/skills/filesystem/`. The shared module (`shared.ts`) provides
`WORKSPACE_ROOT`, `sanitizePath` (strips any leading workspace prefix to prevent escape),
and `runAs` / `runAsWithTimeout` helpers for process execution. Individual tools:
`read-file.ts` (cat), `write-file.ts` (base64-decoded payload to avoid shell-quote
breakage), `list-directory.ts` (`ls -la`), `delete-file.ts` (`rm`), and `download.ts`
(curl with a 60-second timeout and a final `stat`). The skill is registered with
`alwaysActive: false`, so its tools only appear after the agent invokes `use_filesystem`.
