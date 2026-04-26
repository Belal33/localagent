import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { inspectSandbox, recreateSandbox, runInSandbox, SANDBOX_CONTAINER, SANDBOX_WORKSPACE_ROOT } from "../../sandbox-runtime";

const execAsync = promisify(exec);

// ─── Configuration ──────────────────────────────────────────────────────────
const TIMEOUT_MS = 30_000; // 30 seconds absolute limit

// ─── Terminal Tool ──────────────────────────────────────────────────────────

const executeCommand = new DynamicStructuredTool({
    name: "execute_command",
    description:
        `Execute a bash command inside the ${SANDBOX_CONTAINER} sandbox container. ` +
        `Commands are time-limited to 30 seconds. Working directory: ${SANDBOX_WORKSPACE_ROOT}`,
    schema: z.object({
        command: z.string().describe("The bash command to execute"),
    }),
    func: async ({ command }) => {
        try {
            const { stdout, stderr } = await runInSandbox(command, TIMEOUT_MS);

            let output = "";
            if (stdout) output += `STDOUT:\n${stdout}\n`;
            if (stderr) output += `STDERR:\n${stderr}\n`;
            return output || "(no output)";
        } catch (error) {
            return `Command failed:\n${commandErrorMessage(error)}`;
        }
    },
});

const sandboxStatus = new DynamicStructuredTool({
    name: "sandbox_status",
    description: `Inspect the ${SANDBOX_CONTAINER} sandbox container used for agent terminal execution.`,
    schema: z.object({}),
    func: async () => inspectSandbox(),
});

const restartSandbox = new DynamicStructuredTool({
    name: "restart_sandbox",
    description:
        `Restart/recreate the ${SANDBOX_CONTAINER} sandbox container. ` +
        "Use this when the sandbox environment is broken or needs a fresh runtime.",
    schema: z.object({
        rebuild: z.boolean().default(false).describe("Rebuild the sandbox image before recreating it"),
    }),
    func: async ({ rebuild }) => {
        try {
            return await recreateSandbox(rebuild);
        } catch (error) {
            return `Failed to recreate sandbox: ${commandErrorMessage(error)}`;
        }
    },
});

const hostExecuteCommand = new DynamicStructuredTool({
    name: "host_execute_command",
    description:
        "Execute a bash command directly on the host machine as the user running the Next.js app. " +
        "This is privileged and must only be used when sandbox execution cannot accomplish the task. " +
        "It always requires explicit user approval before execution.",
    schema: z.object({
        command: z.string().describe("The bash command to execute on the host"),
    }),
    func: async ({ command }) => {
        try {
            const { stdout, stderr } = await execAsync(
                `timeout 30s bash -c ${JSON.stringify(command)}`,
                {
                    cwd: process.env.HOST_COMMAND_CWD ?? process.cwd(),
                    timeout: TIMEOUT_MS,
                    maxBuffer: 1024 * 1024,
                },
            );

            let output = "";
            if (stdout) output += `STDOUT:\n${stdout}\n`;
            if (stderr) output += `STDERR:\n${stderr}\n`;
            return output || "(no output)";
        } catch (error) {
            return `Host command failed:\n${commandErrorMessage(error)}`;
        }
    },
});

export const terminalTools = [executeCommand, sandboxStatus, restartSandbox, hostExecuteCommand];

function commandErrorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null) {
        const maybeError = error as { stderr?: unknown; message?: unknown };
        if (typeof maybeError.stderr === "string" && maybeError.stderr.trim()) return maybeError.stderr;
        if (typeof maybeError.message === "string") return maybeError.message;
    }
    return String(error);
}
