import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKSPACE_ROOT, runAs } from "./shared";

const listDirectory = new DynamicStructuredTool({
    name: "list_directory",
    description: `List files and directories. Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().default(".").describe("Relative directory path (default: workspace root)"),
    }),
    func: async ({ path: dirPath }) => {
        try {
            const output = await runAs(`ls -la '${WORKSPACE_ROOT}/${dirPath}'`);
            return output || "(empty directory)";
        } catch (error: any) {
            return `Error listing directory: ${error.message}`;
        }
    },
});

export const listDirectoryTools = [listDirectory];
