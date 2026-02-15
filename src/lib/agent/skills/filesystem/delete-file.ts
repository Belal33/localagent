import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKSPACE_ROOT, runAs } from "./shared";

const deleteFile = new DynamicStructuredTool({
    name: "delete_file",
    description: `Delete a file within the workspace. Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().describe("Relative path to the file to delete"),
    }),
    func: async ({ path: filePath }) => {
        try {
            await runAs(`rm '${WORKSPACE_ROOT}/${filePath}'`);
            return `Deleted: ${WORKSPACE_ROOT}/${filePath}`;
        } catch (error: any) {
            return `Error deleting file: ${error.message}`;
        }
    },
});

export const deleteFileTools = [deleteFile];
