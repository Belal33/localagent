import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SANDBOX_CONTAINER = process.env.AGENT_RUNTIME_CONTAINER ?? "agent_app";
export const SANDBOX_WORKSPACE_ROOT = process.env.AGENT_RUNTIME_WORKSPACE ?? "/workspace";

export async function runInSandbox(
    command: string,
    timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    return execFileAsync(
        "docker",
        [
            "exec",
            "-w",
            SANDBOX_WORKSPACE_ROOT,
            SANDBOX_CONTAINER,
            "timeout",
            `${seconds}s`,
            "bash",
            "-lc",
            command,
        ],
        {
            timeout: timeoutMs + 2_000,
            maxBuffer: 1024 * 1024,
        },
    );
}

export async function inspectSandbox(): Promise<string> {
    try {
        const { stdout } = await execFileAsync(
            "docker",
            [
                "inspect",
                "--format",
                "{{.Name}} {{.State.Status}} {{.Config.Image}}",
                SANDBOX_CONTAINER,
            ],
            { timeout: 5_000 },
        );
        return stdout.trim();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Sandbox container ${SANDBOX_CONTAINER} is not available: ${message}`;
    }
}

export async function recreateSandbox(rebuild: boolean): Promise<string> {
    const args = ["compose", "up", "-d", "--force-recreate"];
    if (rebuild) args.push("--build");
    args.push("agent_app");

    const { stdout, stderr } = await execFileAsync("docker", args, {
        cwd: process.env.AGENT_PROJECT_ROOT ?? process.cwd(),
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
    });

    return [stdout, stderr].filter(Boolean).join("\n").trim() || `Sandbox ${SANDBOX_CONTAINER} recreated.`;
}
