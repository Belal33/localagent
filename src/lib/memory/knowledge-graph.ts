/**
 * src/lib/memory/knowledge-graph.ts
 *
 * Semantic memory store backed by Neo4j.
 * Stores and queries entity-relationship triples (Subject → Predicate → Object).
 *
 * Phase 4.1: Entities carry embedding vectors (1024-dim via mxbai-embed-large)
 *            enabling semantic similarity search via Neo4j vector index.
 */
import neo4j, { type Session } from "neo4j-driver";
import { getNeo4jDriver } from "./db";
import { generateEmbedding } from "./embeddings";

export interface KnowledgeTriple {
    subject: string;
    subjectType: string; // e.g., "Person", "Project", "Tool", "Concept"
    predicate: string;   // e.g., "USES", "PREFERS", "WORKS_ON", "KNOWS"
    object: string;
    objectType: string;
    confidence: number;  // 0.0–1.0
    source: string;      // thread_id where this was extracted
}

// ─── Vector Index ────────────────────────────────────────────────────────────

const VECTOR_INDEX_NAME = "entity_embedding";
const VECTOR_DIMENSIONS = 1024; // mxbai-embed-large output
const SIMILARITY_FN = "cosine";

let _indexEnsured = false;

/**
 * Ensures the vector index exists on Entity.embedding.
 * Idempotent — safe to call multiple times (uses IF NOT EXISTS).
 */
export async function ensureVectorIndex(): Promise<void> {
    if (_indexEnsured) return;
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
        await session.run(
            `CREATE VECTOR INDEX ${VECTOR_INDEX_NAME} IF NOT EXISTS
             FOR (e:Entity) ON (e.embedding)
             OPTIONS {
               indexConfig: {
                 \`vector.dimensions\`: $dimensions,
                 \`vector.similarity_function\`: $similarity
               }
             }`,
            {
                dimensions: neo4j.int(VECTOR_DIMENSIONS),
                similarity: SIMILARITY_FN,
            },
        );
        _indexEnsured = true;
        console.log(`[Neo4j] Vector index '${VECTOR_INDEX_NAME}' ensured (${VECTOR_DIMENSIONS}d, ${SIMILARITY_FN})`);
    } catch (err) {
        console.warn("[Neo4j] Failed to create vector index:", (err as Error).message);
    } finally {
        await session.close();
    }
}

// ─── Entity Embedding ────────────────────────────────────────────────────────

/**
 * Generates a descriptive text for embedding an entity.
 * Combines name + type for richer semantic representation.
 */
function entityEmbedText(name: string, type: string): string {
    return `${name} (${type})`;
}

/**
 * Sets the embedding vector on an existing Entity node.
 * Silently fails if Ollama is unavailable (graceful degradation).
 */
async function setEntityEmbedding(
    session: Session,
    name: string,
    type: string,
): Promise<void> {
    try {
        const embedding = await generateEmbedding(entityEmbedText(name, type));
        await session.run(
            `MATCH (e:Entity {name: $name, type: $type})
             SET e.embedding = $embedding`,
            { name, type, embedding },
        );
    } catch (err) {
        console.warn(`[Neo4j] Embedding failed for entity "${name}":`, (err as Error).message);
    }
}

// ─── CRUD Operations ─────────────────────────────────────────────────────────

/**
 * Upsert a knowledge triple into Neo4j.
 * Uses MERGE to avoid duplicate nodes/relationships; updates metadata on match.
 * Also generates and stores embeddings for both subject and object entities.
 */
export async function upsertTriple(triple: KnowledgeTriple): Promise<void> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
        await session.run(
            `MERGE (s:Entity {name: $subject, type: $subjectType})
             MERGE (o:Entity {name: $object,  type: $objectType})
             MERGE (s)-[r:RELATES {predicate: $predicate}]->(o)
             SET r.confidence = $confidence,
                 r.source     = $source,
                 r.updatedAt  = datetime()`,
            {
                subject: triple.subject,
                subjectType: triple.subjectType,
                object: triple.object,
                objectType: triple.objectType,
                predicate: triple.predicate,
                confidence: triple.confidence,
                source: triple.source,
            },
        );

        // Generate embeddings for both entities (in parallel)
        await Promise.all([
            setEntityEmbedding(session, triple.subject, triple.subjectType),
            setEntityEmbedding(session, triple.object, triple.objectType),
        ]);
    } finally {
        await session.close();
    }
}

/**
 * Query the knowledge graph for all facts about a named entity.
 * Traverses up to `maxHops` relationship hops from the entity.
 */
export async function queryEntity(
    entityName: string,
    maxHops: number = 2,
): Promise<KnowledgeTriple[]> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
        const result = await session.run(
            `MATCH (s:Entity {name: $name})-[r:RELATES*1..${maxHops}]->(o:Entity)
             RETURN s.name         AS subject,
                    s.type         AS subjectType,
                    [rel IN r | rel.predicate]  AS predicates,
                    o.name         AS object,
                    o.type         AS objectType,
                    [rel IN r | rel.confidence] AS confidences,
                    [rel IN r | rel.source]     AS sources`,
            { name: entityName },
        );

        return result.records.map((record) => ({
            subject: record.get("subject"),
            subjectType: record.get("subjectType"),
            predicate: (record.get("predicates") as string[]).join(" → "),
            object: record.get("object"),
            objectType: record.get("objectType"),
            confidence: Math.min(
                ...(record.get("confidences") as (number | string)[]).map(Number),
            ),
            source: (record.get("sources") as string[])[0],
        }));
    } finally {
        await session.close();
    }
}

/**
 * Search entities by semantic similarity using Neo4j vector index.
 * Falls back to case-insensitive string matching if the vector index
 * is not available or Ollama is down.
 */
export async function searchEntities(
    query: string,
    limit: number = 10,
): Promise<{ name: string; type: string; connections: number; score?: number }[]> {
    const driver = getNeo4jDriver();

    // ─── Try vector similarity search first ──────────────────────────────────
    try {
        // Truncate long queries to stay within embedding model context length
        const truncatedQuery = query.length > 500 ? query.slice(0, 500) : query;
        const queryEmbedding = await generateEmbedding(truncatedQuery);
        const session = driver.session();
        try {
            const result = await session.run(
                `CALL db.index.vector.queryNodes($indexName, $limit, $embedding)
                 YIELD node, score
                 OPTIONAL MATCH (node)-[r:RELATES]-()
                 RETURN node.name AS name, node.type AS type, count(r) AS connections, score
                 ORDER BY score DESC`,
                {
                    indexName: VECTOR_INDEX_NAME,
                    limit: neo4j.int(limit),
                    embedding: queryEmbedding,
                },
            );

            const results = result.records.map((record) => ({
                name: record.get("name"),
                type: record.get("type"),
                connections: (record.get("connections") as { toNumber: () => number }).toNumber(),
                score: record.get("score") as number,
            }));

            // Filter out very low relevance results (below 0.3 similarity)
            const filtered = results.filter((r) => r.score > 0.3);
            if (filtered.length > 0) {
                console.log(`[Neo4j] Vector search for "${query}" → ${filtered.length} results (top: ${filtered[0]?.name} @ ${filtered[0]?.score.toFixed(2)})`);
                return filtered;
            }
        } finally {
            await session.close();
        }
    } catch (err) {
        console.warn("[Neo4j] Vector search failed, falling back to text search:", (err as Error).message);
    }

    // ─── Fallback: string matching ───────────────────────────────────────────
    const session = driver.session();
    try {
        const result = await session.run(
            `MATCH (e:Entity)
             WHERE toLower($query) CONTAINS toLower(e.name)
             OPTIONAL MATCH (e)-[r:RELATES]-()
             RETURN e.name AS name, e.type AS type, count(r) AS connections
             ORDER BY connections DESC
             LIMIT $limit`,
            { query, limit: neo4j.int(limit) },
        );

        return result.records.map((record) => ({
            name: record.get("name"),
            type: record.get("type"),
            connections: (record.get("connections") as { toNumber: () => number }).toNumber(),
        }));
    } finally {
        await session.close();
    }
}
