/**
 * src/lib/agent/nodes/memory-retrieval.ts
 *
 * Memory Retrieval Node — runs BEFORE the classifier.
 *
 * Enriches the agent's context by querying the external Cognee Memory Engine
 * which automatically handles navigating both vector embeddings and semantic graph trips.
 */
import { HumanMessage } from "@langchain/core/messages";

const COGNEE_BASE_URL = process.env.COGNEE_URL || "http://127.0.0.1:8001";
const USER_ID = "default"; // Single-user mode; extend via session config when needed

export async function memoryRetrievalNode(state: { messages: unknown[] }) {
    try {
        // Extract the latest human message text
        const lastMessage = state.messages[state.messages.length - 1] as {
            content: string | Array<{ type: string; text?: string }>;
            _getType?: () => string;
        };

        if (!lastMessage) return {};

        const userQuery =
            typeof lastMessage.content === "string"
                ? lastMessage.content
                : (lastMessage.content as Array<{ type: string; text?: string }>)
                    .filter((c) => c.type === "text" && c.text)
                    .map((c) => c.text)
                    .join("");

        if (!userQuery.trim()) return {};

        // ─── Cognee Combined Hybrid Search ──────────────────────────────────────
        let memoryItems: string[] = [];
        try {
            const searchRes = await fetch(`${COGNEE_BASE_URL}/api/v1/search?query=${encodeURIComponent(userQuery)}`, {
                method: "GET",
                headers: { "Content-Type": "application/json" }
            });

            if (searchRes.ok) {
                const results = await searchRes.json();
                // Depending on Cognee's output schema, we parse the results into string fragments
                // Defaulting to extracting `.text` or passing raw chunks back to the prompt
                if (Array.isArray(results)) {
                    memoryItems = results.map((r: any) => `- ${r.text || JSON.stringify(r)}`);
                } else if (results.results && Array.isArray(results.results)) {
                    memoryItems = results.results.map((r: any) => `- ${r.text || JSON.stringify(r)}`);
                } else {
                    memoryItems = [`- ${JSON.stringify(results)}`];
                }
            }
        } catch (err) {
            console.warn("[Memory Retrieval] Cognee engine unavailable:", (err as Error).message);
        }

        // ─── Inject memory context ─────────────────────────────────────────
        if (memoryItems.length === 0) return {};

        const textParts = ["## Relevant Memory and Known Facts from past interactions:", ...memoryItems];

        const memoryContext = new HumanMessage({
            content: `[MEMORY CONTEXT — relevant information from past interactions]\n${textParts.join("\n")}\n[END MEMORY CONTEXT]`,
        });

        return {
            messages: [memoryContext],
            retrievedMemory: { rawSearch: memoryItems },
        };
    } catch (err) {
        // Top-level catch: never crash the graph due to memory failures
        console.warn("[Memory Retrieval] Unexpected error (skipping):", (err as Error).message);
        return {};
    }
}
