import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { validatePath, WORKSPACE_ROOT } from "../security/path-guard.js";

export function registerFileSystemTools(server: McpServer) {
    // ─── Read File ────────────────────────────────────────────────────────────
    server.tool(
        "read_file",
        "Read the contents of a file within the workspace",
        { path: z.string().describe("Relative path to the file within the workspace") },
        async ({ path: filePath }) => {
            const safePath = validatePath(filePath);
            const content = await fs.readFile(safePath, "utf-8");
            return { content: [{ type: "text" as const, text: content }] };
        }
    );

    // ─── Write File ───────────────────────────────────────────────────────────
    server.tool(
        "write_file",
        "Write content to a file within the workspace (creates parent directories if needed)",
        {
            path: z.string().describe("Relative path to the file"),
            content: z.string().describe("Content to write to the file"),
        },
        async ({ path: filePath, content }) => {
            const safePath = validatePath(filePath);
            await fs.mkdir(path.dirname(safePath), { recursive: true });
            await fs.writeFile(safePath, content, "utf-8");
            return {
                content: [{ type: "text" as const, text: `File written: ${safePath}` }],
            };
        }
    );

    // ─── List Directory ───────────────────────────────────────────────────────
    server.tool(
        "list_directory",
        "List files and directories within the workspace",
        {
            path: z
                .string()
                .default(".")
                .describe("Relative directory path (default: workspace root)"),
        },
        async ({ path: dirPath }) => {
            const safePath = validatePath(dirPath);
            const entries = await fs.readdir(safePath, { withFileTypes: true });
            const listing = entries.map(
                (e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`
            );
            return {
                content: [
                    {
                        type: "text" as const,
                        text: listing.join("\n") || "(empty directory)",
                    },
                ],
            };
        }
    );

    // ─── Delete File ──────────────────────────────────────────────────────────
    server.tool(
        "delete_file",
        "Delete a file within the workspace",
        { path: z.string().describe("Relative path to the file to delete") },
        async ({ path: filePath }) => {
            const safePath = validatePath(filePath);
            await fs.unlink(safePath);
            return {
                content: [{ type: "text" as const, text: `Deleted: ${safePath}` }],
            };
        }
    );
}
