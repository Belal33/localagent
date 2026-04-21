/**
 * src/lib/agent/nodes/memory-retrieval.ts
 *
 * Memory Retrieval Node — runs BEFORE the classifier.
 *
 * Enriches the agent's context from TWO sources:
 *   1. KNOWLEDGE — Cognee CHUNKS search (semantic facts about the user)
 *   2. EPISODIC  — Postgres+pgvector search (past conversation summaries)
 *
 * Both are injected as a HumanMessage and sent to the UI for display.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { searchEpisodes, type EpisodeResult } from "@/lib/memory/episodes";

const COGNEE_BASE_URL = process.env.COGNEE_URL || "http://cognee:8000";

const MIN_CHUNK_LENGTH = 10;
const USER_ECHO_PATTERN = /^(User|Assistant|Human|AI):\s/i;

export interface MemoryChunk {
    text: string;
    score: number | null;
    source: "chunk" | "summary";
}

export interface EpisodicMemory {
    date: string;
    summary: string;
}

/** Run a single Cognee search */
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

/** Extract text from a Cognee result */
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

        // ─── Parallel: Cognee facts + Postgres episodes ─────────────────
        const [chunkResults, summaryResults, episodeResults] = await Promise.all([
            cogneeSearch(userQuery, "CHUNKS", 5),
            cogneeSearch(userQuery, "SUMMARIES", 3),
            searchEpisodes(userQuery, "default", undefined, 3).catch((err) => {
                console.warn("[Memory Retrieval] Episode search failed:", (err as Error).message);
                return [] as EpisodeResult[];
            }),
        ]);

        console.log(`[Memory Retrieval] Got ${chunkResults.length} chunks, ${summaryResults.length} summaries, ${episodeResults.length} episodes`);

        // ─── Process Cognee results (facts) ─────────────────────────────
        const seen = new Set<string>();
        const knowledgeItems: MemoryChunk[] = [];

        for (const item of [...chunkResults, ...summaryResults]) {
            const text = extractText(item);
            const normalized = text.toLowerCase();

            if (text.length < MIN_CHUNK_LENGTH) continue;
            if (seen.has(normalized)) continue;
            if (USER_ECHO_PATTERN.test(text)) continue;

            // Skip episodic entries that may linger in Cognee from old data
            if (/^\[\d{4}-\d{2}-\d{2}T/.test(text)) continue;

            seen.add(normalized);
            knowledgeItems.push({
                text,
                score: typeof (item as any)?.feedback_weight === "number"
                    ? (item as any).feedback_weight : null,
                source: chunkResults.includes(item) ? "chunk" : "summary",
            });
        }

        // ─── Process Postgres episodes ──────────────────────────────────
        const episodicItems: EpisodicMemory[] = episodeResults
            .filter((e) => e.similarity > 0.4) // Only reasonably relevant episodes
            .slice(0, 3) // Limit to avoid overwhelming the model
            .map((e) => ({
                date: e.date,
                summary: e.summary,
            }));

        // ─── Build injected context ─────────────────────────────────────
        // Cap items to keep context compact for the LLM
        const cappedKnowledge = knowledgeItems.slice(0, 5);
        const cappedEpisodes = episodicItems.slice(0, 3);

        if (cappedKnowledge.length === 0 && cappedEpisodes.length === 0) return {};

        const contextParts: string[] = ["[MEMORY CONTEXT — relevant information from past interactions]"];

        if (cappedKnowledge.length > 0) {
            contextParts.push("## Known facts about the user:");
            for (const k of cappedKnowledge) {
                contextParts.push(`- ${k.text}`);
            }
        }

        if (cappedEpisodes.length > 0) {
            contextParts.push("## Recent past conversations:");
            for (const e of cappedEpisodes) {
                contextParts.push(`- [${e.date}] ${e.summary}`);
            }
        }

        contextParts.push("[END MEMORY CONTEXT]");
        const contextText = contextParts.join("\n");

        console.log(`[Memory Retrieval] Injecting ${cappedKnowledge.length} facts + ${cappedEpisodes.length} episodes`);

        // NOTE: we DO NOT push a SystemMessage into `messages` here.
        // `callModel` reads `memoryContextText` from state and merges it into
        // its own system prompt. Adding it to `messages` caused reducer-order
        // bugs where the memory SystemMessage landed AFTER the AI response,
        // making `afterAgent` route based on the wrong last-message type.
        return {
            memoryContextText: contextText,
            retrievedMemory: cappedKnowledge,
            retrievedEpisodes: cappedEpisodes,
        };
    } catch (err) {
        console.warn("[Memory Retrieval] Unexpected error (skipping):", (err as Error).message);
        return {};
    }
}
