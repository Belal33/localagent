import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let mcpClient: Client | null = null;

/**
 * Initializes the MCP Client by spawning the tool server
 * as the restricted `agent_worker` Linux user via sudo.
 *
 * Uses stdio transport for secure inter-process communication.
 * The server process is a child of the Next.js process, communicating
 * over stdin/stdout.
 */
export async function getMcpClient(): Promise<Client> {
    if (mcpClient) return mcpClient;

    const transport = new StdioClientTransport({
        command: "sudo",
        args: [
            "-u",
            "agent_worker",
            "/usr/local/bin/node",
            "--experimental-strip-types",
            "/home/belal/repos/localagnent/mcp-server/src/index.ts",
        ],
    });

    mcpClient = new Client({ name: "nextjs-agent", version: "1.0.0" });
    await mcpClient.connect(transport);

    console.log("[MCP Client] Connected to sandboxed tool server");
    return mcpClient;
}

/**
 * Lists all available tools from the MCP server.
 */
export async function listMcpTools() {
    const client = await getMcpClient();
    const { tools } = await client.listTools();
    return tools;
}

/**
 * Executes a specific tool on the MCP server by name.
 */
export async function callMcpTool(
    name: string,
    args: Record<string, unknown>
): Promise<string> {
    const client = await getMcpClient();
    const result = await client.callTool({ name, arguments: args });

    // Extract text content from the MCP response
    const textParts = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text as string);

    return textParts.join("\n");
}
