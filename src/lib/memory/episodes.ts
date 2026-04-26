/**
 * src/lib/memory/episodes.ts
 *
 * Episodic Memory: Postgres + pgvector for conversation summaries.
 *
 * Each conversation thread gets ONE episode that evolves over time.
 * The episode stores:
 *   - summary: LLM-generated conversation summary
 *   - embedding: 1024-dim vector from mxbai-embed-large (Ollama)
 *   - metadata: turn count, last updated, etc.
 *
 * Operations:
 *   - upsertEpisode: create or update an episode for a thread
 *   - searchEpisodes: find relevant past episodes via cosine similarity
 */
import pg from "pg";
import { localizeDockerServiceUri, localizeHostServiceUrl } from "@/lib/local-runtime";

const PG_URI =
    localizeDockerServiceUri(process.env.AGENT_PG_URI ??
        "postgresql://agent:agent_local_dev@postgres:5432/agent_memory");

const OLLAMA_EMBED_URL =
    localizeHostServiceUrl(process.env.OLLAMA_EMBED_URL ?? "http://host.docker.internal:11434/api/embed");
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "mxbai-embed-large:latest";

// ─── Pool (singleton) ───────────────────────────────────────────────────────
let _pool: pg.Pool | null = null;

function getPool(): pg.Pool {
    if (!_pool) {
        _pool = new pg.Pool({ connectionString: PG_URI, max: 3 });
    }
    return _pool;
}

// ─── Embedding ──────────────────────────────────────────────────────────────

/**
 * Generate a 1024-dim embedding via Ollama (same model Cognee uses).
 */
async function embed(text: string): Promise<number[]> {
    const res = await fetch(OLLAMA_EMBED_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    });

    if (!res.ok) {
        throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    // Ollama returns { embeddings: [[...]] } for single input
    const embeddings = data.embeddings || data.embedding;
    if (Array.isArray(embeddings) && Array.isArray(embeddings[0])) {
        return embeddings[0];
    }
    if (Array.isArray(embeddings)) {
        return embeddings;
    }
    throw new Error("Unexpected Ollama embedding response shape");
}

// ─── Upsert ─────────────────────────────────────────────────────────────────

export interface EpisodeInput {
    threadId: string;
    userId: string;
    summary: string;
    metadata?: Record<string, unknown>;
}

/**
 * Create or update an episode for a conversation thread.
 * If an episode for this threadId already exists, it updates the summary + embedding.
 */
export async function upsertEpisode(input: EpisodeInput): Promise<void> {
    const { threadId, userId, summary, metadata = {} } = input;

    const embedding = await embed(summary);
    const embeddingStr = `[${embedding.join(",")}]`;

    const pool = getPool();
    await pool.query(
        `INSERT INTO episodic_memories (thread_id, user_id, summary, embedding, metadata, created_at)
         VALUES ($1, $2, $3, $4::vector, $5, NOW())
         ON CONFLICT (thread_id) DO UPDATE SET
             summary = EXCLUDED.summary,
             embedding = EXCLUDED.embedding,
             metadata = EXCLUDED.metadata,
             created_at = NOW()`,
        [threadId, userId, summary, embeddingStr, JSON.stringify(metadata)],
    );
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface EpisodeResult {
    threadId: string;
    summary: string;
    date: string;
    similarity: number;
}

/**
 * Search for relevant past episodes using cosine similarity.
 * Returns the top-k most similar episodes (excluding the current thread).
 */
export async function searchEpisodes(
    query: string,
    userId: string,
    excludeThreadId?: string,
    topK = 5,
): Promise<EpisodeResult[]> {
    const queryEmbedding = await embed(query);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    const pool = getPool();
    const result = await pool.query(
        `SELECT thread_id, summary, created_at,
                1 - (embedding <=> $1::vector) AS similarity
         FROM episodic_memories
         WHERE user_id = $2
           AND ($3::text IS NULL OR thread_id != $3)
         ORDER BY embedding <=> $1::vector
         LIMIT $4`,
        [embeddingStr, userId, excludeThreadId || null, topK],
    );

    return result.rows.map((row) => ({
        threadId: row.thread_id,
        summary: row.summary,
        date: formatDate(row.created_at),
        similarity: parseFloat(row.similarity),
    }));
}

/**
 * Get most recent episodes chronologically (no semantic search).
 */
export async function getRecentEpisodes(
    userId: string,
    excludeThreadId?: string,
    limit = 5,
): Promise<EpisodeResult[]> {
    const pool = getPool();
    const result = await pool.query(
        `SELECT thread_id, summary, created_at
         FROM episodic_memories
         WHERE user_id = $1
           AND ($2::text IS NULL OR thread_id != $2)
         ORDER BY created_at DESC
         LIMIT $3`,
        [userId, excludeThreadId || null, limit],
    );

    return result.rows.map((row) => ({
        threadId: row.thread_id,
        summary: row.summary,
        date: formatDate(row.created_at),
        similarity: 1,
    }));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(d: Date | string): string {
    try {
        const date = typeof d === "string" ? new Date(d) : d;
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return String(d);
    }
}
