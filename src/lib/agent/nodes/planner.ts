/**
 * ─── Phase 3: Planner & Replan Nodes ────────────────────────────────────────
 *
 * Planner: Uses structured output to decompose a complex user request into
 *          an ordered list of actionable steps.
 * Replan:  After each step completes, evaluates progress and decides whether
 *          to continue with remaining steps, adjust the plan, or finalize.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AgentState } from "../state";

// ─── LLM for Planning (same proxy as agent) ────────────────────────────────
const ANTHROPIC_PROXY_URL = "http://localhost:8080";

const plannerLLM = new ChatAnthropic({
    model: "gemini-3-flash",
    maxTokens: 4096,
    temperature: 0.2,
    apiKey: "not-needed",
    clientOptions: { baseURL: ANTHROPIC_PROXY_URL },
});

// ─── Schemas ────────────────────────────────────────────────────────────────

const planSchema = z.object({
    steps: z
        .array(z.string())
        .describe("Ordered list of clear, actionable steps to accomplish the task"),
});

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

// ─── Planner Node ───────────────────────────────────────────────────────────

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

// ─── Executor Node ──────────────────────────────────────────────────────────
// Picks the next step from the plan and injects it as a HumanMessage
// for the agent to execute.

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

// ─── Replan Node ────────────────────────────────────────────────────────────
// After the agent completes a step, evaluates whether to continue or finalize.

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

// ─── Classifier Node ───────────────────────────────────────────────────────
// Lightweight check to determine if a request needs planning or can be
// handled directly by the simple ReAct agent.

const CLASSIFIER_SYSTEM = new SystemMessage(
    "You are a request classifier. Given a user message, determine if it requires " +
    "multi-step planning or can be answered directly.\n\n" +
    "Respond with ONLY one word: 'simple' or 'complex'\n\n" +
    "Rules:\n" +
    "- 'simple': Questions, single-step tasks, information retrieval, basic file reads\n" +
    "- 'complex': Multi-file operations, project creation, multi-step workflows, " +
    "building something, installing and configuring software"
);

export async function classifierNode(
    state: AgentState
): Promise<Partial<AgentState> & { classification?: string }> {
    const userMessages = state.messages.filter(
        (m) => m.type === "human"
    );
    const lastUserMsg = userMessages[userMessages.length - 1];
    // if user message is less than 5 words, return simple
    if ((typeof lastUserMsg?.content === "string") && (lastUserMsg?.content)?.split(" ").length < 10) {
        return { classification: "simple" };
    }

    const response = await plannerLLM.invoke([CLASSIFIER_SYSTEM, lastUserMsg]);

    const text = (typeof response.content === "string"
        ? response.content
        : ""
    ).trim().toLowerCase();

    const classification = text.includes("complex") ? "complex" : "simple";

    return { classification } as Partial<AgentState> & { classification: string };
}
