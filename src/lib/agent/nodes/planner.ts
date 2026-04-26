/**
 * ─── Planner Node ───────────────────────────────────────────────────────────
 *
 * Uses structured output to decompose a complex user request into
 * an ordered list of actionable steps.
 *
 * Hardening: some OpenCode Zen models (notably minimax-m2.7) ignore the
 * Zod schema envelope and return a bare array, prose, or fenced JSON.
 * We catch OUTPUT_PARSING_FAILURE and recover by prompting the LLM in
 * plain-text mode and coercing whatever it returns into `string[]`.
 */

import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AgentState } from "../state";
import { getPlannerLLMFromConfig } from "./shared";
import { RunnableConfig } from "@langchain/core/runnables";
import { getAllPossibleTools } from "../skills";
import { getAgentSettingsSync } from "../settings";

const planSchema = z.object({
    steps: z
        .array(z.string())
        .describe("Ordered list of clear, actionable steps to accomplish the task"),
});

function buildSystemPrompt(toolDescriptions: string): SystemMessage {
    return new SystemMessage(
        "You are a task planner. Given a user's request, break it down into clear, " +
        "sequential, actionable steps that an AI agent can execute.\n\n" +
        "The executor agent has access to the following capabilities and tools:\n" +
        toolDescriptions + "\n\n" +
        "Each step should be a single, concrete action that aligns with these tools. " +
        "Keep steps minimal — only include what's necessary.\n\n" +
        "OUTPUT FORMAT (STRICT):\n" +
        "Return a JSON object with one key `steps` whose value is an array of strings.\n" +
        `Example: {"steps": ["Search the web for X", "Summarize the findings"]}\n` +
        "Each step MUST be a plain English string, NOT an object. " +
        "Do NOT wrap in markdown fences. Do NOT add prose before or after. " +
        "Do NOT return a bare array — always wrap in the {\"steps\": [...]} envelope."
    );
}

/**
 * Coerce an arbitrary LLM text response into a string[] plan.
 * Handles: fenced JSON, bare arrays, {steps: [...]} envelope, array of objects, numbered prose lines.
 */
function coercePlanFromText(raw: string): string[] {
    if (!raw) return [];
    // Strip ```json / ``` fences if present
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = (fenced ? fenced[1] : raw).trim();

    // Try JSON first
    try {
        const parsed = JSON.parse(body);
        const arr: unknown[] = Array.isArray(parsed)
            ? parsed
            : Array.isArray((parsed as { steps?: unknown })?.steps)
                ? (parsed as { steps: unknown[] }).steps
                : [];
        const steps = arr
            .map((item) => {
                if (typeof item === "string") return item.trim();
                if (item && typeof item === "object") {
                    const o = item as Record<string, unknown>;
                    // Common shapes: {step, action, details}, {description}, {text}, etc.
                    const candidate =
                        o.description ?? o.text ?? o.step_description ?? o.action ?? o.name;
                    if (typeof candidate === "string") return candidate.trim();
                    // Fall back to a compact stringification
                    return JSON.stringify(o);
                }
                return String(item).trim();
            })
            .filter((s) => s.length > 0);
        if (steps.length > 0) return steps;
    } catch {
        // Not valid JSON — fall through to prose parsing
    }

    // Prose fallback: split on newlines, drop empties and list markers
    return body
        .split(/\n+/)
        .map((line) =>
            line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()
        )
        .filter((line) => line.length > 0);
}

export async function plannerNode(
    state: AgentState,
    config: RunnableConfig
): Promise<Partial<AgentState>> {
    const plannerLLM = getPlannerLLMFromConfig(config);
    const tools = getAllPossibleTools({ settings: getAgentSettingsSync() });
    const toolDescriptions = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
    const PLANNER_SYSTEM = buildSystemPrompt(toolDescriptions);

    const userMessages = state.messages.filter((m) => m.type === "human");
    const lastUserMsg = userMessages[userMessages.length - 1];

    // ─── Primary: structured output via Zod ──────────────────────────────────
    try {
        const structuredLLM = plannerLLM.withStructuredOutput(planSchema);
        const result = await structuredLLM.invoke([PLANNER_SYSTEM, lastUserMsg]);
        console.log(`[Planner] Structured output succeeded: ${result.steps.length} step(s)`);
        return {
            plan: result.steps,
            currentStep: result.steps[0] || "",
        };
    } catch (err: unknown) {
        const e = err as { lc_error_code?: string; message?: string; llmOutput?: string };
        const isParseError =
            e?.lc_error_code === "OUTPUT_PARSING_FAILURE" ||
            /Failed to parse/i.test(e?.message ?? "");
        if (!isParseError) throw err;

        console.warn(
            `[Planner] Structured output parse failed — recovering via plain-text invoke. Offending: ${(e.llmOutput ?? "").slice(0, 200)}`
        );
    }

    // ─── Fallback: plain-text invoke + manual coercion ───────────────────────
    const rawResponse = await plannerLLM.invoke([PLANNER_SYSTEM, lastUserMsg]);
    const rawText =
        typeof rawResponse.content === "string"
            ? rawResponse.content
            : JSON.stringify(rawResponse.content);

    const steps = coercePlanFromText(rawText);
    console.log(`[Planner] Recovered ${steps.length} step(s) from plain-text fallback`);

    if (steps.length === 0) {
        // Couldn't produce any plan — throw so the request fails visibly rather than hanging.
        throw new Error(
            `Planner failed to produce any steps. Raw LLM output: ${rawText.slice(0, 500)}`
        );
    }

    return {
        plan: steps,
        currentStep: steps[0] || "",
    };
}
