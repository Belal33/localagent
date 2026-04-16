# Docker Compose Services

Compose stack with `dev` / `prod` profiles for the app plus four always-on sidecars: postgres (pgvector), neo4j, scrapling-mcp, cognee.
Host services (Ollama, LLM proxies) are reached via `host.docker.internal`.

Defined in `docker-compose.yml`. `app-dev` (profile `dev`) bind-mounts source + workspace
volume for hot reload; `app-prod` uses the built image. `postgres` is
`pgvector/pgvector:pg16` with `infra/init.sql` auto-run. `neo4j` is `5-community` with
the APOC plugin. `scrapling-mcp` is `ghcr.io/d4vinci/scrapling:latest` listening on
port 8931 (HTTP MCP). `cognee` is `cognee/cognee:latest` configured to use OpenCode as
its custom LLM endpoint, Ollama for embeddings, pgvector as vector DB, Neo4j as graph
DB, and Postgres as its relational state store. Run with `docker compose --profile dev up --build`.
