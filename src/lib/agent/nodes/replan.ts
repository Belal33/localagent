/**
 * ─── Replan Node ────────────────────────────────────────────────────────────
 *
 * After each step completes, evaluates progress and decides whether
 * to continue with the next step, retry the failed step, or finalize.
 *
 * Design notes (robustness):
 *   - The original plan is IMMUTABLE during execution. Replan cannot
 *     regenerate steps — it can only advance, retry, or finish.
 *     (If the plan is truly wrong, the correct recovery is to finish
 *     early and let the user re-prompt.)
 *   - Replan evaluates the FULL trajectory of the current step
 *     (every AI message + tool result produced since the executor ran),
 *     not just `messages[last]`. This makes success/failure judgment
 *     much more reliable, especially for multi-tool-call steps.
 *   - Retry policy: each step gets up to MAX_RETRIES=2 additional
 *     attempts (3 total) before giving up and finalizing with an error.
 */

import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AgentState } from "../state";
import { getPlannerLLMFromConfig } from "./shared";
import { RunnableConfig } from "@langchain/core/runnables";

const MAX_RETRIES = 2;

const replanSchema = z.object({
    type: z
        .enum(["continue", "retry", "done"])
        .describe(
            "'continue' = step succeeded, move to next step in the existing plan. " +
            "'retry' = step failed, attempt the SAME step again. " +
            "'done' = the LAST step of the plan just succeeded, so the whole task is complete. " +
            "Use 'done' only when there are NO remaining steps."
        ),
    reason: z
        .string()
        .optional()
        .describe("Brief explanation of why the step failed (only for 'retry')"),
    response: z
        .string()
        .optional()
        .describe("Final summary response to the user (only for 'done')"),
});

const REPLAN_SYSTEM = new SystemMessage(
    "You are a strict task evaluator. You are given the original user request, the fixed plan, " +
    "completed steps, the trajectory of the CURRENT step (all tool calls, tool results, and agent " +
    "messages produced while executing it), and the list of remaining steps.\n\n" +
    "Your ONLY job is to decide what happens next. You CANNOT rewrite the plan.\n\n" +
    "Decision rules:\n" +
    "1. SUCCESS: the step's trajectory shows the intended action was actually performed " +
    "(tool executed without fatal error, expected effect is visible in the output).\n" +
    "   - If there ARE remaining steps → type: 'continue'.\n" +
    "   - If there are NO remaining steps → type: 'done' with a final 'response' summarising the whole task.\n\n" +
    "2. FAILURE: the trajectory contains errors, exceptions, 'command not found', permission denied, " +
    "empty/irrelevant output where action was expected, or the agent gave up in prose instead of using tools.\n" +
    "   - type: 'retry' with a short 'reason'.\n\n" +
    "3. NEVER regenerate or alter the plan. Never return 'continue' when the remaining list is empty — " +
    "use 'done' in that case. Never return 'done' while remaining steps exist — use 'continue'.\n\n" +
    "Be decisive. If a tool ran and produced reasonable output, treat the step as successful.\n\n" +
    "OUTPUT FORMAT (STRICT):\n" +
    "Return a single JSON object. No prose, no markdown fences, no explanation before or after.\n" +
    `Examples:\n` +
    `  {"type": "continue"}\n` +
    `  {"type": "retry", "reason": "curl returned empty — HTML selector mismatch"}\n` +
    `  {"type": "done", "response": "Scraped top 5 HN stories and saved to file."}\n` +
    "The `type` field MUST be exactly one of: \"continue\", \"retry\", \"done\"."
);

// ─── Trajectory extraction ──────────────────────────────────────────────────
// Pull out the messages produced DURING the current step (from stepStartIndex
// to the end) and render them as a compact transcript for the evaluator.
function buildStepTrajectory(state: AgentState): string {
    const start = Math.max(0, state.stepStartIndex || 0);
    const stepMessages = state.messages.slice(start);

    if (stepMessages.length === 0) {
        return "(no messages produced during this step)";
    }

    const lines: string[] = [];
    for (const m of stepMessages) {
        const t = m._getType();
        if (t === "ai") {
            const ai = m as AIMessage;
            const text = typeof ai.content === "string"
                ? ai.content
                : JSON.stringify(ai.content);
            if (text.trim()) {
                lines.push(`AGENT: ${truncate(text, 1500)}`);
            }
            for (const tc of ai.tool_calls ?? []) {
                const args = safeJson(tc.args);
                lines.push(`TOOL_CALL: ${tc.name}(${truncate(args, 500)})`);
            }
        } else if (t === "tool") {
            const tm = m as ToolMessage;
            const text = typeof tm.content === "string"
                ? tm.content
                : JSON.stringify(tm.content);
            lines.push(`TOOL_RESULT[${tm.name ?? "?"}]: ${truncate(text, 1500)}`);
        }
        // Human/system messages inside a step are only from the executor's
        // legacy injection or the memory node; skip them for signal clarity.
    }
    return lines.join("\n");
}

function truncate(s: string, n: number): string {
    if (s.length <= n) return s;
    return s.slice(0, n) + `… [truncated ${s.length - n} chars]`;
}

function safeJson(v: unknown): string {
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

// ─── Parse-recovery helper ──────────────────────────────────────────────────
// Some models (minimax-m2.7) ignore the Zod schema and reply in prose or
// with a fenced JSON blob. Coerce whatever we got into the replan shape.
type ReplanDecision = z.infer<typeof replanSchema>;

function coerceReplanFromText(raw: string): ReplanDecision | null {
    if (!raw) return null;
    const trimmed = raw.trim();

    // 1. Try direct JSON parse (possibly fenced).
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = (fenced ? fenced[1] : trimmed).trim();
    try {
        const obj = JSON.parse(body) as Record<string, unknown>;
        if (obj && typeof obj === "object" && typeof obj.type === "string") {
            const t = obj.type.toLowerCase();
            if (t === "continue" || t === "retry" || t === "done") {
                return {
                    type: t,
                    reason: typeof obj.reason === "string" ? obj.reason : undefined,
                    response: typeof obj.response === "string" ? obj.response : undefined,
                };
            }
        }
    } catch {
        // not JSON — continue to prose heuristic
    }

    // 2. Prose heuristic: detect decision words + extract reason/response.
    const lower = trimmed.toLowerCase();
    const mentionsRetry = /\b(retry|failed|fail|error)\b/.test(lower);
    const mentionsDone = /\b(done|complete(d)?|finished|task complete)\b/.test(lower);
    const mentionsContinue = /\b(continue|proceed|next step|move on)\b/.test(lower);

    // Priority: retry > done > continue (failure signals are most actionable).
    if (mentionsRetry) {
        // Try to extract a "Reason:" or "**Reason:**" line.
        const reasonMatch = trimmed.match(/\*{0,2}reason\*{0,2}\s*:\s*([^\n]+)/i);
        return {
            type: "retry",
            reason: reasonMatch ? reasonMatch[1].trim() : truncate(trimmed, 300),
        };
    }
    if (mentionsDone) {
        return { type: "done", response: truncate(trimmed, 800) };
    }
    if (mentionsContinue) {
        return { type: "continue" };
    }

    return null;
}

export async function replanNode(
    state: AgentState,
    config: RunnableConfig
): Promise<Partial<AgentState>> {
    const plannerLLM = getPlannerLLMFromConfig(config);

    // ─── Build evaluator context ───────────────────────────────────
    const userMessages = state.messages.filter((m) => m._getType() === "human");
    const originalRequest = typeof userMessages[0]?.content === "string"
        ? userMessages[0].content
        : JSON.stringify(userMessages[0]?.content ?? "");

    const pastStepsText = state.pastSteps.length
        ? state.pastSteps
            .map(([step, result], i) => `${i + 1}. ${step}\n   → ${truncate(result, 300)}`)
            .join("\n")
        : "(none yet)";

    const remainingAfterCurrent = state.plan.slice(1);
    const remainingText = remainingAfterCurrent.length
        ? remainingAfterCurrent.map((s, i) => `${i + 1}. ${s}`).join("\n")
        : "(none — this was the last step)";

    const trajectory = buildStepTrajectory(state);

    const retryContext = state.stepRetries > 0
        ? `\n\n⚠️ This is retry attempt ${state.stepRetries}/${MAX_RETRIES} for this step.`
        : "";

    const evaluatorUserMsg = new HumanMessage(
        `ORIGINAL REQUEST:\n${originalRequest}\n\n` +
        `COMPLETED STEPS:\n${pastStepsText}\n\n` +
        `CURRENT STEP (just executed): ${state.currentStep}\n\n` +
        `CURRENT STEP TRAJECTORY:\n${trajectory}\n\n` +
        `REMAINING STEPS (fixed, cannot be changed):\n${remainingText}` +
        retryContext
    );

    // ─── Primary: structured output via Zod ───────────────────────────────────
    let result: ReplanDecision | null = null;
    try {
        const structuredLLM = plannerLLM.withStructuredOutput(replanSchema);
        result = await structuredLLM.invoke([REPLAN_SYSTEM, evaluatorUserMsg]);
        console.log(`[Replan] Structured output succeeded: type=${result.type}`);
    } catch (err: unknown) {
        const e = err as { lc_error_code?: string; message?: string; llmOutput?: string };
        const isParseError =
            e?.lc_error_code === "OUTPUT_PARSING_FAILURE" ||
            /Failed to parse/i.test(e?.message ?? "");
        if (!isParseError) throw err;

        console.warn(
            `[Replan] Structured output parse failed — recovering via plain-text invoke. Offending: ${(e.llmOutput ?? "").slice(0, 200)}`
        );

        // ─── Fallback: plain-text invoke + manual coercion ───────────────────
        const rawResponse = await plannerLLM.invoke([REPLAN_SYSTEM, evaluatorUserMsg]);
        const rawText =
            typeof rawResponse.content === "string"
                ? rawResponse.content
                : JSON.stringify(rawResponse.content);
        result = coerceReplanFromText(rawText);

        if (!result) {
            // Couldn't coerce — treat as retry with the raw text as reason,
            // so we don't hang and the retry policy applies.
            console.warn(`[Replan] Could not coerce fallback output — defaulting to retry`);
            result = {
                type: "retry",
                reason: `Evaluator returned unparseable output: ${truncate(rawText, 200)}`,
            };
        } else {
            console.log(`[Replan] Recovered decision from plain-text fallback: type=${result.type}`);
        }
    }

    // A short summary of what happened in this step — stored in pastSteps.
    const stepSummary = truncate(trajectory, 600);

    // ─── DONE: last step succeeded, task complete ──────────────────────────
    // Accept 'done' only if there are truly no remaining steps. Otherwise
    // coerce to 'continue' to prevent premature termination.
    if (result.type === "done") {
        if (remainingAfterCurrent.length === 0) {
            return {
                response: result.response || "Task completed.",
                pastSteps: [[state.currentStep, stepSummary]],
                plan: [],
                currentStep: "",
                stepStatus: "success",
                stepRetries: 0,
            };
        }
        console.warn(
            `[Replan] LLM returned 'done' but ${remainingAfterCurrent.length} step(s) remain. Treating as 'continue'.`
        );
        // fall through to continue handling
    }

    // ─── RETRY: step failed, re-run the SAME plan[0] ───────────────────────
    if (result.type === "retry") {
        const currentRetries = state.stepRetries + 1;

        if (currentRetries > MAX_RETRIES) {
            console.warn(
                `[Replan] Step "${state.currentStep}" failed after ${MAX_RETRIES + 1} attempts. Giving up.`
            );
            return {
                response:
                    `❌ Task could not be completed. Step "${state.currentStep}" ` +
                    `failed after ${MAX_RETRIES + 1} attempts.\n\n` +
                    `Last failure reason: ${result.reason || "Unknown error"}`,
                pastSteps: [[state.currentStep, `FAILED: ${stepSummary}`]],
                plan: [],
                currentStep: "",
                stepStatus: "failed",
                stepRetries: currentRetries,
            };
        }

        console.log(
            `[Replan] Step "${state.currentStep}" failed (attempt ${currentRetries}/${MAX_RETRIES + 1}). ` +
            `Reason: ${result.reason || "Unknown"}. Retrying...`
        );

        // Keep the plan unchanged so executor re-runs the same plan[0].
        return {
            stepStatus: "failed",
            stepRetries: currentRetries,
        };
    }

    // ─── CONTINUE: step succeeded, advance to the next existing step ───────
    // The plan is immutable — we always pop plan[0], never regenerate.
    const newPlan = state.plan.slice(1);

    // If nothing is left, synthesize a 'done' so the graph terminates cleanly
    // instead of going through an empty executor cycle.
    if (newPlan.length === 0) {
        return {
            response: result.response || "Task completed.",
            pastSteps: [[state.currentStep, stepSummary]],
            plan: [],
            currentStep: "",
            stepStatus: "success",
            stepRetries: 0,
        };
    }

    return {
        plan: newPlan,
        pastSteps: [[state.currentStep, stepSummary]],
        currentStep: newPlan[0],
        stepStatus: "success",
        stepRetries: 0,
    };
}
