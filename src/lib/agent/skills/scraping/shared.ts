import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ─── Configuration ──────────────────────────────────────────────────────────
// In Docker: use the internal service hostname (scrapling-mcp:8931)
// Locally (dev without Docker): use localhost:8931
const SCRAPLING_MCP_URL =
    process.env.SCRAPLING_MCP_URL ?? "http://scrapling-mcp:8931/mcp";

/**
 * Calls a Scrapling MCP tool by name with the given arguments.
 * Opens a fresh connection per call (stateless — safe for concurrent use).
 */
export async function callScraplingTool(
    toolName: string,
    args: Record<string, unknown>
): Promise<string> {
    const client = new Client({ name: "localagent-scraping", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
        new URL(SCRAPLING_MCP_URL)
    );

    await client.connect(transport);

    try {
        const result = await client.callTool({ name: toolName, arguments: args });

        // MCP tool results are an array of content blocks
        const content = result.content;
        if (Array.isArray(content)) {
            return content
                .map((block: { type: string; text?: string }) =>
                    block.type === "text" ? (block.text ?? "") : ""
                )
                .join("\n");
        }
        return String(content);
    } finally {
        await client.close();
    }
}
