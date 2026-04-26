import { accessSync, constants, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { isRunningInDocker } from "./local-runtime";

const LEGACY_CONTAINER_WORKSPACES = new Set([
    "/workspace",
    "/home/agent_worker/workspace",
]);

export function getWorkspaceRoot(): string {
    const configured = process.env.WORKSPACE_ROOT ?? process.env.AGENT_WORKSPACE;

    if (isRunningInDocker()) {
        return resolve(configured ?? "/workspace");
    }

    const primary = configured && !LEGACY_CONTAINER_WORKSPACES.has(configured)
        ? resolve(configured)
        : resolve(process.cwd(), "workspace");

    if (ensureWritableDirectory(primary)) return primary;

    const fallback = resolve(
        process.env.LOCALAGNENT_WORKSPACE_FALLBACK ??
        `${process.env.HOME ?? process.cwd()}/.local/share/localagnent/workspace`,
    );
    mkdirSync(fallback, { recursive: true });
    return fallback;
}

function ensureWritableDirectory(path: string): boolean {
    try {
        mkdirSync(path, { recursive: true });
        accessSync(path, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}
