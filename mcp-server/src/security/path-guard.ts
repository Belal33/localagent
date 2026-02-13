import path from "path";

const WORKSPACE_ROOT = "/home/agent_worker/workspace";

/**
 * Validates that a requested path resolves within the sandbox workspace.
 * Prevents directory traversal attacks (e.g., "../../etc/passwd").
 */
export function validatePath(requestedPath: string): string {
    const resolved = path.resolve(WORKSPACE_ROOT, requestedPath);
    if (!resolved.startsWith(WORKSPACE_ROOT)) {
        throw new Error(
            `Path traversal blocked: "${requestedPath}" resolves to "${resolved}" which is outside the workspace.`
        );
    }
    return resolved;
}

export { WORKSPACE_ROOT };
