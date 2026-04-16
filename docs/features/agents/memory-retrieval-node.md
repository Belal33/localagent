# Memory Retrieval Node

Entry-point node that enriches context from Cognee (chunks + summaries) and Postgres episodic memory in parallel.
Injects a formatted `[MEMORY CONTEXT …]` system message and publishes structured chunks/episodes for the UI.

Implemented in `src/lib/agent/nodes/memory-retrieval.ts`. Runs three searches in parallel:
Cognee `CHUNKS` (top 5), Cognee `SUMMARIES` (top 3), and local `searchEpisodes` (top 3,
similarity > 0.4). Deduplicates, filters out echo patterns and lingering date-prefixed
episodic entries, and caps results at 5 facts + 3 episodes. Builds a human-readable
context text with `## Known facts` and `## Recent past conversations` sections, then
sets `memoryContextText`, `retrievedMemory`, and `retrievedEpisodes` on the state.
