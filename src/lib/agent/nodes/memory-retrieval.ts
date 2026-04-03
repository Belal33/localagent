/**
 * src/lib/agent/nodes/memory-retrieval.ts
 *
 * Memory Retrieval Node — runs BEFORE the classifier.
 *
 * Enriches the agent's context by querying the external Cognee Memory Engine
 * using CHUNKS search to retrieve actual stored text fragments.
 *
 * GRAPH_COMPLETION was previously used but returns LLM-generated summaries
 * that are too generic for UI display. CHUNKS returns the raw stored data
 * which is both better for display AND gives the agent richer context.
 */
import { HumanMessage } from "@langchain/core/messages";

const COGNEE_BASE_URL = process.env.COGNEE_URL || "http://cognee:8000";

/** Minimum text length to consider a chunk as meaningful memory */
const MIN_CHUNK_LENGTH = 10;

export interface MemoryChunk {
    text: string;
    score: number | null;
    source: string;
}

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

        // ─── Cognee Search — POST /api/v1/search (CHUNKS) ───────────────────
        let memoryChunks: MemoryChunk[] = [];

        try {
            const searchRes = await fetch(`${COGNEE_BASE_URL}/api/v1/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: userQuery,
                    search_type: "CHUNKS",
                    top_k: 5,
                }),
            });

            if (searchRes.ok) {
                const results = await searchRes.json();
                console.log("[Memory Retrieval] Raw Cognee CHUNKS response:", JSON.stringify(results).slice(0, 500));

                // CHUNKS returns: [{ text: "...", id: "...", feedback_weight: 0.5, ... }]
                const items: unknown[] = Array.isArray(results) ? results : [];

                for (const r of items) {
                    if (r && typeof r === "object") {
                        const obj = r as Record<string, unknown>;
                        const text = String(obj.text || "").trim();

                        // Filter out trivial chunks (bare greetings, single words, etc.)
                        if (text.length >= MIN_CHUNK_LENGTH) {
                            memoryChunks.push({
                                text,
                                score: typeof obj.feedback_weight === "number" ? obj.feedback_weight : null,
                                source: "cognee",
                            });
                        }
                    } else if (typeof r === "string" && r.trim().length >= MIN_CHUNK_LENGTH) {
                        memoryChunks.push({ text: r.trim(), score: null, source: "cognee" });
                    }
                }
            } else {
                console.warn("[Memory Retrieval] Cognee search failed:", searchRes.status, await searchRes.text());
            }
        } catch (err) {
            console.warn("[Memory Retrieval] Cognee engine unavailable:", (err as Error).message);
        }

        // ─── Inject memory context ─────────────────────────────────────────
        if (memoryChunks.length === 0) return {};

        const memoryLines = memoryChunks.map((c) => `- ${c.text}`);
        const textParts = ["## Relevant Memory from past interactions:", ...memoryLines];

        const memoryContextMsg = new HumanMessage({
            content: `[MEMORY CONTEXT — relevant information from past interactions]\n${textParts.join("\n")}\n[END MEMORY CONTEXT]`,
        });

        console.log(`[Memory Retrieval] Injecting ${memoryChunks.length} memory chunks`);

        return {
            messages: [memoryContextMsg],
            retrievedMemory: memoryChunks,
        };
    } catch (err) {
        // Top-level catch: never crash the graph due to memory failures
        console.warn("[Memory Retrieval] Unexpected error (skipping):", (err as Error).message);
        return {};
    }
}
