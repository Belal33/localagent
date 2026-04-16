# Scraping Skill (MCP)

Web scraping skill that proxies six tools to the Scrapling MCP service (HTTP-based, Cloudflare bypass).
Covers fast HTTP, Chromium-based fetch, and stealth Firefox-based fetch — each in single-URL and bulk variants.

Implemented in `src/lib/agent/skills/scraping/`. `shared.ts` uses the `@modelcontextprotocol/sdk`
(`Client` + `StreamableHTTPClientTransport`) to connect to `SCRAPLING_MCP_URL`
(default `http://scrapling-mcp:8931/mcp`), opening a fresh connection per tool call.
`tools.ts` defines `scraping_get`, `scraping_fetch`, `scraping_stealthy_fetch`,
`scraping_bulk_get`, `scraping_bulk_fetch`, and `scraping_bulk_stealthy_fetch`.
Common parameters: `url`/`urls`, optional `css_selector` (for token savings),
`output_format` (markdown/html/text), and `proxy`. Backed by the `scrapling-mcp`
docker-compose service running `mcp --http --host 0.0.0.0 --port 8931`.
