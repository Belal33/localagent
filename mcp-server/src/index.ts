#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerFileSystemTools } from "./tools/filesystem.js";
import { registerTerminalTool } from "./tools/terminal.js";
import { registerWebSearchTool } from "./tools/web-search.js";
import { registerDownloadTool } from "./tools/download.js";

// ─── Create the MCP Server ─────────────────────────────────────────────────
const server = new McpServer({
    name: "local-agent-tools",
    version: "1.0.0",
});

// ─── Register All Tool Groups ───────────────────────────────────────────────
registerFileSystemTools(server);
registerTerminalTool(server);
registerWebSearchTool(server);
registerDownloadTool(server);

// ─── Connect via Stdio Transport ────────────────────────────────────────────
// This server communicates with the Next.js MCP Client over stdin/stdout.
const transport = new StdioServerTransport();
await server.connect(transport);

// Log to stderr (stdout is reserved for MCP protocol messages)
console.error("[MCP Server] Running as:", process.env.USER || "unknown");
console.error("[MCP Server] Workspace: /home/agent_worker/workspace");
console.error("[MCP Server] Tools registered: read_file, write_file, list_directory, delete_file, execute_command, web_search, download_file");
