# Episodic Memory (pgvector)

Per-thread conversation summaries stored as 1024-dim vectors in Postgres+pgvector with unique-per-thread upsert semantics.
Provides `upsertEpisode`, `searchEpisodes` (cosine + exclude current thread), and `getRecentEpisodes`.

Implemented in `src/lib/memory/episodes.ts`. Uses a direct `pg.Pool` (singleton, max 3)
and a raw `fetch` to Ollama's `/api/embed` endpoint to avoid pulling LangChain into the
write path. Each thread maps to a single row (unique index `idx_episodic_thread`);
upsert uses `ON CONFLICT (thread_id) DO UPDATE`. Search uses `embedding <=> $vector`
cosine distance, filters by `user_id`, and excludes a specified thread so the current
conversation doesn't retrieve itself. Exports `EpisodeResult` with a human-formatted
`date` field for the UI.
