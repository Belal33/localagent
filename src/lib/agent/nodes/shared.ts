import { ChatOpenAI } from "@langchain/openai";

// ─── Shared LLM Configuration for Planning Nodes ────────────────────────────
const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";

let _plannerLLM: ChatOpenAI | null = null;

export function getPlannerLLM(): ChatOpenAI {
    if (!_plannerLLM) {
        _plannerLLM = new ChatOpenAI({
            model: "minimax-m2.7",
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
