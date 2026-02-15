/**
 * ─── Phase 3: Human-in-the-Loop Review Node ─────────────────────────────────
 *
 * Intercepts tool calls from the agent, runs them through the whitelist
 * safety classifier, and uses LangGraph's interrupt() to pause execution
 * for any command not on the safe whitelist.
 *
 * Approval actions:
 *   - "approve"  → proceed to tool execution
 *   - "reject"   → return rejection feedback to agent
 *   - "edit"     → modify tool args, then proceed to execution
 */

import { interrupt, Command } from "@langchain/langgraph";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { classifyAllToolCalls } from "../safety";
import type { AgentState } from "../state";

export interface ApprovalDecision {
    action: "approve" | "reject" | "edit";
    reason?: string;
    newArgs?: Record<string, unknown>;
}

export function humanReviewNode(state: AgentState): Command {
    const lastMsg = state.messages[state.messages.length - 1] as AIMessage;
    const toolCalls = lastMsg.tool_calls ?? [];

    if (toolCalls.length === 0) {
        // No tool calls — shouldn't reach here, but route to end
        return new Command({ goto: "__end__" });
    }

    // Classify all tool calls against the whitelist
    const { allSafe, results } = classifyAllToolCalls(
        toolCalls.map((tc) => ({ name: tc.name, args: tc.args as Record<string, unknown> }))
    );

    // All tool calls are whitelisted safe → proceed without interruption
    if (allSafe) {
        return new Command({ goto: "tools" });
    }

    // At least one tool call is NOT in the whitelist → pause for human review
    const flaggedCalls = results
        .filter((r) => !r.safe)
        .map((r, i) => ({
            index: i,
            toolName: r.toolName,
            reason: r.reason,
            args: toolCalls.find((tc) => tc.name === r.toolName)?.args,
        }));

    // ─── Interrupt: Pause graph execution ────────────────────
    // This value is serialized and sent to the client via the NDJSON stream.
    // The client shows an approval dialog and resumes with a Command.
    // The argument to interrupt() is sent to the client as the interrupt payload.
    // The generic type is what comes back when the graph is resumed via Command({ resume: ... }).
    const interruptPayload = {
        type: "approval_request",
        flaggedCalls,
        message: `${flaggedCalls.length} tool call(s) require approval`,
    };
    const decision: ApprovalDecision = interrupt(interruptPayload);

    // ─── Handle the human's decision ────────────────────────
    if (decision.action === "approve") {
        return new Command({ goto: "tools" });
    }

    if (decision.action === "edit" && decision.newArgs) {
        // User modified the tool args — update the AI message with new args
        const updatedToolCalls = toolCalls.map((tc) => {
            if (flaggedCalls.some((f) => f.toolName === tc.name)) {
                return { ...tc, args: { ...tc.args, ...decision.newArgs } };
            }
            return tc;
        });

        const updatedMsg = new AIMessage({
            content: lastMsg.content,
            tool_calls: updatedToolCalls,
            id: lastMsg.id,
        });

        return new Command({
            goto: "tools",
            update: { messages: [updatedMsg] },
        });
    }

    // Rejected — send a ToolMessage with rejection feedback back to the agent
    const rejectionMessages = flaggedCalls.map((fc) => {
        const originalTc = toolCalls.find((tc) => tc.name === fc.toolName);
        return new ToolMessage({
            tool_call_id: originalTc?.id ?? "unknown",
            content: `[REJECTED BY USER] ${decision.reason || "User rejected this operation."}`,
        });
    });

    return new Command({
        goto: "agent",
        update: { messages: rejectionMessages },
    });
}
