import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKSPACE_ROOT, runAs } from "./shared";

const readFile = new DynamicStructuredTool({
    name: "read_file",
    description: `Read the contents of a file. Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().describe("Relative path to the file within the workspace"),
    }),
    func: async ({ path: filePath }) => {
        try {
            return await runAs(`cat '${WORKSPACE_ROOT}/${filePath}'`);
        } catch (error: any) {
            return `Error reading file: ${error.message}`;
        }
    },
});

export const readFileTools = [readFile];
