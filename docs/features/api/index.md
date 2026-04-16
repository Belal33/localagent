# API

Next.js App Router route handlers under `src/app/api/`. Three endpoints:
the main streaming chat, the HITL resume, and a health probe for all backing services.

All chat endpoints emit the custom NDJSON event protocol (see `streaming/`).

## Features

- [`api-chat-stream.md`](./api-chat-stream.md) — `POST /api/chat` main streaming turn
- [`api-chat-resume.md`](./api-chat-resume.md) — `POST /api/chat/resume` HITL resume
- [`api-health.md`](./api-health.md) — `GET /api/health` service probe
