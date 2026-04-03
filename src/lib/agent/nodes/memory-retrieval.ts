/**
 * src/lib/agent/nodes/memory-retrieval.ts
 *
 * Memory Retrieval Node — runs BEFORE the classifier.
 *
 * Enriches the agent's context by querying the external Cognee Memory Engine.
 * Uses a dual-search strategy (CHUNKS + SUMMARIES) to maximize recall:
 *   - CHUNKS: raw stored text fragments (includes actual knowledge like user profile)
 *   - SUMMARIES: synthesized knowledge titles (higher-level context)
 *
 * Filters out echo noise (stored user queries like "User: what is my name")
 * and deduplicates results before injecting into the agent's context.
 */
import { HumanMessage } from "@langchain/core/messages";

const COGNEE_BASE_URL = process.env.COGNEE_URL || "http://cognee:8000";

/** Minimum text length to consider a chunk as meaningful memory */
const MIN_CHUNK_LENGTH = 10;

/**
 * Pattern to identify echoed user messages that were stored as chunks.
 * These are noise — just the raw queries, not actual knowledge.
 */
const USER_ECHO_PATTERN = /^(User|Assistant|Human|AI):\s/i;

export interface MemoryChunk {
    text: string;
    score: number | null;
    source: "chunk" | "summary";
}

/** Run a single Cognee search and return raw results */
async function cogneeSearch(query: string, searchType: string, topK: number): Promise<unknown[]> {
    try {
        const res = await fetch(`${COGNEE_BASE_URL}/api/v1/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query,
                search_type: searchType,
                top_k: topK,
            }),
        });

        if (res.ok) {
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        }
        console.warn(`[Memory Retrieval] ${searchType} search failed:`, res.status);
        return [];
    } catch (err) {
        console.warn(`[Memory Retrieval] ${searchType} search error:`, (err as Error).message);
        return [];
    }
}

/** Extract text from a Cognee result item */
function extractText(item: unknown): string {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object") {
        return String((item as Record<string, unknown>).text || "").trim();
    }
    return "";
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

        // ─── Dual Search: CHUNKS + SUMMARIES in parallel ────────────────────
        const [chunkResults, summaryResults] = await Promise.all([
            cogneeSearch(userQuery, "CHUNKS", 10),
            cogneeSearch(userQuery, "SUMMARIES", 5),
        ]);

        console.log(`[Memory Retrieval] Got ${chunkResults.length} chunks, ${summaryResults.length} summaries`);

        // ─── Process and filter results ────────────────────────────────────
        const seen = new Set<string>();
        const memoryChunks: MemoryChunk[] = [];

        // Process chunks first (higher-value raw data)
        for (const item of chunkResults) {
            const text = extractText(item);
            const normalized = text.toLowerCase();

            // Skip short, duplicate, or echo chunks
            if (text.length < MIN_CHUNK_LENGTH) continue;
            if (seen.has(normalized)) continue;
            if (USER_ECHO_PATTERN.test(text)) continue;

            seen.add(normalized);
            memoryChunks.push({
                text,
                score: typeof (item as any)?.feedback_weight === "number"
                    ? (item as any).feedback_weight : null,
                source: "chunk",
            });
        }

        // Process summaries (synthesized knowledge titles)
        for (const item of summaryResults) {
            const text = extractText(item);
            const normalized = text.toLowerCase();

            if (text.length < MIN_CHUNK_LENGTH) continue;
            if (seen.has(normalized)) continue;

            seen.add(normalized);
            memoryChunks.push({
                text,
                score: null,
                source: "summary",
            });
        }

        // ─── Inject memory context ─────────────────────────────────────────
        if (memoryChunks.length === 0) return {};

        const memoryLines = memoryChunks.map((c) => `- ${c.text}`);
        const textParts = ["## Relevant Memory from past interactions:", ...memoryLines];
        const contextText = `[MEMORY CONTEXT — relevant information from past interactions]\n${textParts.join("\n")}\n[END MEMORY CONTEXT]`;

        const memoryContextMsg = new HumanMessage({ content: contextText });

        console.log(`[Memory Retrieval] Injecting ${memoryChunks.length} memory items (after filtering)`);

        return {
            messages: [memoryContextMsg],
            memoryContextText: contextText,
            retrievedMemory: memoryChunks,
        };
    } catch (err) {
        // Top-level catch: never crash the graph due to memory failures
        console.warn("[Memory Retrieval] Unexpected error (skipping):", (err as Error).message);
        return {};
    }
}
