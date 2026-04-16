# Tavily Search Integration

Tavily Search API client for LLM-optimized web search.
Single `tavily({ apiKey })` instance used by the `web_search` core tool.

Consumed in `src/lib/agent/skills/core/web-search.ts`. Reads the `TAVILY_API_KEY` env
var. Uses `@tavily/core` and requests `includeAnswer: true` so every search returns
both an AI-generated summary and up to `maxResults` titled URL blocks, rendered as a
single markdown-friendly string for the LLM.
