# Neo4j Knowledge Graph

Semantic knowledge graph storing `(Entity)-[RELATES {predicate}]->(Entity)` triples with 1024-dim entity embeddings.
Supports upsert, entity traversal (up to N hops), and hybrid vector+string entity search.

Implemented in `src/lib/memory/knowledge-graph.ts`. Ensures a `VECTOR INDEX entity_embedding`
(1024 dims, cosine). `upsertTriple(triple)` MERGEs subject/object `Entity` nodes and the
`RELATES` edge, updates `confidence`, `source`, `updatedAt`, then embeds both entities in
parallel via `setEntityEmbedding`. `queryEntity(name, maxHops)` traverses relationships
up to N hops. `searchEntities(query, limit)` first tries `db.index.vector.queryNodes`
(score > 0.3) and falls back to case-insensitive `CONTAINS` matching.
**Not currently wired** into any graph node — available as a library for future use.
