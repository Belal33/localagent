/**
 * ─── Replan Node ────────────────────────────────────────────────────────────
 *
 * After each step completes, evaluates progress and decides whether
 * to continue with remaining steps, adjust the plan, or finalize.
 */

import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AgentState } from "../state";
import { plannerLLM } from "./shared";

const replanSchema = z.object({
    type: z
        .enum(["continue", "done"])
        .describe("Whether to continue executing steps or finalize"),
    steps: z
        .array(z.string())
        .optional()
        .describe("Updated list of remaining steps (only if type is 'continue')"),
    response: z
        .string()
        .optional()
        .describe("Final summary response to the user (only if type is 'done')"),
});

const REPLAN_SYSTEM = new SystemMessage(
    "You are a task evaluator. Given the original request, the plan, completed steps, " +
    "and their results, decide whether the task is complete or more steps are needed. " +
    "If more steps are needed, provide an updated list of remaining steps. " +
    "If the task is complete, provide a final summary response."
);

export async function replanNode(
    state: AgentState
): Promise<Partial<AgentState>> {
    const structuredLLM = plannerLLM.withStructuredOutput(replanSchema);

    // Build context for the replanner
    const userMessages = state.messages.filter(
        (m) => m._getType() === "human"
    );
    const originalRequest = userMessages[0]?.content || "";

    const pastStepsText = state.pastSteps
        .map(([step, result]) => `Step: ${step}\nResult: ${result}`)
        .join("\n\n");

    const remainingText = state.plan.slice(1).join("\n");

    const result = await structuredLLM.invoke([
        REPLAN_SYSTEM,
        new HumanMessage(
            `Original request: ${originalRequest}\n\n` +
            `Completed steps:\n${pastStepsText}\n\n` +
            `Remaining planned steps:\n${remainingText || "(none)"}\n\n` +
            `Last step completed: ${state.currentStep}\n` +
            `Last step result: ${state.messages[state.messages.length - 1]?.content || "(no output)"}`
        ),
    ]);

    if (result.type === "done") {
        return { response: result.response || "Task completed." };
    }

    // Continue with updated plan
    const newSteps = result.steps || state.plan.slice(1);
    return {
        plan: newSteps,
        pastSteps: [[state.currentStep, String(state.messages[state.messages.length - 1]?.content || "")]],
        currentStep: newSteps[0] || "",
    };
}
