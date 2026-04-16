# Memory Distiller

Fire-and-forget post-turn distiller that extracts FACTS (→ Cognee) and an EPISODE summary (→ pgvector) from the full thread history.
Runs two LLM calls in parallel (fact extraction + summarization), then stores both concurrently.

Implemented in `src/lib/memory/distiller.ts`. `distillConversation(userId, threadId, messages)`
uses a local `ChatOpenAI` (`minimax-m2.5`, temp 0) with two system prompts: one returns
facts one-per-line (or `NO_FACTS`), the other returns a 1–3 sentence episode summary
(or `TRIVIAL`). Facts are posted to Cognee via `/api/v1/add` (multipart FormData) and
then `/api/v1/cognify`. The episode is stored via `upsertEpisode` from `episodes.ts`.
Triggered at the end of every `/api/chat` request against the full checkpointed thread
history, so storage happens even after the client disconnects.
