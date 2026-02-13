import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { WORKSPACE_ROOT } from "../security/path-guard.js";

const execAsync = promisify(exec);

const TIMEOUT_MS = 30_000; // 30 seconds absolute limit

export function registerTerminalTool(server: McpServer) {
    server.tool(
        "execute_command",
        "Execute a bash command in the sandboxed workspace. Commands are time-limited to 30 seconds. " +
        "The working directory is always /home/agent_worker/workspace.",
        {
            command: z.string().describe("The bash command to execute"),
        },
        async ({ command }) => {
            try {
                const { stdout, stderr } = await execAsync(
                    `timeout 30s bash -c ${JSON.stringify(command)}`,
                    {
                        cwd: WORKSPACE_ROOT,
                        timeout: TIMEOUT_MS,
                        maxBuffer: 1024 * 1024, // 1MB output buffer
                    }
                );

                let output = "";
                if (stdout) output += `STDOUT:\n${stdout}\n`;
                if (stderr) output += `STDERR:\n${stderr}\n`;
                return { content: [{ type: "text" as const, text: output || "(no output)" }] };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Command failed:\n${error.stderr || error.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}
