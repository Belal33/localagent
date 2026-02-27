/**
 * src/lib/memory/embeddings.ts
 *
 * Generates vector embeddings using mxbai-embed-large:latest via local Ollama.
 * The model produces 1024-dimensional vectors, matching the pgvector column
 * dimension defined in infra/init.sql.
 */
import { OllamaEmbeddings } from "@langchain/ollama";

const OLLAMA_BASE_URL =
    process.env.AGENT_OLLAMA_URL ?? "http://localhost:11434";

const EMBEDDING_MODEL =
    process.env.AGENT_EMBEDDING_MODEL ?? "mxbai-embed-large:latest";

// Singleton embeddings instance
let _embeddings: OllamaEmbeddings | null = null;

function getEmbeddings(): OllamaEmbeddings {
    if (!_embeddings) {
        _embeddings = new OllamaEmbeddings({
            model: EMBEDDING_MODEL,
            baseUrl: OLLAMA_BASE_URL,
        });
    }
    return _embeddings;
}

/**
 * Generate a single embedding vector for the given text.
 *
 * @param text - The text to embed
 * @returns A 1024-dimensional float array
 * @throws Error if Ollama is unavailable
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    return getEmbeddings().embedQuery(text);
}

/**
 * Generate embeddings for multiple texts in a single batch call.
 *
 * @param texts - Array of texts to embed
 * @returns Array of 1024-dimensional float arrays
 * @throws Error if Ollama is unavailable
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
    return getEmbeddings().embedDocuments(texts);
}
