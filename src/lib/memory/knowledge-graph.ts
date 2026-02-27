/**
 * src/lib/memory/knowledge-graph.ts
 *
 * Semantic memory store backed by Neo4j.
 * Stores and queries entity-relationship triples (Subject → Predicate → Object).
 */
import neo4j from "neo4j-driver";
import { getNeo4jDriver } from "./db";

export interface KnowledgeTriple {
    subject: string;
    subjectType: string; // e.g., "Person", "Project", "Tool", "Concept"
    predicate: string;   // e.g., "USES", "PREFERS", "WORKS_ON", "KNOWS"
    object: string;
    objectType: string;
    confidence: number;  // 0.0–1.0
    source: string;      // thread_id where this was extracted
}

/**
 * Upsert a knowledge triple into Neo4j.
 * Uses MERGE to avoid duplicate nodes/relationships; updates metadata on match.
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
 * Search entities by fuzzy name match (case-insensitive CONTAINS).
 * Returns entities sorted by number of relationships (most connected first).
 */
export async function searchEntities(
    query: string,
    limit: number = 10,
): Promise<{ name: string; type: string; connections: number }[]> {
    const driver = getNeo4jDriver();
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
