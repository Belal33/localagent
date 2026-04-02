import { ChatAnthropic } from "@langchain/anthropic";

// ─── Shared LLM Configuration for Planning Nodes ────────────────────────────
const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY;
const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";

export const plannerLLM = new ChatAnthropic({
    model: "glm-5",
    maxTokens: 4096,
    temperature: 0.2,
    anthropicApiKey: OPENCODE_API_KEY,
    anthropicApiUrl: OPENCODE_BASE_URL,
});
