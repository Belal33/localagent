import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readdir } from "node:fs/promises";
import { WORKSPACE_ROOT, resolveWorkspacePath } from "./shared";

const listDirectory = new DynamicStructuredTool({
    name: "list_directory",
    description: `List files and directories. Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().default(".").describe("Relative directory path (default: workspace root)"),
    }),
    func: async ({ path: dirPath }) => {
        try {
            const fullPath = resolveWorkspacePath(dirPath);
            const entries = await readdir(fullPath, { withFileTypes: true });
            const output = entries
                .map((entry) => `${entry.isDirectory() ? "d" : "-"} ${entry.name}${entry.isDirectory() ? "/" : ""}`)
                .join("\n");
            return output || "(empty directory)";
        } catch (error) {
            return `Error listing directory: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
});

export const listDirectoryTools = [listDirectory];
