import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── Configuration ──────────────────────────────────────────────────────────
const WORKSPACE_ROOT = "/home/agent_worker/workspace";
const TIMEOUT_MS = 30_000; // 30 seconds absolute limit

// ─── Terminal Tool ──────────────────────────────────────────────────────────

const executeCommand = new DynamicStructuredTool({
    name: "execute_command",
    description:
        `Execute a bash command as the sandboxed agent_worker user. ` +
        `Commands are time-limited to 30 seconds. Working directory: ${WORKSPACE_ROOT}`,
    schema: z.object({
        command: z.string().describe("The bash command to execute"),
    }),
    func: async ({ command }) => {
        try {
            const { stdout, stderr } = await execAsync(
                `sudo -u agent_worker /bin/bash -c ${JSON.stringify(`cd '${WORKSPACE_ROOT}' && timeout 30s ${command}`)}`,
                {
                    timeout: TIMEOUT_MS,
                    maxBuffer: 1024 * 1024, // 1MB output buffer
                }
            );

            let output = "";
            if (stdout) output += `STDOUT:\n${stdout}\n`;
            if (stderr) output += `STDERR:\n${stderr}\n`;
            return output || "(no output)";
        } catch (error: any) {
            return `Command failed:\n${error.stderr || error.message}`;
        }
    },
});

export const terminalTools = [executeCommand];
