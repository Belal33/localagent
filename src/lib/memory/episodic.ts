/**
 * src/lib/memory/episodic.ts
 *
 * Episodic memory store backed by PostgreSQL + pgvector.
 * Stores conversation summaries as vector embeddings and retrieves them
 * via cosine similarity search (GraphRAG retrieval).
 */
import { Pool } from "pg";
import { generateEmbedding } from "./embeddings";

const pool = new Pool({
    connectionString:
        process.env.AGENT_PG_URI ??
        "postgresql://agent:agent_local_dev@postgres:5432/agent_memory",
});

export interface EpisodicMemory {
    id: string;
    userId: string;
    threadId: string;
    summary: string;
    createdAt: Date;
    metadata: Record<string, unknown>;
    similarity?: number;
}

/**
 * Store a conversation summary as an episodic memory.
 * Embeds the summary and inserts it into the episodic_memories table.
 */
export async function storeEpisodicMemory(
    userId: string,
    threadId: string,
    summary: string,
    metadata?: Record<string, unknown>,
): Promise<void> {
    const embedding = await generateEmbedding(summary);
    const vecStr = `[${embedding.join(",")}]`;

    await pool.query(
        `INSERT INTO episodic_memories (user_id, thread_id, summary, embedding, metadata)
         VALUES ($1, $2, $3, $4::vector, $5)`,
        [userId, threadId, summary, vecStr, JSON.stringify(metadata ?? {})],
    );
}

/**
 * Retrieve the most semantically relevant past memories for a user given a query.
 * Uses pgvector cosine distance (<=>).
 *
 * @param userId  - The user whose memories to search
 * @param query   - The current user query to find relevant memories for
 * @param limit   - Maximum number of memories to return (default: 5)
 */
export async function retrieveEpisodicMemories(
    userId: string,
    query: string,
    limit: number = 5,
): Promise<EpisodicMemory[]> {
    // Truncate long queries to stay within embedding model context length
    const truncatedQuery = query.length > 500 ? query.slice(0, 500) : query;
    const queryEmbedding = await generateEmbedding(truncatedQuery);
    const vecStr = `[${queryEmbedding.join(",")}]`;

    const result = await pool.query(
        `SELECT id, user_id, thread_id, summary, created_at, metadata,
                1 - (embedding <=> $1::vector) AS similarity
         FROM episodic_memories
         WHERE user_id = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [vecStr, userId, limit],
    );

    return result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        threadId: row.thread_id,
        summary: row.summary,
        createdAt: new Date(row.created_at),
        metadata: row.metadata ?? {},
        similarity: typeof row.similarity === "number" ? row.similarity : parseFloat(row.similarity),
    }));
}
