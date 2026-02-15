/**
 * ─── Executor Node ──────────────────────────────────────────────────────────
 *
 * Picks the next step from the plan and injects it as a HumanMessage
 * for the agent to execute.
 */

import { HumanMessage } from "@langchain/core/messages";
import type { AgentState } from "../state";

export async function executorNode(
    state: AgentState
): Promise<Partial<AgentState>> {
    const currentStep = state.plan[0] || "";

    return {
        currentStep,
        messages: [
            new HumanMessage(
                `Execute this step: ${currentStep}\n\n` +
                `Context: You are working through a multi-step plan. ` +
                `Focus only on this specific step. When done, report what you accomplished.`
            ),
        ],
    };
}
