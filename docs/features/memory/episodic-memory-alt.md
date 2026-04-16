# Episodic Memory (Legacy)

Secondary/older episodic memory module using LangChain `OllamaEmbeddings` instead of raw fetch.
Similar API (`storeEpisodicMemory`, `retrieveEpisodicMemories`) — legacy alongside `episodes.ts`.

Implemented in `src/lib/memory/episodic.ts`. Uses `Pool` from `pg` and `generateEmbedding`
from `./embeddings.ts`. Truncates queries longer than 500 characters before embedding.
Returns an `EpisodicMemory` interface including `similarity`. **Not imported by the
current graph flow** — superseded by `episodes.ts` which is what the memory-retrieval
node and distiller actually call. Safe to delete once confirmed no external caller
references it.
