import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── Workspace Configuration ────────────────────────────────────────────────
export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "/workspace";

/**
 * Sanitise a user-supplied path so it is always relative to WORKSPACE_ROOT.
 * Handles cases where the agent passes absolute paths like "/workspace/foo"
 * or "workspace/foo" instead of just "foo".
 */
export function sanitizePath(raw: string): string {
    let p = raw.trim();
    // Strip leading workspace prefix (with or without leading slash)
    const prefix = WORKSPACE_ROOT.replace(/^\//, ""); // "workspace"
    const re = new RegExp(`^/?${prefix}/?`);
    p = p.replace(re, "");
    // Collapse any leading slashes and default to "."
    p = p.replace(/^\/+/, "") || ".";
    return p;
}

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
