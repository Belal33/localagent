# Infrastructure

Docker Compose stack, multi-stage Dockerfile, Postgres bootstrap SQL, and the Next.js
config that marks native deps as server-external.

## Features

- [`docker-compose-services.md`](./docker-compose-services.md) — Compose file with dev/prod profiles + 4 sidecar services
- [`docker-image-build.md`](./docker-image-build.md) — Multi-stage Dockerfile with Camoufox + Firefox deps
- [`postgres-init-sql.md`](./postgres-init-sql.md) — pgvector + `episodic_memories` table
- [`next-config.md`](./next-config.md) — `serverExternalPackages` for native/Node-only deps
