import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── Configuration ──────────────────────────────────────────────────────────
const WORKSPACE_ROOT = "/home/agent_worker/workspace";

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
            // Use curl as agent_worker to download directly to workspace
            const { stdout } = await execAsync(
                `sudo -u agent_worker bash -c ${JSON.stringify(
                    `mkdir -p "$(dirname '${fullPath}')" && curl -fsSL -o '${fullPath}' '${url}' && stat --printf='%s' '${fullPath}'`
                )}`,
                { timeout: 60_000 }
            );
            return `Downloaded ${url} → ${fullPath} (${stdout} bytes)`;
        } catch (error: any) {
            return `Download failed: ${error.message}`;
        }
    },
});

export const downloadTools = [downloadFile];
