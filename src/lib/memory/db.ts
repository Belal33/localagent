/**
 * src/lib/memory/db.ts
 *
 * Singleton factory functions for all memory infrastructure connections:
 *   - PostgresSaver  → LangGraph cross-restart session checkpointing
 *   - PostgresStore  → LangGraph cross-thread key-value store
 *   - Neo4j Driver   → Semantic knowledge graph
 */
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import neo4j, { type Driver } from "neo4j-driver";

// ─── Configuration (env vars with local dev defaults) ────────────────────────
const PG_URI =
    process.env.AGENT_PG_URI ??
    "postgresql://agent:agent_local_dev@postgres:5432/agent_memory";

const NEO4J_URI = process.env.AGENT_NEO4J_URI ?? "bolt://neo4j:7687";
const NEO4J_USER = process.env.AGENT_NEO4J_USER ?? "neo4j";
const NEO4J_PASS = process.env.AGENT_NEO4J_PASS ?? "agent_local_dev";

// ─── Singletons ──────────────────────────────────────────────────────────────
let _checkpointer: PostgresSaver | null = null;
let _neo4jDriver: Driver | null = null;

/**
 * Returns a ready-to-use PostgresSaver (LangGraph checkpointer).
 * Calls .setup() on first use to create required tables.
 */
export async function getCheckpointer(): Promise<PostgresSaver> {
    if (!_checkpointer) {
        _checkpointer = PostgresSaver.fromConnString(PG_URI);
        await _checkpointer.setup();
    }
    return _checkpointer;
}

/**
 * Returns a singleton Neo4j driver instance.
 * Connection is lazy — it only actually connects on first query.
 * Also ensures the vector index exists on first init.
 */
export function getNeo4jDriver(): Driver {
    if (!_neo4jDriver) {
        _neo4jDriver = neo4j.driver(
            NEO4J_URI,
            neo4j.auth.basic(NEO4J_USER, NEO4J_PASS),
        );
        // Fire-and-forget: ensure vector index exists
        import("./knowledge-graph").then((kg) => kg.ensureVectorIndex()).catch(() => { });
    }
    return _neo4jDriver;
}

/**
 * Closes all open connections. Useful for teardown in tests.
 */
export async function closeAll(): Promise<void> {
    if (_neo4jDriver) {
        await _neo4jDriver.close();
        _neo4jDriver = null;
    }
    _checkpointer = null;
}
