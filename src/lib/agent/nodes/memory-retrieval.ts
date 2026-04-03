/**
 * src/lib/agent/nodes/memory-retrieval.ts
 *
 * Memory Retrieval Node — runs BEFORE the classifier.
 *
 * Enriches the agent's context by querying the Cognee Memory Engine.
 * Retrieves TWO types of memory:
 *   1. KNOWLEDGE — factual memory from `memory_*` dataset (user preferences, facts)
 *   2. EPISODIC  — past conversation summaries from `episodes_*` dataset
 *
 * Both are injected into the agent's context and sent to the UI for display.
 */
import { HumanMessage } from "@langchain/core/messages";

const COGNEE_BASE_URL = process.env.COGNEE_URL || "http://cognee:8000";

const MIN_CHUNK_LENGTH = 10;
const USER_ECHO_PATTERN = /^(User|Assistant|Human|AI):\s/i;

/** Pattern to detect episodic entries: [ISO timestamp] summary */
const EPISODE_PATTERN = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]\s*(.+)$/;

export interface MemoryChunk {
    text: string;
    score: number | null;
    source: "chunk" | "summary" | "episode";
}

export interface EpisodicMemory {
    date: string;
    summary: string;
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

/** Format ISO date to human-readable */
function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
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

        // ─── Dual Search: CHUNKS (facts + episodes mixed) + SUMMARIES ────
        // Cognee returns results from ALL datasets in one search, so a single
        // CHUNKS call with higher top_k covers both facts and episode chunks.
        const [chunkResults, summaryResults] = await Promise.all([
            cogneeSearch(userQuery, "CHUNKS", 15),
            cogneeSearch(userQuery, "SUMMARIES", 5),
        ]);

        console.log(`[Memory Retrieval] Got ${chunkResults.length} chunks, ${summaryResults.length} summaries`);

        // ─── Process results ──────────────────────────────────────────────
        const seen = new Set<string>();
        const knowledgeItems: MemoryChunk[] = [];
        const episodicItems: EpisodicMemory[] = [];

        // Helper: process a set of items, auto-detecting episodes by timestamp pattern
        function processItems(items: unknown[], defaultSource: "chunk" | "summary") {
            for (const item of items) {
                const text = extractText(item);
                const normalized = text.toLowerCase();

                if (text.length < MIN_CHUNK_LENGTH) continue;
                if (seen.has(normalized)) continue;
                if (USER_ECHO_PATTERN.test(text)) continue;

                seen.add(normalized);

                // Check if this is an episodic entry: [timestamp] summary
                const episodeMatch = text.match(EPISODE_PATTERN);
                if (episodeMatch) {
                    episodicItems.push({
                        date: formatDate(episodeMatch[1]),
                        summary: episodeMatch[2].trim(),
                    });
                } else {
                    knowledgeItems.push({
                        text,
                        score: typeof (item as any)?.feedback_weight === "number"
                            ? (item as any).feedback_weight : null,
                        source: defaultSource,
                    });
                }
            }
        }

        processItems(chunkResults, "chunk");
        processItems(summaryResults, "summary");

        // ─── Build injected context ─────────────────────────────────────────
        if (knowledgeItems.length === 0 && episodicItems.length === 0) return {};

        const contextParts: string[] = ["[MEMORY CONTEXT — relevant information from past interactions]"];

        if (knowledgeItems.length > 0) {
            contextParts.push("## Known facts about the user:");
            for (const k of knowledgeItems) {
                contextParts.push(`- ${k.text}`);
            }
        }

        if (episodicItems.length > 0) {
            contextParts.push("## Recent past conversations:");
            for (const e of episodicItems) {
                contextParts.push(`- [${e.date}] ${e.summary}`);
            }
        }

        contextParts.push("[END MEMORY CONTEXT]");
        const contextText = contextParts.join("\n");

        const memoryContextMsg = new HumanMessage({ content: contextText });

        console.log(`[Memory Retrieval] Injecting ${knowledgeItems.length} facts + ${episodicItems.length} episodes`);

        return {
            messages: [memoryContextMsg],
            memoryContextText: contextText,
            retrievedMemory: knowledgeItems,
            retrievedEpisodes: episodicItems,
        };
    } catch (err) {
        console.warn("[Memory Retrieval] Unexpected error (skipping):", (err as Error).message);
        return {};
    }
}
