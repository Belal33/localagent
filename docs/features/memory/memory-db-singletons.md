# Memory DB Singletons

Singleton factories for memory infrastructure: the Postgres LangGraph checkpointer and the Neo4j driver.
Handles lazy init, `.setup()` for checkpointer tables, and fire-and-forget vector-index creation.

Implemented in `src/lib/memory/db.ts`. `getCheckpointer()` returns
`PostgresSaver.fromConnString(AGENT_PG_URI)` after calling `.setup()` exactly once.
`getNeo4jDriver()` lazily builds a Neo4j driver and triggers `ensureVectorIndex()` on
first access. `closeAll()` cleanly tears down both for tests/shutdown. Uses
`@langchain/langgraph-checkpoint-postgres` and `neo4j-driver`.
