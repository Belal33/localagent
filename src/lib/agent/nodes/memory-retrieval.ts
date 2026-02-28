/**
 * src/lib/agent/nodes/memory-retrieval.ts
 *
 * Memory Retrieval Node — runs BEFORE the classifier.
 *
 * Enriches the agent's context with:
 *   1. Relevant episodic memories (pgvector cosine similarity search)
 *   2. Related knowledge graph facts (Neo4j entity queries)
 *
 * Injects results as a HumanMessage with a [MEMORY CONTEXT] wrapper so
 * the classifier and subsequent agent nodes can reason over past interactions.
 *
 * Graceful degradation: any failure (DB unavailable, Ollama down, etc.)
 * is caught silently — the node returns {} so the graph continues normally.
 */
import { HumanMessage } from "@langchain/core/messages";
import { retrieveEpisodicMemories } from "@/lib/memory/episodic";
import { queryEntity, searchEntities } from "@/lib/memory/knowledge-graph";

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



        // Structured data for client display
        const episodicItems: Array<{ date: string; summary: string; relevance: number | null }> = [];
        const knowledgeItems: Array<{ subject: string; subjectType: string; predicate: string; object: string; objectType: string }> = [];

        // ─── 1. Episodic Memory: semantic similarity via pgvector ─────────────
        try {
            const episodic = await retrieveEpisodicMemories(USER_ID, userQuery, 3);
            if (episodic.length > 0) {

                for (const mem of episodic) {
                    const date = mem.createdAt.toLocaleDateString();
                    const rel = mem.similarity != null
                        ? ` (relevance: ${(mem.similarity * 100).toFixed(0)}%)`
                        : "";

                    episodicItems.push({
                        date,
                        summary: mem.summary,
                        relevance: mem.similarity != null ? Math.round(mem.similarity * 100) : null,
                    });
                }
            }
        } catch (err) {
            console.warn("[Memory Retrieval] Episodic store unavailable:", (err as Error).message);
        }

        // ─── 2. Semantic Memory: entity facts via Neo4j ───────────────────────
        try {
            const entities = await searchEntities(userQuery, 5);

            for (const entity of entities.slice(0, 3)) {
                const facts = await queryEntity(entity.name, 1);
                for (const fact of facts) {
                    knowledgeItems.push({
                        subject: fact.subject,
                        subjectType: fact.subjectType,
                        predicate: fact.predicate,
                        object: fact.object,
                        objectType: fact.objectType,
                    });
                }
            }

        } catch (err) {
            console.warn("[Memory Retrieval] Knowledge graph unavailable:", (err as Error).message);
        }

        // ─── 3. Inject memory context ─────────────────────────────────────────
        if (episodicItems.length === 0 && knowledgeItems.length === 0) return {};

        // Build the text for the LLM
        const textParts: string[] = [];
        if (episodicItems.length > 0) {
            textParts.push("## Past Conversations");
            for (const e of episodicItems) {
                const rel = e.relevance != null ? ` (relevance: ${e.relevance}%)` : "";
                textParts.push(`- [${e.date}] ${e.summary}${rel}`);
            }
        }
        if (knowledgeItems.length > 0) {
            textParts.push("\n## Known Facts");
            for (const f of knowledgeItems) {
                textParts.push(`- ${f.subject} (${f.subjectType}) —[${f.predicate}]→ ${f.object} (${f.objectType})`);
            }
        }

        const memoryContext = new HumanMessage({
            content: `[MEMORY CONTEXT — relevant information from past interactions]\n${textParts.join("\n")}\n[END MEMORY CONTEXT]`,
        });


        return {
            messages: [memoryContext],
            retrievedMemory: { episodic: episodicItems, knowledge: knowledgeItems },
        };
    } catch (err) {
        // Top-level catch: never crash the graph due to memory failures
        console.warn("[Memory Retrieval] Unexpected error (skipping):", (err as Error).message);
        return {};
    }
}
