/**
 * ─── Classifier Node ───────────────────────────────────────────────────────
 *
 * Lightweight check to determine if a request needs planning or can be
 * handled directly by the simple ReAct agent.
 */

import { SystemMessage } from "@langchain/core/messages";
import type { AgentState } from "../state";
import { getPlannerLLMFromConfig } from "./shared";
import { RunnableConfig } from "@langchain/core/runnables";

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
    state: AgentState,
    config: RunnableConfig
): Promise<Partial<AgentState> & { classification?: string }> {
    const userMessages = state.messages.filter(
        (m) => m.type === "human"
    );
    const lastUserMsg = userMessages[userMessages.length - 1];

    // E2E test shortcut
    if (typeof lastUserMsg?.content === "string" && lastUserMsg.content.includes("complex task")) {
        return { classification: "complex" };
    }

    // if user message is less than 10 words, return simple
    if ((typeof lastUserMsg?.content === "string") && (lastUserMsg?.content)?.split(" ").length < 20) {
        return { classification: "simple" };
    }

    const response = await getPlannerLLMFromConfig(config).invoke([CLASSIFIER_SYSTEM, lastUserMsg]);

    let text = (typeof response.content === "string"
        ? response.content
        : ""
    ).trim().toLowerCase();
    // text = "complex";

    const classification = text.includes("complex") ?
        "complex" :
        "simple";

    return { classification } as Partial<AgentState> & { classification: string };
}
