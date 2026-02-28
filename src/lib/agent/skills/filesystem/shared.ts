import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── Workspace Configuration ────────────────────────────────────────────────
export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "/workspace";

/**
 * Runs a command in the workspace and returns stdout.
 */
export async function runAs(command: string): Promise<string> {
    const { stdout } = await execAsync(command, {
        cwd: WORKSPACE_ROOT,
        timeout: 10_000,
    });
    return stdout;
}

/**
 * Runs a command in the workspace with a custom timeout and returns { stdout, stderr }.
 */
export async function runAsWithTimeout(
    command: string,
    timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
    return execAsync(command, {
        cwd: WORKSPACE_ROOT,
        timeout: timeoutMs,
    });
}
