# Core Skill — Web Search

`web_search` tool powered by the Tavily Search API, optimized for LLM consumption.
Always active; returns titled URL blocks plus an AI-generated answer summary.

Implemented in `src/lib/agent/skills/core/web-search.ts`. Uses `@tavily/core` with the
`TAVILY_API_KEY` env var. Requests `includeAnswer: true` and up to `maxResults` results
(default 5), formatting them as markdown-friendly blocks that include title, URL, and
content snippet. Returned to the LLM as a single string. Part of the always-active
`core` skill alongside `execute_command`.
