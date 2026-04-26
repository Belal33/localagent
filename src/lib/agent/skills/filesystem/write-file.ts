import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKSPACE_ROOT, writeWorkspaceFile } from "./shared";

const writeFile = new DynamicStructuredTool({
    name: "write_file",
    description: `Write content to a file (creates parent directories if needed). Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().describe("Relative path to the file"),
        content: z.string().describe("Content to write to the file"),
    }),
    func: async ({ path: filePath, content }) => {
        try {
            const fullPath = await writeWorkspaceFile(filePath, content);
            return `File written: ${fullPath}`;
        } catch (error) {
            return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
});

export const writeFileTools = [writeFile];
