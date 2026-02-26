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
import { getAllPossibleTools } from "../skills";

const planSchema = z.object({
    steps: z
        .array(z.string())
        .describe("Ordered list of clear, actionable steps to accomplish the task"),
});

export async function plannerNode(
    state: AgentState
): Promise<Partial<AgentState>> {
    const structuredLLM = plannerLLM.withStructuredOutput(planSchema);

    const tools = getAllPossibleTools();
    const toolDescriptions = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");

    const PLANNER_SYSTEM = new SystemMessage(
        "You are a task planner. Given a user's request, break it down into clear, " +
        "sequential, actionable steps that an AI agent can execute.\n\n" +
        "The executor agent has access to the following capabilities and tools:\n" +
        toolDescriptions + "\n\n" +
        "Each step should be a single, concrete action that aligns with these tools. " +
        "Keep steps minimal — only include what's necessary. " +
        "Return ONLY the structured output, no explanation."
    );

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
