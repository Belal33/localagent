import { ChatAnthropic } from "@langchain/anthropic";

// ─── Shared LLM Configuration for Planning Nodes ────────────────────────────
const ANTHROPIC_PROXY_URL = "http://localhost:8080";

export const plannerLLM = new ChatAnthropic({
    model: "gemini-3-flash",
    maxTokens: 4096,
    temperature: 0.2,
    apiKey: "not-needed",
    clientOptions: { baseURL: ANTHROPIC_PROXY_URL },
});
