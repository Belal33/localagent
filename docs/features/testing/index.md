# Testing

Playwright-based end-to-end test suite covering three tiers: fast smoke, offline UI with
mocked API, and full integration against a real LLM backend.

## Features

- [`playwright-config.md`](./playwright-config.md) — Config + auto-started dev server
- [`smoke-tests.md`](./smoke-tests.md) — Page load + basic UI sanity
- [`ui-mocked-tests.md`](./ui-mocked-tests.md) — NDJSON-mocked UI flow coverage
- [`real-integration-tests.md`](./real-integration-tests.md) — Real LLM end-to-end
