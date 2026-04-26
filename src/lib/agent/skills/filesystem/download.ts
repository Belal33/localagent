import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { WORKSPACE_ROOT, ensureWorkspaceParent, workspaceFileSize } from "./shared";

// ─── Download Tool ──────────────────────────────────────────────────────────
// Downloads run within the container workspace.

const downloadFile = new DynamicStructuredTool({
    name: "download_file",
    description: `Download a file from a URL and save it to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        url: z.string().url().describe("The URL to download from"),
        savePath: z.string().describe("Relative path within workspace to save the file"),
    }),
    func: async ({ url, savePath }) => {
        try {
            const fullPath = await ensureWorkspaceParent(savePath);
            const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
            if (!response.ok || !response.body) {
                return `Download failed: HTTP ${response.status}`;
            }
            await writeFile(fullPath, Buffer.from(await response.arrayBuffer()));
            const size = await workspaceFileSize(savePath);
            return `Downloaded ${url} -> ${fullPath} (${size} bytes)`;
        } catch (error) {
            return `Download failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
});

export const downloadTools = [downloadFile];
