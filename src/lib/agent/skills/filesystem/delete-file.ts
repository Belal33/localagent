import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKSPACE_ROOT, deleteWorkspaceFile } from "./shared";

const deleteFile = new DynamicStructuredTool({
    name: "delete_file",
    description: `Delete a file within the workspace. Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().describe("Relative path to the file to delete"),
    }),
    func: async ({ path: filePath }) => {
        try {
            const fullPath = await deleteWorkspaceFile(filePath);
            return `Deleted: ${fullPath}`;
        } catch (error) {
            return `Error deleting file: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
});

export const deleteFileTools = [deleteFile];
