# Phase 4: Hybrid Memory — Detailed Implementation Plan

This phase transforms the agent from a stateless-across-sessions system (MemorySaver = in-memory only) into one with **persistent, cross-session memory** using a dual-store architecture:

- **PostgreSQL + pgvector** → Episodic Memory (what happened in past conversations)
- **Neo4j** → Semantic Memory (entity-relationship knowledge graph)

Together they enable **GraphRAG**: the agent can recall past interactions, reason about entities, and deliver personalized, context-rich responses.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      MEMORY-AUGMENTED AGENT                        │
│                                                                    │
│  ┌──────────────┐    ┌──────────────────────────────────────────┐  │
│  │  LangGraph   │    │         MEMORY SUBSYSTEM                 │  │
│  │  StateGraph   │◄──►│                                         │  │
│  │              │    │  ┌─────────────┐   ┌─────────────────┐  │  │
│  │  (existing   │    │  │  PostgreSQL  │   │     Neo4j       │  │  │
│  │   graph.ts)  │    │  │  + pgvector  │   │  Knowledge      │  │  │
│  │              │    │  │             │   │  Graph           │  │  │
│  │              │    │  │  Episodic   │   │                  │  │  │
│  │              │    │  │  Memory     │   │  Semantic        │  │  │
│  │              │    │  │  Store      │   │  Memory          │  │  │
│  └──────────────┘    │  └──────┬──────┘   └────────┬────────┘  │  │
│                      │         │                   │            │  │
│                      │  ┌──────▼───────────────────▼────────┐  │  │
│                      │  │      Memory Distiller             │  │  │
│                      │  │  (Background LLM extraction)      │  │  │
│                      │  └───────────────────────────────────┘  │  │
│                      └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Infrastructure — Docker Services

### 1.1 PostgreSQL + pgvector

Deploy via Docker Compose. This single Postgres instance serves **two purposes**:

1. **LangGraph Checkpointer** (`PostgresSaver`) — replaces `MemorySaver` for durable, cross-restart session persistence.
2. **Cross-Thread Memory Store** (`PostgresStore`) — stores embedded conversation summaries searchable via pgvector semantic similarity.

```yaml
# docker-compose.yml (new file in project root)
version: "3.8"
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: agent_postgres
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: agent
      POSTGRES_PASSWORD: agent_local_dev
      POSTGRES_DB: agent_memory
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./infra/init.sql:/docker-entrypoint-initdb.d/init.sql

  neo4j:
    image: neo4j:5-community
    container_name: agent_neo4j
    restart: unless-stopped
    ports:
      - "7474:7474"   # Browser UI
      - "7687:7687"   # Bolt protocol
    environment:
      NEO4J_AUTH: neo4j/agent_local_dev
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - neo4jdata:/data

volumes:
  pgdata:
  neo4jdata:
```

### 1.2 Database Initialization Script

```sql
-- infra/init.sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Episodic memory: conversation summaries with vector embeddings
CREATE TABLE IF NOT EXISTS episodic_memories (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT NOT NULL DEFAULT 'default',
    thread_id     TEXT NOT NULL,
    summary       TEXT NOT NULL,
    embedding     vector(768),  -- Dimension matches the embedding model
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    metadata      JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_episodic_embedding
    ON episodic_memories USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_episodic_user
    ON episodic_memories (user_id);
```

> **Note:** The `PostgresSaver` and `PostgresStore` from `@langchain/langgraph-checkpoint-postgres` auto-create their own tables via `.setup()`. The `episodic_memories` table above is for our custom Memory Distiller output.

---

## Step 2: Persistent Checkpointer (Replace MemorySaver)

### 2.1 New Dependencies

```bash
npm install @langchain/langgraph-checkpoint-postgres pg neo4j-driver uuid
npm install -D @types/pg @types/uuid
```

### 2.2 Database Connection Module

```
[NEW] src/lib/memory/db.ts
```

Centralizes all database connections:

```typescript
// src/lib/memory/db.ts
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import neo4j, { Driver } from "neo4j-driver";

// ─── Configuration ──────────────────────────────────────────────────────────
const PG_URI = process.env.AGENT_PG_URI
    ?? "postgresql://agent:agent_local_dev@localhost:5432/agent_memory";
const NEO4J_URI = process.env.AGENT_NEO4J_URI ?? "bolt://localhost:7687";
const NEO4J_USER = process.env.AGENT_NEO4J_USER ?? "neo4j";
const NEO4J_PASS = process.env.AGENT_NEO4J_PASS ?? "agent_local_dev";

// ─── Singletons ─────────────────────────────────────────────────────────────
let _checkpointer: PostgresSaver | null = null;
let _store: PostgresStore | null = null;
let _neo4jDriver: Driver | null = null;
let _initialized = false;

export async function getCheckpointer(): Promise<PostgresSaver> {
    if (!_checkpointer) {
        _checkpointer = PostgresSaver.fromConnString(PG_URI);
        await _checkpointer.setup();
    }
    return _checkpointer;
}

export async function getStore(): Promise<PostgresStore> {
    if (!_store) {
        _store = PostgresStore.fromConnString(PG_URI);
        await _store.setup();
    }
    return _store;
}

export function getNeo4jDriver(): Driver {
    if (!_neo4jDriver) {
        _neo4jDriver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
    }
    return _neo4jDriver;
}

export async function closeAll(): Promise<void> {
    if (_neo4jDriver) await _neo4jDriver.close();
    _neo4jDriver = null;
    _checkpointer = null;
    _store = null;
}
```

### 2.3 Update graph.ts — Swap MemorySaver → PostgresSaver

**Current:**
```typescript
const checkpointer = new MemorySaver();
export const agentGraph = workflow.compile({ checkpointer });
```

**New — Lazy async initialization:**
```typescript
// graph.ts (modified section)
import { getCheckpointer, getStore } from "@/lib/memory/db";

let _compiledGraph: ReturnType<typeof workflow.compile> | null = null;

export async function getAgentGraph() {
    if (!_compiledGraph) {
        const checkpointer = await getCheckpointer();
        const store = await getStore();
        _compiledGraph = workflow.compile({ checkpointer, store });
    }
    return _compiledGraph;
}
```

> **Breaking change:** `agentGraph` switches from a sync export to an async `getAgentGraph()`. The API route (`route.ts`) and resume route (`resume/route.ts`) must be updated to `await getAgentGraph()` instead of importing `agentGraph` directly.

### 2.4 Update API Routes

**Files to modify:**
- `src/app/api/chat/route.ts` — `import { agentGraph }` → `const graph = await getAgentGraph()`
- `src/app/api/chat/resume/route.ts` — same change

---

## Step 3: Episodic Memory — Vector Store (pgvector)

### 3.1 Embedding Service

```
[NEW] src/lib/memory/embeddings.ts
```

Uses the existing Anthropic proxy (port 8080) or a lightweight embedding model. Since the proxy exposes Gemini models via Anthropic-compatible API, we'll use `@langchain/core` embeddings with a configurable provider:

```typescript
// src/lib/memory/embeddings.ts
import { ChatAnthropic } from "@langchain/anthropic";

const EMBEDDING_MODEL = "gemini-embedding-exp-03-07";  // or text-embedding-3-small
const ANTHROPIC_PROXY_URL = "http://localhost:8080";

/**
 * Generate an embedding vector for a given text.
 * Uses the LLM proxy for embedding generation.
 * Falls back to a simple hash-based embedding if the proxy doesn't support it.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    // Implementation depends on what the proxy supports.
    // Option A: Use OpenAI-compatible /v1/embeddings endpoint
    // Option B: Use a local embedding model (e.g., all-MiniLM-L6-v2 via transformers.js)
    // Option C: Use LLM to generate a pseudo-embedding via structured output

    const response = await fetch(`${ANTHROPIC_PROXY_URL}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: text,
        }),
    });

    if (!response.ok) {
        throw new Error(`Embedding generation failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
}
```

> **Decision point for user:** If the Antigravity proxy doesn't support `/v1/embeddings`, we should use `@xenova/transformers` for local embedding generation (all-MiniLM-L6-v2, 384 dimensions — change the `vector(768)` in init.sql accordingly).

### 3.2 Episodic Memory Service

```
[NEW] src/lib/memory/episodic.ts
```

```typescript
// src/lib/memory/episodic.ts
import { Pool } from "pg";
import { generateEmbedding } from "./embeddings";

const pool = new Pool({
    connectionString: process.env.AGENT_PG_URI
        ?? "postgresql://agent:agent_local_dev@localhost:5432/agent_memory",
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
 */
export async function storeEpisodicMemory(
    userId: string,
    threadId: string,
    summary: string,
    metadata?: Record<string, unknown>,
): Promise<void> {
    const embedding = await generateEmbedding(summary);
    await pool.query(
        `INSERT INTO episodic_memories (user_id, thread_id, summary, embedding, metadata)
         VALUES ($1, $2, $3, $4::vector, $5)`,
        [userId, threadId, summary, `[${embedding.join(",")}]`, metadata ?? {}],
    );
}

/**
 * Retrieve the most relevant past memories for a given query.
 * Uses cosine similarity via pgvector.
 */
export async function retrieveEpisodicMemories(
    userId: string,
    query: string,
    limit: number = 5,
): Promise<EpisodicMemory[]> {
    const queryEmbedding = await generateEmbedding(query);
    const result = await pool.query(
        `SELECT id, user_id, thread_id, summary, created_at, metadata,
                1 - (embedding <=> $1::vector) AS similarity
         FROM episodic_memories
         WHERE user_id = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [`[${queryEmbedding.join(",")}]`, userId, limit],
    );
    return result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        threadId: row.thread_id,
        summary: row.summary,
        createdAt: row.created_at,
        metadata: row.metadata,
        similarity: row.similarity,
    }));
}
```

---

## Step 4: Semantic Memory — Neo4j Knowledge Graph

### 4.1 Knowledge Graph Service

```
[NEW] src/lib/memory/knowledge-graph.ts
```

Stores and queries entity-relationship triples (Subject → Predicate → Object):

```typescript
// src/lib/memory/knowledge-graph.ts
import { getNeo4jDriver } from "./db";

export interface KnowledgeTriple {
    subject: string;
    subjectType: string;   // e.g., "Person", "Project", "Tool"
    predicate: string;     // e.g., "WORKS_ON", "PREFERS", "KNOWS"
    object: string;
    objectType: string;
    confidence: number;    // 0.0-1.0
    source: string;        // thread_id where this was extracted
}

/**
 * Upsert a knowledge triple into Neo4j.
 * Uses MERGE to avoid duplicates and updates confidence/source on match.
 */
export async function upsertTriple(triple: KnowledgeTriple): Promise<void> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
        await session.run(
            `MERGE (s:Entity {name: $subject, type: $subjectType})
             MERGE (o:Entity {name: $object, type: $objectType})
             MERGE (s)-[r:RELATES {predicate: $predicate}]->(o)
             SET r.confidence = $confidence,
                 r.source = $source,
                 r.updatedAt = datetime()`,
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
 * Query the knowledge graph for all facts about an entity.
 * Returns direct relationships (1 hop) and optionally 2-hop paths.
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
             RETURN s.name AS subject, s.type AS subjectType,
                    [rel IN r | rel.predicate] AS predicates,
                    o.name AS object, o.type AS objectType,
                    [rel IN r | rel.confidence] AS confidences,
                    [rel IN r | rel.source] AS sources`,
            { name: entityName },
        );
        return result.records.map((record) => ({
            subject: record.get("subject"),
            subjectType: record.get("subjectType"),
            predicate: record.get("predicates").join(" → "),
            object: record.get("object"),
            objectType: record.get("objectType"),
            confidence: Math.min(...record.get("confidences").map(Number)),
            source: record.get("sources")[0],
        }));
    } finally {
        await session.close();
    }
}

/**
 * Find all entities related to a topic (fuzzy match).
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
             WHERE toLower(e.name) CONTAINS toLower($query)
             OPTIONAL MATCH (e)-[r:RELATES]-()
             RETURN e.name AS name, e.type AS type, count(r) AS connections
             ORDER BY connections DESC
             LIMIT $limit`,
            { query, limit: neo4j.int(limit) },
        );
        return result.records.map((record) => ({
            name: record.get("name"),
            type: record.get("type"),
            connections: record.get("connections").toNumber(),
        }));
    } finally {
        await session.close();
    }
}
```

---

## Step 5: Memory Distiller (Background Extraction)

### 5.1 Distiller Service

```
[NEW] src/lib/memory/distiller.ts
```

The Memory Distiller runs **after a conversation ends** (or periodically). It:
1. Summarizes the conversation → stores as episodic memory (pgvector)
2. Extracts knowledge triples → upserts into Neo4j

```typescript
// src/lib/memory/distiller.ts
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { storeEpisodicMemory } from "./episodic";
import { upsertTriple, KnowledgeTriple } from "./knowledge-graph";

const ANTHROPIC_PROXY_URL = "http://localhost:8080";

const distillerLLM = new ChatAnthropic({
    model: "gemini-3-flash",  // Fast + cheap for extraction
    maxTokens: 4096,
    temperature: 0.1,
    apiKey: "not-needed",
    clientOptions: { baseURL: ANTHROPIC_PROXY_URL },
});

interface DistillerOutput {
    summary: string;
    triples: KnowledgeTriple[];
}

const DISTILLER_PROMPT = `You are a Memory Distiller. Given a conversation between a user and an AI agent, extract two things:

1. **Summary**: A concise 2-3 sentence summary of what was discussed and accomplished.
2. **Knowledge Triples**: A list of factual entity-relationship triples learned from the conversation.

Each triple must have:
- subject: The entity name (e.g., "User", "React", "project-x")
- subjectType: Category (Person, Technology, Project, Concept, Tool, Preference)
- predicate: The relationship (e.g., "USES", "PREFERS", "WORKS_ON", "KNOWS", "WANTS")
- object: The related entity
- objectType: Category of the related entity
- confidence: 0.0-1.0 how certain you are about this fact

Only extract CLEAR, FACTUAL relationships. Do not speculate.

Respond in JSON format:
{
    "summary": "...",
    "triples": [
        { "subject": "...", "subjectType": "...", "predicate": "...", "object": "...", "objectType": "...", "confidence": 0.9 }
    ]
}`;

/**
 * Distill a conversation into episodic memory + knowledge triples.
 * Intended to run asynchronously after a conversation ends.
 */
export async function distillConversation(
    userId: string,
    threadId: string,
    messages: BaseMessage[],
): Promise<DistillerOutput> {
    // Format messages for the distiller
    const conversationText = messages
        .map((m) => `${m._getType()}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
        .filter((line) => !line.startsWith("tool:"))  // Skip tool messages
        .join("\n");

    const response = await distillerLLM.invoke([
        new HumanMessage(`${DISTILLER_PROMPT}\n\n---\nCONVERSATION:\n${conversationText}`),
    ]);

    const content = typeof response.content === "string"
        ? response.content
        : response.content.map((c: { type: string; text?: string }) => c.type === "text" ? c.text : "").join("");

    // Parse JSON response (with fallback)
    let parsed: DistillerOutput;
    try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch?.[0] ?? "{}");
    } catch {
        console.error("[Memory Distiller] Failed to parse response:", content);
        parsed = { summary: content.slice(0, 500), triples: [] };
    }

    // Store episodic memory
    await storeEpisodicMemory(userId, threadId, parsed.summary, {
        messageCount: messages.length,
        extractedTriples: parsed.triples.length,
    });

    // Upsert knowledge triples
    for (const triple of parsed.triples) {
        await upsertTriple({ ...triple, source: threadId });
    }

    console.log(
        `[Memory Distiller] Stored: 1 episodic memory + ${parsed.triples.length} knowledge triples for thread ${threadId}`,
    );

    return parsed;
}
```

### 5.2 Trigger Distillation — API Integration

Add a distillation trigger at the end of the streaming response in `route.ts`:

```typescript
// In route.ts, after the stream completes:
// Fire-and-forget: distill the conversation in the background
import { distillConversation } from "@/lib/memory/distiller";

distillConversation(userId, threadId, allMessages).catch((err) =>
    console.error("[Memory Distiller] Background distillation failed:", err),
);
```

---

## Step 6: GraphRAG Query Logic — Memory-Augmented Agent

### 6.1 Memory Retrieval Node

```
[NEW] src/lib/agent/nodes/memory-retrieval.ts
```

A new graph node that runs **before the classifier**. It enriches the agent's context with:
1. Relevant episodic memories (pgvector similarity search)
2. Related knowledge graph facts (Neo4j entity queries)

```typescript
// src/lib/agent/nodes/memory-retrieval.ts
import { HumanMessage } from "@langchain/core/messages";
import { retrieveEpisodicMemories } from "@/lib/memory/episodic";
import { queryEntity, searchEntities } from "@/lib/memory/knowledge-graph";

/**
 * Memory Retrieval Node
 *
 * Injects relevant memories and knowledge into the conversation context
 * before the agent processes the user's message.
 */
export async function memoryRetrievalNode(state: { messages: any[] }) {
    const lastMessage = state.messages[state.messages.length - 1];
    const userQuery = typeof lastMessage.content === "string"
        ? lastMessage.content
        : "";

    if (!userQuery) return {};  // Nothing to search

    const userId = "default";  // TODO: extract from config/session

    // ─── 1. Episodic Memory: Semantic search in pgvector ─────────────
    const episodicMemories = await retrieveEpisodicMemories(userId, userQuery, 3);

    // ─── 2. Semantic Memory: Entity search in Neo4j ──────────────────
    const relatedEntities = await searchEntities(userQuery, 5);
    const entityFacts: string[] = [];
    for (const entity of relatedEntities.slice(0, 3)) {
        const facts = await queryEntity(entity.name, 1);
        for (const fact of facts) {
            entityFacts.push(
                `${fact.subject} (${fact.subjectType}) —[${fact.predicate}]→ ${fact.object} (${fact.objectType})`,
            );
        }
    }

    // ─── 3. Build memory context string ──────────────────────────────
    const memoryParts: string[] = [];

    if (episodicMemories.length > 0) {
        memoryParts.push("## Past Conversations");
        for (const mem of episodicMemories) {
            memoryParts.push(`- [${mem.createdAt.toLocaleDateString()}] ${mem.summary} (relevance: ${(mem.similarity! * 100).toFixed(0)}%)`);
        }
    }

    if (entityFacts.length > 0) {
        memoryParts.push("\n## Known Facts");
        for (const fact of entityFacts) {
            memoryParts.push(`- ${fact}`);
        }
    }

    if (memoryParts.length === 0) return {};  // No relevant memories

    // Inject as a system-level context message
    const memoryContext = new HumanMessage({
        content: `[MEMORY CONTEXT — relevant information from past interactions]\n${memoryParts.join("\n")}\n[END MEMORY CONTEXT]`,
    });

    return {
        messages: [memoryContext],
    };
}
```

### 6.2 Updated Graph Topology

The graph changes from:

```
START → classifier → ...
```

To:

```
START → memoryRetrieval → classifier → ...
```

**Modifications to `graph.ts`:**

```typescript
// Add the new node
.addNode("memoryRetrieval", memoryRetrievalNode)

// Change the entry edge
.addEdge("__start__", "memoryRetrieval")
.addEdge("memoryRetrieval", "classifier")
// Remove: .addEdge("__start__", "classifier")
```

---

## Step 7: Environment Configuration

### 7.1 Environment Variables

```
[NEW] .env.local (template)
```

```bash
# Memory Infrastructure
AGENT_PG_URI=postgresql://agent:agent_local_dev@localhost:5432/agent_memory
AGENT_NEO4J_URI=bolt://localhost:7687
AGENT_NEO4J_USER=neo4j
AGENT_NEO4J_PASS=agent_local_dev

# Embedding model (used by Memory Distiller)
AGENT_EMBEDDING_MODEL=gemini-embedding-exp-03-07
```

### 7.2 Graceful Degradation

If either Postgres or Neo4j is unavailable, the agent should **still work** — it just won't have memory. The `memoryRetrievalNode` and `distillConversation` should be wrapped in try/catch blocks that log warnings but don't crash the graph.

---

## New File Structure

```
src/lib/memory/                    [NEW DIRECTORY]
├── db.ts                          # Connection singletons (Postgres, Neo4j)
├── embeddings.ts                  # Vector embedding generation
├── episodic.ts                    # pgvector episodic memory store
├── knowledge-graph.ts             # Neo4j knowledge graph CRUD
└── distiller.ts                   # Background conversation distiller

src/lib/agent/
├── graph.ts                       [MODIFY] Swap MemorySaver → PostgresSaver,
│                                           add memoryRetrieval node,
│                                           make compilation async
├── state.ts                       [MODIFY] Add memoryContext field (optional)
└── nodes/
    └── memory-retrieval.ts        [NEW] Pre-classifier memory injection node

src/app/api/chat/
├── route.ts                       [MODIFY] Async graph init, distillation trigger
└── resume/route.ts                [MODIFY] Async graph init

infra/
├── init.sql                       [NEW] Postgres schema + pgvector setup
docker-compose.yml                 [NEW] Postgres + Neo4j services
.env.local                         [NEW] Environment configuration
```

---

## Step 8: Implementation Order

| Step | Description | Est. Effort | Dependencies |
|------|------------|-------------|--------------|
| 8.1 | Docker Compose + `init.sql` | 30 min | None |
| 8.2 | `src/lib/memory/db.ts` — connection module | 30 min | 8.1 |
| 8.3 | Swap `MemorySaver` → `PostgresSaver` in `graph.ts` | 1 hr | 8.2 |
| 8.4 | Update API routes for async graph init | 30 min | 8.3 |
| 8.5 | `src/lib/memory/embeddings.ts` | 1 hr | 8.2 |
| 8.6 | `src/lib/memory/episodic.ts` | 1 hr | 8.5 |
| 8.7 | `src/lib/memory/knowledge-graph.ts` | 1.5 hr | 8.2 |
| 8.8 | `src/lib/memory/distiller.ts` | 1.5 hr | 8.6, 8.7 |
| 8.9 | `src/lib/agent/nodes/memory-retrieval.ts` | 1 hr | 8.6, 8.7 |
| 8.10 | Wire memory-retrieval node into graph | 30 min | 8.9 |
| 8.11 | Wire distillation trigger into `route.ts` | 30 min | 8.8 |
| 8.12 | Graceful degradation + error handling | 1 hr | All |
| 8.13 | End-to-end testing | 2 hr | All |

**Total estimated effort: ~12 hours**

---

## Verification Plan

### Automated Tests

1. **TypeScript compilation:**
   ```bash
   npx tsc --noEmit
   ```

2. **Build verification:**
   ```bash
   npm run build
   ```

3. **Docker services health check:**
   ```bash
   docker compose up -d
   docker compose exec postgres pg_isready -U agent
   docker compose exec neo4j cypher-shell -u neo4j -p agent_local_dev "RETURN 1"
   ```

4. **Existing E2E tests** (must still pass — memory is additive):
   ```bash
   npx playwright test tests/e2e/smoke.spec.ts
   npx playwright test tests/e2e/ui-mocked.spec.ts
   ```

### Manual Verification

1. **Checkpointer persistence:** Start a conversation, restart the server (`npm run dev`), confirm the conversation resumes from where it left off by sending a follow-up message in the same thread.

2. **Episodic memory:** Have a conversation mentioning a specific project or preference. Start a **new thread**. Ask the agent "What do you remember about me?" or reference the previous topic — confirm it recalls the information.

3. **Knowledge graph:** After a conversation where you say "I prefer Python for scripting" or "I'm working on project Alpha", check Neo4j Browser at `http://localhost:7474` and run:
   ```cypher
   MATCH (n:Entity) RETURN n LIMIT 25
   ```

4. **Graceful degradation:** Stop the Docker containers (`docker compose down`), verify the agent still responds normally (just without memory context).

---

## Decisions Requiring User Input

> [!IMPORTANT]
> **Embedding model choice:** The plan assumes the Antigravity proxy supports an `/v1/embeddings` endpoint. If it doesn't, we need to decide between:
> - **Option A:** Use `@xenova/transformers` for local embeddings (all-MiniLM-L6-v2, 384 dims) — no external dependency, but adds ~200MB to node_modules
> - **Option B:** Run a separate Ollama embedding model (e.g., `nomic-embed-text`) — lighter integration but requires Ollama

> [!WARNING]
> **Breaking change:** `agentGraph` switches from a synchronous export to an async `getAgentGraph()` function. Any imports of `agentGraph` across the codebase will need to be updated.
