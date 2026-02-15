import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKSPACE_ROOT, runAsWithTimeout } from "./shared";

// ─── Download Tool ──────────────────────────────────────────────────────────
// Downloads run as agent_worker — files are saved to their workspace.

const downloadFile = new DynamicStructuredTool({
    name: "download_file",
    description: `Download a file from a URL and save it to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        url: z.string().url().describe("The URL to download from"),
        savePath: z.string().describe("Relative path within workspace to save the file"),
    }),
    func: async ({ url, savePath }) => {
        try {
            const fullPath = `${WORKSPACE_ROOT}/${savePath}`;
            const { stdout } = await runAsWithTimeout(
                `mkdir -p "$(dirname '${fullPath}')" && curl -fsSL -o '${fullPath}' '${url}' && stat --printf='%s' '${fullPath}'`,
                60_000
            );
            return `Downloaded ${url} → ${fullPath} (${stdout} bytes)`;
        } catch (error: any) {
            return `Download failed: ${error.message}`;
        }
    },
});

export const downloadTools = [downloadFile];
