import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── Workspace Configuration ────────────────────────────────────────────────
const WORKSPACE_ROOT = "/home/agent_worker/workspace";
const SUDO_PREFIX = "sudo -u agent_worker";

/**
 * Runs a command as agent_worker and returns stdout.
 */
async function runAs(command: string): Promise<string> {
    const { stdout } = await execAsync(`${SUDO_PREFIX} bash -c ${JSON.stringify(command)}`, {
        timeout: 10_000,
    });
    return stdout;
}

// ─── File System Tools ──────────────────────────────────────────────────────

const readFile = new DynamicStructuredTool({
    name: "read_file",
    description: `Read the contents of a file. Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().describe("Relative path to the file within the workspace"),
    }),
    func: async ({ path: filePath }) => {
        try {
            return await runAs(`cat '${WORKSPACE_ROOT}/${filePath}'`);
        } catch (error: any) {
            return `Error reading file: ${error.message}`;
        }
    },
});

const writeFile = new DynamicStructuredTool({
    name: "write_file",
    description: `Write content to a file (creates parent directories if needed). Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().describe("Relative path to the file"),
        content: z.string().describe("Content to write to the file"),
    }),
    func: async ({ path: filePath, content }) => {
        try {
            const fullPath = `${WORKSPACE_ROOT}/${filePath}`;
            // Create parent dirs and write file — all as agent_worker
            await runAs(`mkdir -p "$(dirname '${fullPath}')" && cat > '${fullPath}' << 'AGENT_EOF'\n${content}\nAGENT_EOF`);
            return `File written: ${fullPath}`;
        } catch (error: any) {
            return `Error writing file: ${error.message}`;
        }
    },
});

const listDirectory = new DynamicStructuredTool({
    name: "list_directory",
    description: `List files and directories. Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().default(".").describe("Relative directory path (default: workspace root)"),
    }),
    func: async ({ path: dirPath }) => {
        try {
            const output = await runAs(`ls -la '${WORKSPACE_ROOT}/${dirPath}'`);
            return output || "(empty directory)";
        } catch (error: any) {
            return `Error listing directory: ${error.message}`;
        }
    },
});

const deleteFile = new DynamicStructuredTool({
    name: "delete_file",
    description: `Delete a file within the workspace. Paths are relative to ${WORKSPACE_ROOT}.`,
    schema: z.object({
        path: z.string().describe("Relative path to the file to delete"),
    }),
    func: async ({ path: filePath }) => {
        try {
            await runAs(`rm '${WORKSPACE_ROOT}/${filePath}'`);
            return `Deleted: ${WORKSPACE_ROOT}/${filePath}`;
        } catch (error: any) {
            return `Error deleting file: ${error.message}`;
        }
    },
});

export const filesystemTools = [readFile, writeFile, listDirectory, deleteFile];
