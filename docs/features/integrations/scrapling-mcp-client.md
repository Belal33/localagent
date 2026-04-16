# Scrapling MCP Client

Model Context Protocol (MCP) client for the Scrapling scraping service running as a Docker sidecar.
Opens a fresh streamable-HTTP connection per call and proxies six scraping tools.

Implemented in `src/lib/agent/skills/scraping/shared.ts`. Uses `@modelcontextprotocol/sdk`'s
`Client` + `StreamableHTTPClientTransport` against `SCRAPLING_MCP_URL`
(default `http://scrapling-mcp:8931/mcp`). Parses the result's `content` array (text
blocks) and joins them into a single string. The MCP server is spawned by docker-compose
with `mcp --http --host 0.0.0.0 --port 8931`. Per-call connections keep the client
stateless and avoid stale-connection issues.
