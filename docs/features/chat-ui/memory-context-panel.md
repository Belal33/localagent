# Memory Context Panel

Purple-themed collapsible panel showing retrieved memories (knowledge facts + episodic past conversations).
Has two tabs: a rendered "Memories" view and a raw "What Agent Sees" view of the injected context text.

Implemented in `src/app/components/MemoryContext.tsx`. Receives `memories` (Cognee chunks),
`episodes` (Postgres summaries with human-formatted date), and `contextText` (the
verbatim text injected into the LLM's system prompt by the memory-retrieval node).
Shows a total count badge. Uses Lucide's Brain icon. Lets the user verify exactly
which facts and past conversations influenced the current response.
