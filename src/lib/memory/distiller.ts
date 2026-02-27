/**
 * src/lib/memory/distiller.ts
 *
 * Memory Distiller: runs asynchronously after a conversation ends.
 * Uses an LLM to extract:
 *   1. A concise conversation summary → stored as episodic memory (pgvector)
 *   2. Entity-relationship triples   → upserted into Neo4j knowledge graph
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { storeEpisodicMemory } from "./episodic";
import { upsertTriple, type KnowledgeTriple } from "./knowledge-graph";

const ANTHROPIC_PROXY_URL = "http://localhost:8080";

// Fast, cheap LLM for extraction (gemini-3-flash via proxy)
const distillerLLM = new ChatAnthropic({
    model: "gemini-3-flash",
    maxTokens: 4096,
    temperature: 0.1,
    apiKey: "not-needed",
    clientOptions: { baseURL: ANTHROPIC_PROXY_URL },
});

interface DistillerOutput {
    summary: string;
    triples: KnowledgeTriple[];
}

const DISTILLER_PROMPT = `You are a Memory Distiller. Your job is to extract as much useful knowledge as possible from conversations. Given a conversation between a user and an AI agent, extract:

1. **Summary**: A concise 2-3 sentence summary of what was discussed and accomplished.
2. **Knowledge Triples**: Extract ALL factual entity-relationship triples you can find. Be thorough and extract as many as possible.

## What to Extract (be aggressive — capture everything useful):
- **Identity**: Name, role, profession, location, background
- **Skills & Expertise**: Programming languages, frameworks, tools they know or use
- **Projects**: What they're working on, project details, tech stack
- **Preferences**: Tools they prefer, coding style, OS, editors, workflows
- **Opinions**: What they like/dislike about technologies or approaches
- **Goals & Plans**: What they want to build, learn, or accomplish
- **Relationships**: Teams, companies, collaborators, clients
- **System Details**: OS, hardware, local setup, services running
- **Habits**: How they work, debug, communicate
- **Implicit Facts**: If someone asks about Docker and Neo4j, they likely USE those tools — extract that

## Triple Schema:
- subject: Entity name (e.g., "Belal", "React", "localagent")
- subjectType: One of: Person, Technology, Project, Concept, Tool, Preference, Organization, Skill
- predicate: Relationship verb. Use descriptive verbs like: USES, PREFERS, WORKS_ON, KNOWS, WANTS, IS_A, HAS_SKILL, RUNS_ON, BUILT_WITH, INTERESTED_IN, DISLIKES, WORKS_AT, LOCATED_IN, DEVELOPS, CONFIGURES, DEBUG, ASKS_ABOUT
- object: The related entity
- objectType: One of: Person, Technology, Project, Concept, Tool, Preference, Organization, Skill
- confidence: 0.0–1.0 (1.0 for explicit statements, 0.6–0.8 for strong implications, 0.4–0.6 for reasonable inferences)

## Rules:
- Extract AT LEAST 3-5 triples per conversation, even from short exchanges
- If the user mentions a technology by name, they likely USE it — extract it (confidence 0.7)
- If the user asks for help with X, they are WORKING_ON or LEARNING X — extract it
- Use the user's actual name if known, otherwise use "User"
- DO NOT skip implicit knowledge — if someone debugs Neo4j, they USE Neo4j

Respond ONLY with valid JSON (no markdown fences):
{
    "summary": "...",
    "triples": [
        { "subject": "...", "subjectType": "...", "predicate": "...", "object": "...", "objectType": "...", "confidence": 0.9 }
    ]
}`;

/**
 * Distill a conversation into episodic memory + knowledge triples.
 *
 * This function is intended to run fire-and-forget after a conversation ends.
 * It calls the LLM, parses structured output, and persists to both stores.
 *
 * @param userId    - User identifier (currently "default" for single-user)
 * @param threadId  - The thread ID of the conversation being distilled
 * @param messages  - All messages from the conversation
 */
export async function distillConversation(
    userId: string,
    threadId: string,
    messages: BaseMessage[],
): Promise<DistillerOutput> {
    // Format conversation as a human-readable transcript (skip tool messages)
    const conversationText = messages
        .filter((m) => {
            const t = m._getType();
            return t === "human" || t === "ai";
        })
        .map((m) => {
            const role = m._getType() === "human" ? "User" : "Assistant";
            const content =
                typeof m.content === "string"
                    ? m.content
                    : (m.content as { type: string; text?: string }[])
                        .filter((c) => c.type === "text" && c.text)
                        .map((c) => c.text)
                        .join("");
            return `${role}: ${content}`;
        })
        .join("\n");

    if (!conversationText.trim()) {
        return { summary: "", triples: [] };
    }

    const response = await distillerLLM.invoke([
        new HumanMessage(`${DISTILLER_PROMPT}\n\n---\nCONVERSATION:\n${conversationText}`),
    ]);

    const rawContent =
        typeof response.content === "string"
            ? response.content
            : (response.content as { type: string; text?: string }[])
                .filter((c) => c.type === "text" && c.text)
                .map((c) => c.text)
                .join("");

    // Parse JSON, falling back gracefully on malformed output
    let parsed: DistillerOutput;
    try {
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch?.[0] ?? "{}") as DistillerOutput;
        if (!parsed.summary) parsed.summary = rawContent.slice(0, 500);
        if (!Array.isArray(parsed.triples)) parsed.triples = [];
    } catch {
        console.warn("[Memory Distiller] Failed to parse JSON response — using raw summary.");
        parsed = { summary: rawContent.slice(0, 500), triples: [] };
    }

    // ─── Persist: episodic memory ─────────────────────────────────────────────
    await storeEpisodicMemory(userId, threadId, parsed.summary, {
        messageCount: messages.length,
        extractedTriples: parsed.triples.length,
    });

    // ─── Persist: knowledge triples ───────────────────────────────────────────
    for (const triple of parsed.triples) {
        await upsertTriple({ ...triple, source: threadId });
    }

    console.log(
        `[Memory Distiller] thread=${threadId}: 1 episodic memory + ${parsed.triples.length} knowledge triples stored.`,
    );

    return parsed;
}
