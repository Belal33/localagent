/**
 * ─── Phase 3: Whitelist Safety Classifier ───────────────────────────────────
 *
 * Uses a WHITELIST model: only commands matching known safe patterns are
 * allowed to execute without human approval. Everything else is flagged
 * as potentially destructive and triggers a Human-in-the-Loop interrupt.
 */

// ─── Whitelist: Safe Tools ──────────────────────────────────────────────────
// These tools are inherently read-only and always safe to execute.
const SAFE_TOOLS = new Set(["read_file", "list_directory", "web_search"]);

// ─── Whitelist: Safe Command Patterns ───────────────────────────────────────
// For `execute_command` tool: only commands matching these patterns execute
// without human approval. ANYTHING NOT IN THIS LIST IS TREATED AS DESTRUCTIVE.
const SAFE_COMMAND_PATTERNS: RegExp[] = [
    /^ls\b/,            // List files
    /^cat\b/,           // Read file contents
    /^head\b/,          // Read file head
    /^tail\b/,          // Read file tail
    /^echo\b/,          // Print text
    /^pwd$/,            // Print working directory
    /^whoami$/,         // Current user
    /^date$/,           // Current date
    /^wc\b/,            // Word count
    /^grep\b/,          // Search in files
    /^du\b/,            // Disk usage
    /^df\b/,            // Filesystem info
    /^stat\b/,          // File info
    /^file\b/,          // File type detection
    /^tree\b/,          // Directory tree
    /^which\b/,         // Locate command
    /^env$/,            // Environment variables
    /^uname\b/,         // System info
];

// ─── Dangerous Patterns ─────────────────────────────────────────────────────
// Any command containing these shell operators is NEVER safe, regardless of
// what the leading command is. This prevents attacks like `ls && rm -rf /`.
const DANGEROUS_PATTERNS: RegExp[] = [
    /&&/,               // Command chaining
    /\|\|/,             // OR chaining
    /;/,                // Command separator
    /\|/,               // Piping (can send data to destructive commands)
    /\$\(/,             // Command substitution $(...)
    /`/,                // Backtick command substitution
    />/,                // Output redirection (write to files)
    /</,                // Input redirection
    /-exec\b/,          // find -exec (arbitrary command execution)
    /-delete\b/,        // find -delete
    /\bxargs\b/,        // xargs (arbitrary command execution)
    /\bsudo\b/,         // Privilege escalation
    /\bsu\b/,           // User switching
    /\bcurl\b/,         // Network requests (data exfil / download)
    /\bwget\b/,         // Network requests
];

export interface SafetyResult {
    safe: boolean;
    reason?: string;
}

/**
 * Classifies a tool call as safe or potentially destructive.
 *
 * Logic:
 * 1. If the tool is in SAFE_TOOLS → always safe
 * 2. If the tool is `execute_command`:
 *    a. Check for dangerous shell operators (&&, ||, ;, |, $(), etc.)
 *    b. If dangerous patterns found → ALWAYS destructive (no whitelist bypass)
 *    c. Check against SAFE_COMMAND_PATTERNS
 *    d. If ANY pattern matches → safe
 *    e. If NO pattern matches → destructive (requires approval)
 * 3. For all other tools (write_file, delete_file, download_file, etc.) → destructive
 */
export function classifyToolCall(
    toolName: string,
    args: Record<string, unknown>
): SafetyResult {
    // 1. Known safe tools (read-only operations)
    if (SAFE_TOOLS.has(toolName)) {
        return { safe: true };
    }

    // 2. execute_command — check for dangerous patterns first, then whitelist
    if (toolName === "execute_command") {
        const command = (args.command as string || "").trim();

        if (!command) {
            return { safe: false, reason: "Empty command" };
        }

        // 2a. Check for dangerous shell operators — these ALWAYS require approval
        for (const pattern of DANGEROUS_PATTERNS) {
            if (pattern.test(command)) {
                return {
                    safe: false,
                    reason: `Command contains dangerous pattern: ${pattern.source}`,
                };
            }
        }

        // 2b. Check against safe command whitelist
        for (const pattern of SAFE_COMMAND_PATTERNS) {
            if (pattern.test(command)) {
                return { safe: true };
            }
        }

        // Command does not match any safe pattern
        return {
            safe: false,
            reason: `Command "${truncate(command, 80)}" is not in the safe command whitelist`,
        };
    }

    // 3. All other tools (write_file, delete_file, download_file, etc.)
    return {
        safe: false,
        reason: `Tool "${toolName}" requires approval (not in safe tools whitelist)`,
    };
}

/**
 * Batch-classify all tool calls from an AI message.
 * Returns true only if ALL tool calls are safe.
 */
export function classifyAllToolCalls(
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>
): { allSafe: boolean; results: Array<SafetyResult & { toolName: string }> } {
    const results = toolCalls.map((tc) => ({
        ...classifyToolCall(tc.name, tc.args),
        toolName: tc.name,
    }));

    return {
        allSafe: results.every((r) => r.safe),
        results,
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}
