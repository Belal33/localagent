/**
 * ─── Planner Node ───────────────────────────────────────────────────────────
 *
 * Uses structured output to decompose a complex user request into
 * an ordered list of actionable steps.
 */

import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AgentState } from "../state";
import { plannerLLM } from "./shared";

const planSchema = z.object({
    steps: z
        .array(z.string())
        .describe("Ordered list of clear, actionable steps to accomplish the task"),
});

const PLANNER_SYSTEM = new SystemMessage(
    "You are a task planner. Given a user's request, break it down into clear, " +
    "sequential, actionable steps that an AI agent with file system, terminal, " +
    "web search, and download tools can execute. " +
    "Each step should be a single, concrete action. " +
    "Keep steps minimal — only include what's necessary. " +
    "Return ONLY the structured output, no explanation."
);

export async function plannerNode(
    state: AgentState
): Promise<Partial<AgentState>> {
    const structuredLLM = plannerLLM.withStructuredOutput(planSchema);

    const userMessages = state.messages.filter(
        (m) => m.type === "human"
    );
    const lastUserMsg = userMessages[userMessages.length - 1];

    const result = await structuredLLM.invoke([
        PLANNER_SYSTEM,
        lastUserMsg,
    ]);

    return {
        plan: result.steps,
        currentStep: result.steps[0] || "",
    };
}
