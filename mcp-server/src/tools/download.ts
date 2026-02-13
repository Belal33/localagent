import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { validatePath } from "../security/path-guard.js";

export function registerDownloadTool(server: McpServer) {
    server.tool(
        "download_file",
        "Download a file from a URL and save it to the workspace",
        {
            url: z.string().url().describe("The URL to download from"),
            savePath: z
                .string()
                .describe("Relative path within workspace to save the file"),
        },
        async ({ url, savePath }) => {
            const safePath = validatePath(savePath);

            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const buffer = Buffer.from(await response.arrayBuffer());
                await fs.mkdir(path.dirname(safePath), { recursive: true });
                await fs.writeFile(safePath, buffer);

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Downloaded ${url} → ${safePath} (${buffer.length} bytes)`,
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Download failed: ${error.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}
