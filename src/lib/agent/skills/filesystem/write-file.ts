import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKSPACE_ROOT, runAs } from "./shared";

const writeFile = new DynamicStructuredTool({
    name: "write_file",
    description: `Write content to a file (creates parent directories if needed). Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().describe("Relative path to the file"),
        content: z.string().describe("Content to write to the file"),
    }),
    func: async ({ path: filePath, content }) => {
        try {
            const fullPath = `${WORKSPACE_ROOT}/${filePath}`;
            // Create parent dirs and write file — all as agent_worker
            await runAs(`mkdir -p "$(dirname '${fullPath}')" && cat > '${fullPath}' << 'AGENT_EOF'\n${content}\nAGENT_EOF`);
            return `File written: ${fullPath}`;
        } catch (error: any) {
            return `Error writing file: ${error.message}`;
        }
    },
});

export const writeFileTools = [writeFile];
