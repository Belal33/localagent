import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── Workspace Configuration ────────────────────────────────────────────────
export const WORKSPACE_ROOT = "/home/agent_worker/workspace";
export const SUDO_PREFIX = "sudo -u agent_worker";

/**
 * Runs a command as agent_worker and returns stdout.
 */
export async function runAs(command: string): Promise<string> {
    const { stdout } = await execAsync(`${SUDO_PREFIX} bash -c ${JSON.stringify(command)}`, {
        timeout: 10_000,
    });
    return stdout;
}

/**
 * Runs a command as agent_worker with a custom timeout and returns { stdout, stderr }.
 */
export async function runAsWithTimeout(
    command: string,
    timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
    return execAsync(`${SUDO_PREFIX} bash -c ${JSON.stringify(command)}`, {
        timeout: timeoutMs,
    });
}
