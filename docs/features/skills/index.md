# Skills

Pluggable tool bundles the agent can activate on demand. Inactive skills surface to the LLM
as a single `use_<skill>` placeholder; calling it promotes the skill's real tools for subsequent iterations.

Registered and dispatched from `src/lib/agent/skills/index.ts`. Four skills ship today:
a core skill (always-active: terminal + web search), filesystem, camofox (anti-detect
Firefox automation), and scraping (Scrapling MCP proxy).

## Features

- [`skill-registry.md`](./skill-registry.md) — Plugin system + placeholder-based lazy activation
- [`core-skill-terminal.md`](./core-skill-terminal.md) — `execute_command` sandboxed bash tool
- [`core-skill-web-search.md`](./core-skill-web-search.md) — `web_search` Tavily-backed search
- [`filesystem-skill.md`](./filesystem-skill.md) — `read/write/list/delete/download` file tools
- [`camofox-browser-skill.md`](./camofox-browser-skill.md) — Anti-detect Firefox automation
- [`scraping-skill-mcp.md`](./scraping-skill-mcp.md) — Scrapling MCP web scraping proxy
