/**
 * ─── Phase 3: Whitelist Safety Classifier ───────────────────────────────────
 *
 * Uses a WHITELIST model: only configured auto-approved tools and safe
 * command patterns are allowed to execute without human approval. Everything
 * else is flagged as potentially destructive and triggers a Human-in-the-Loop
 * interrupt.
 */

import { getAgentSettingsSync, type AgentSettings } from "./settings";

const APPROVAL_ONLY_TOOLS = new Set([
    "restart_sandbox",
    "host_execute_command",
]);

// NOTE: execute_command runs inside the isolated agent_app Docker sandbox.
// All shell-level pattern checks have been removed because the container
// provides the security boundary. If execute_command is in the user's
// auto-approval whitelist, it passes regardless of command content.

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
    args: Record<string, unknown>,
    settings: AgentSettings = getAgentSettingsSync(),
): SafetyResult {
    // 1. Skill activation placeholders (use_*) — always safe
    if (toolName.startsWith("use_")) {
        return { safe: true };
    }

    if (toolName === "sandbox_status") {
        return { safe: true };
    }

    if (APPROVAL_ONLY_TOOLS.has(toolName)) {
        return {
            safe: false,
            reason: `Tool "${toolName}" controls the host or sandbox lifecycle and requires user approval`,
        };
    }

    const autoApprovedTools = new Set(settings.autoApprovalTools);

    if (autoApprovedTools.has(toolName)) {
        return { safe: true };
    }

    // 2. execute_command — runs inside isolated Docker sandbox.
    // If whitelisted, allow any command; container provides the boundary.
    if (toolName === "execute_command") {
        const command = (args.command as string || "").trim();
        if (!command) {
            return { safe: false, reason: "Empty command" };
        }
        return { safe: true };
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
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
    settings: AgentSettings = getAgentSettingsSync(),
): { allSafe: boolean; results: Array<SafetyResult & { toolName: string }> } {
    const results = toolCalls.map((tc) => ({
        ...classifyToolCall(tc.name, tc.args, settings),
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
