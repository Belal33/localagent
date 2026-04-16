# API — Health

`GET /api/health` — pings Postgres, Neo4j, the LLM proxy, and Ollama in parallel with per-service latency.
Returns 200 when all healthy, 503 when degraded or unhealthy.

Implemented in `src/app/api/health/route.ts`. Each check has a 5-second timeout.
Postgres runs `SELECT version()`; Neo4j calls `driver.getServerInfo()`; the Anthropic/LLM
proxy GETs its root URL; Ollama GETs `/api/tags` and returns the available model list.
Response shape: `{ status, timestamp, services: { postgres, neo4j, anthropicProxy, ollama } }`,
each entry including a `latency_ms` value. Useful for container orchestration liveness
checks and debugging connectivity from within the dev compose network.
