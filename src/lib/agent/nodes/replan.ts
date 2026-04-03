/**
 * ─── Replan Node ────────────────────────────────────────────────────────────
 *
 * After each step completes, evaluates progress and decides whether
 * to continue with remaining steps, retry the failed step, or finalize.
 *
 * Retry policy:
 *   - Each step gets up to 2 retries (3 total attempts).
 *   - If all retries are exhausted, the step is marked as failed and
 *     the task is finalized with an error summary.
 */

import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AgentState } from "../state";
import { getPlannerLLM } from "./shared";

const MAX_RETRIES = 2;

const replanSchema = z.object({
    type: z
        .enum(["continue", "retry", "done"])
        .describe(
            "'continue' = step succeeded, move to next step. " +
            "'retry' = step failed, attempt it again. " +
            "'done' = entire task is complete (or cannot proceed)."
        ),
    reason: z
        .string()
        .optional()
        .describe("Brief explanation of why the step failed (only for 'retry')"),
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
    "and the result of the LAST step, you MUST determine:\n\n" +
    "1. Did the last step SUCCEED or FAIL?\n" +
    "   - A step SUCCEEDED if its output shows the desired action was completed " +
    "(e.g., file was created, command returned expected output, information was retrieved).\n" +
    "   - A step FAILED if the output contains errors, exceptions, 'command not found', " +
    "permission denied, unexpected empty results, or any indication the action did NOT complete.\n\n" +
    "2. Based on that evaluation:\n" +
    "   - If the step FAILED → respond with type 'retry' and explain why in 'reason'.\n" +
    "   - If the step SUCCEEDED and more steps remain → respond with type 'continue' " +
    "and provide the remaining steps.\n" +
    "   - If the step SUCCEEDED and the task is fully complete → respond with type 'done' " +
    "and provide a final summary response.\n\n" +
    "Be strict: if there is ANY indication of failure, choose 'retry'."
);

export async function replanNode(
    state: AgentState
): Promise<Partial<AgentState>> {
    const structuredLLM = getPlannerLLM().withStructuredOutput(replanSchema);

    // Build context for the replanner
    const userMessages = state.messages.filter(
        (m) => m._getType() === "human"
    );
    const originalRequest = userMessages[0]?.content || "";

    const pastStepsText = state.pastSteps
        .map(([step, result]) => `Step: ${step}\nResult: ${result}`)
        .join("\n\n");

    const remainingText = state.plan.slice(1).join("\n");

    const lastStepOutput = String(
        state.messages[state.messages.length - 1]?.content || "(no output)"
    );

    const retryContext =
        state.stepRetries > 0
            ? `\n\n⚠️ This is retry attempt ${state.stepRetries}/${MAX_RETRIES} for this step.`
            : "";

    const result = await structuredLLM.invoke([
        REPLAN_SYSTEM,
        new HumanMessage(
            `Original request: ${originalRequest}\n\n` +
            `Completed steps:\n${pastStepsText || "(none yet)"}\n\n` +
            `Current step being evaluated: ${state.currentStep}\n` +
            `Step output:\n${lastStepOutput}\n\n` +
            `Remaining planned steps:\n${remainingText || "(none)"}` +
            retryContext
        ),
    ]);

    // ─── DONE: task complete or cannot proceed ──────────────────────
    if (result.type === "done") {
        return {
            response: result.response || "Task completed.",
            stepStatus: "success",
            stepRetries: 0,
        };
    }

    // ─── RETRY: step failed, attempt again ──────────────────────────
    if (result.type === "retry") {
        const currentRetries = state.stepRetries + 1;

        // Exhausted all retries — give up on this step
        if (currentRetries > MAX_RETRIES) {
            console.warn(
                `[Replan] Step "${state.currentStep}" failed after ${MAX_RETRIES} retries. Giving up.`
            );
            return {
                response:
                    `❌ Task could not be completed. Step "${state.currentStep}" ` +
                    `failed after ${MAX_RETRIES + 1} attempts.\n\n` +
                    `Last failure reason: ${result.reason || "Unknown error"}`,
                stepStatus: "failed",
                stepRetries: currentRetries,
            };
        }

        console.log(
            `[Replan] Step "${state.currentStep}" failed (attempt ${currentRetries}/${MAX_RETRIES + 1}). ` +
            `Reason: ${result.reason || "Unknown"}. Retrying...`
        );

        // Keep the same plan (don't advance) — executor will re-inject plan[0]
        return {
            stepStatus: "failed",
            stepRetries: currentRetries,
        };
    }

    // ─── CONTINUE: step succeeded, advance to next ──────────────────
    let newSteps = result.steps && result.steps.length > 0 ? result.steps : state.plan.slice(1);

    // Anti-loop: If the LLM returned the exact same plan, force advancement
    if (JSON.stringify(newSteps) === JSON.stringify(state.plan)) {
        console.warn(`[Replan] LLM returned identical plan for 'continue'. Forcing advance.`);
        newSteps = state.plan.slice(1);
    }

    return {
        plan: newSteps,
        pastSteps: [[state.currentStep, lastStepOutput]],
        currentStep: newSteps[0] || "",

        stepStatus: "success",
        stepRetries: 0,
    };
}
