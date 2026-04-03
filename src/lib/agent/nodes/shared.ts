import { ChatOpenAI } from "@langchain/openai";
import { RunnableConfig } from "@langchain/core/runnables";

// ─── Shared LLM Configuration for Planning Nodes ────────────────────────────
const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";

let _plannerLLM: ChatOpenAI | null = null;
let _plannerModel = "minimax-m2.5";

export function getPlannerLLM(model?: string): ChatOpenAI {
    const targetModel = model || _plannerModel;
    if (!_plannerLLM || targetModel !== _plannerModel) {
        _plannerModel = targetModel;
        _plannerLLM = new ChatOpenAI({
            model: targetModel,
            maxTokens: 4096,
            temperature: 0.2,
            configuration: {
                apiKey: process.env.OPENCODE_API_KEY,
                baseURL: OPENCODE_BASE_URL,
            },
        });
    }
    return _plannerLLM;
}

/** Helper to extract plannerModel from a LangGraph RunnableConfig */
export function getPlannerLLMFromConfig(config?: RunnableConfig): ChatOpenAI {
    const model = (config?.configurable as Record<string, string> | undefined)?.plannerModel;
    return getPlannerLLM(model);
}
