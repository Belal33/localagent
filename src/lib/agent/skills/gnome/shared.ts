import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// The GNOME MCP server must run on the Ubuntu host so it can reach the user's
// GNOME session bus. A host-side stdio->HTTP bridge exposes it to Docker.
const GNOME_MCP_URL =
    process.env.GNOME_MCP_URL ?? "http://host.docker.internal:8930/mcp";

const DEBUG = process.env.GNOME_MCP_DEBUG === "true";

export function getGnomeMcpUrl(): string {
    return GNOME_MCP_URL;
}

function log(...args: unknown[]) {
    if (DEBUG) {
        console.log("[gnome-mcp]", ...args);
    }
}

function coerceBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
    }
    return undefined;
}

function sanitizeArgs(toolName: string, args: Record<string, unknown>) {
    const booleanFieldsByTool: Record<string, string[]> = {
        set_volume: ["mute", "relative"],
        quick_settings: ["enabled"],
        take_screenshot: ["interactive"],
    };
    const booleanFields = booleanFieldsByTool[toolName] ?? [];
    if (booleanFields.length === 0) return args;

    const sanitized = { ...args };
    for (const field of booleanFields) {
        if (!(field in sanitized)) continue;
        const value = coerceBoolean(sanitized[field]);
        if (value === undefined) {
            delete sanitized[field];
        } else {
            sanitized[field] = value;
        }
    }
    return sanitized;
}

/**
 * Calls a GNOME MCP tool by name with the given arguments.
 * Opens a fresh connection per call (stateless, safe for concurrent use).
 */
export async function callGnomeTool(
    toolName: string,
    args: Record<string, unknown>
): Promise<string> {
    const sanitizedArgs = sanitizeArgs(toolName, args);
    log("→ callTool", toolName, JSON.stringify(sanitizedArgs));

    const client = new Client({ name: "localagent-gnome", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(GNOME_MCP_URL));

    await client.connect(transport);

    try {
        const result = await client.callTool({ name: toolName, arguments: sanitizedArgs });
        log("← result", JSON.stringify(result));
        const content = result.content;

        if (Array.isArray(content)) {
            const text = content
                .map((block: { type: string; text?: string }) =>
                    block.type === "text" ? (block.text ?? "") : ""
                )
                .filter(Boolean)
                .join("\n");
            log("← text content:", text);
            return text;
        }

        const text = String(content ?? "");
        log("← raw content:", text);
        return text;
    } catch (error) {
        log("← error", error);
        throw error;
    } finally {
        await client.close();
    }
}

/**
 * Try calling a tool; if it fails with "Tool not found", retry with an alternate name.
 */
export async function callGnomeToolWithFallback(
    primaryName: string,
    fallbackName: string,
    args: Record<string, unknown>
): Promise<string> {
    try {
        return await callGnomeTool(primaryName, args);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("Tool not found") || msg.includes("not found")) {
            log(`Tool "${primaryName}" not found, trying "${fallbackName}"`);
            return callGnomeTool(fallbackName, args);
        }
        throw error;
    }
}
