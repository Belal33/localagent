/**
 * ─── Executor Node ──────────────────────────────────────────────────────────
 *
 * Picks the next step from the plan and records the message index where
 * execution starts. The actual step instruction is surfaced to the agent
 * via the dynamic system prompt in callModel (graph.ts) — not as a
 * HumanMessage, which confuses the LLM into thinking the user is speaking.
 */

import type { AgentState } from "../state";

export async function executorNode(
    state: AgentState
): Promise<Partial<AgentState>> {
    const currentStep = state.plan[0] || "";

    return {
        currentStep,
        // Mark where this step begins so replan can extract only its trajectory.
        stepStartIndex: state.messages.length,
    };
}
