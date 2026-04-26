import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { getWorkspaceRoot } from "@/lib/workspace-root";

// ─── Workspace Configuration ────────────────────────────────────────────────
export const WORKSPACE_ROOT = getWorkspaceRoot();
const AGENT_WORKSPACE = process.env.AGENT_WORKSPACE ? resolve(process.env.AGENT_WORKSPACE) : undefined;

/**
 * Sanitise a user-supplied path so it is always relative to WORKSPACE_ROOT.
 * Handles cases where the agent passes absolute paths like "/workspace/foo"
 * or "workspace/foo" instead of just "foo".
 */
export function sanitizePath(raw: string): string {
    let p = raw.trim();
    const workspaceName = WORKSPACE_ROOT.split("/").filter(Boolean).at(-1) ?? "workspace";
    const runtimeWorkspace = process.env.AGENT_RUNTIME_WORKSPACE ?? "/workspace";

    for (const prefix of [WORKSPACE_ROOT, AGENT_WORKSPACE, runtimeWorkspace, workspaceName].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
    )) {
        const normalized = prefix.replace(/^\/+|\/+$/g, "");
        if (!normalized) continue;
        p = p.replace(new RegExp(`^/?${escapeRegExp(normalized)}/?`), "");
    }

    p = p.replace(/^\/+/, "") || ".";
    return p;
}

export function resolveWorkspacePath(raw: string): string {
    const fullPath = resolve(join(WORKSPACE_ROOT, sanitizePath(raw)));
    const rel = relative(WORKSPACE_ROOT, fullPath);
    if (rel.startsWith("..") || rel === ".." || rel.startsWith("/")) {
        throw new Error("Path escapes workspace root");
    }
    return fullPath;
}

export async function readWorkspaceFile(path: string): Promise<string> {
    return readFile(resolveWorkspacePath(path), "utf8");
}

export async function writeWorkspaceFile(path: string, content: string): Promise<string> {
    const fullPath = resolveWorkspacePath(path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
    return fullPath;
}

export async function deleteWorkspaceFile(path: string): Promise<string> {
    const fullPath = resolveWorkspacePath(path);
    await rm(fullPath, { force: false });
    return fullPath;
}

export async function ensureWorkspaceParent(path: string): Promise<string> {
    const fullPath = resolveWorkspacePath(path);
    await mkdir(dirname(fullPath), { recursive: true });
    return fullPath;
}

export async function workspaceFileSize(path: string): Promise<number> {
    return (await stat(resolveWorkspacePath(path))).size;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
