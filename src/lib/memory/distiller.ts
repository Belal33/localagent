/**
 * src/lib/memory/distiller.ts
 *
 * Memory Distiller: runs asynchronously after a conversation ends.
 *
 * Produces TWO types of memory for Cognee:
 *   1. FACTS — standalone knowledge statements (long-term semantic memory)
 *      → stored in `memory_{userId}` dataset
 *   2. EPISODE — a timestamped conversation summary (episodic memory)
 *      → stored in `episodes_{userId}` dataset
 *
 * The retrieval node uses both to give the agent:
 *   - Knowledge about the user (facts)
 *   - Context about what happened in past conversations (episodes)
 */
import { type BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const COGNEE_BASE_URL = process.env.COGNEE_URL || "http://cognee:8000";
const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";

interface DistillerOutput {
    summary: string;
    factsExtracted: number;
    episodeStored: boolean;
}

/**
 * Get a lightweight LLM instance for extraction.
 * Uses a fast model since this runs in the background.
 */
function getDistillerLLM(): ChatOpenAI {
    return new ChatOpenAI({
        model: "gemini-2.5-flash",
        maxTokens: 2000,
        temperature: 0,
        configuration: {
            apiKey: process.env.OPENCODE_API_KEY,
            baseURL: OPENCODE_BASE_URL,
        },
    });
}

// ─── Prompts ────────────────────────────────────────────────────────────────

const FACT_EXTRACTION_PROMPT = new SystemMessage(
`You are a memory extraction system. Given a conversation between a User and an Assistant, extract ALL meaningful facts, preferences, and knowledge worth remembering for future interactions.

Rules:
- Extract facts about the user (name, preferences, technical stack, habits, goals)
- Extract factual claims or decisions made during the conversation
- Extract any task outcomes or important results
- Write each fact as a clear, standalone statement
- Do NOT include conversational noise (greetings, "how are you", meta questions like "what is my name")
- Do NOT include the assistant's capabilities or identity
- If there are no meaningful facts to extract, respond with exactly: NO_FACTS
- Output one fact per line, no numbering, no bullets`
);

const EPISODE_SUMMARY_PROMPT = new SystemMessage(
`You are a conversation summarizer. Given a conversation between a User and an Assistant, write a single concise summary sentence (max 100 words) describing what happened in this interaction.

Focus on:
- What the user wanted or asked about
- What was accomplished or discussed
- Any key decisions or outcomes

Write in past tense. Start with "The user..." or "We discussed..."
If the conversation was trivial (just greetings), respond with exactly: TRIVIAL`
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract LLM text content from response */
function extractContent(response: { content: string | Array<{ type: string; text?: string }> }): string {
    if (typeof response.content === "string") return response.content;
    return (response.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("");
}

/** Send a document to Cognee and cognify it */
async function storeInCognee(text: string, filename: string, datasetName: string): Promise<boolean> {
    try {
        const formData = new FormData();
        formData.append(
            "data",
            new Blob([text], { type: "text/plain" }),
            filename,
        );
        formData.append("datasetName", datasetName);

        const addRes = await fetch(`${COGNEE_BASE_URL}/api/v1/add`, {
            method: "POST",
            body: formData,
        });

        if (!addRes.ok) {
            console.warn(`[Memory Distiller] Failed to add to ${datasetName}: ${await addRes.text()}`);
            return false;
        }

        const cognifyRes = await fetch(`${COGNEE_BASE_URL}/api/v1/cognify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ datasets: [datasetName] }),
        });

        if (!cognifyRes.ok) {
            console.warn(`[Memory Distiller] Failed to cognify ${datasetName}: ${await cognifyRes.text()}`);
            return false;
        }

        return true;
    } catch (err) {
        console.warn(`[Memory Distiller] Cognee store error for ${datasetName}:`, (err as Error).message);
        return false;
    }
}

// ─── Main Distiller ─────────────────────────────────────────────────────────

/**
 * Distill a conversation into both factual knowledge AND an episodic summary.
 *
 * Flow:
 *   Conversation → LLM → Facts + Episode Summary → Cognee (two datasets)
 */
export async function distillConversation(
    userId: string,
    threadId: string,
    messages: BaseMessage[],
): Promise<DistillerOutput> {
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
        return { summary: "", factsExtracted: 0, episodeStored: false };
    }

    try {
        const llm = getDistillerLLM();
        console.log(`[Memory Distiller] Processing thread=${threadId}...`);

        // ─── Step 1: Extract facts + episode summary in parallel ────────
        const [factsResponse, episodeResponse] = await Promise.all([
            llm.invoke([
                FACT_EXTRACTION_PROMPT,
                new HumanMessage(`Extract the memorable facts from this conversation:\n\n${conversationText}`),
            ]),
            llm.invoke([
                EPISODE_SUMMARY_PROMPT,
                new HumanMessage(`Summarize this conversation:\n\n${conversationText}`),
            ]),
        ]);

        // Parse facts
        const factsContent = extractContent(factsResponse);
        const facts = factsContent.trim() === "NO_FACTS" || !factsContent.trim()
            ? []
            : factsContent.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

        // Parse episode summary
        const episodeContent = extractContent(episodeResponse).trim();
        const hasEpisode = episodeContent !== "TRIVIAL" && episodeContent.length > 10;

        console.log(`[Memory Distiller] Extracted ${facts.length} facts, episode: ${hasEpisode ? "yes" : "no"}`);

        // ─── Step 2: Store in Cognee (parallel) ─────────────────────────
        const storePromises: Promise<boolean>[] = [];

        // Store facts in the knowledge dataset
        if (facts.length > 0) {
            const factsDocument = facts.join("\n");
            console.log(`[Memory Distiller] Facts:`, facts);
            storePromises.push(
                storeInCognee(factsDocument, `${threadId}_facts.txt`, `memory_${userId}`)
            );
        }

        // Store episode in the episodes dataset with ISO timestamp
        if (hasEpisode) {
            const timestamp = new Date().toISOString();
            const episodeDocument = `[${timestamp}] ${episodeContent}`;
            console.log(`[Memory Distiller] Episode: ${episodeDocument}`);
            storePromises.push(
                storeInCognee(episodeDocument, `${threadId}_episode.txt`, `episodes_${userId}`)
            );
        }

        const results = await Promise.all(storePromises);
        const episodeStored = hasEpisode && results.length > (facts.length > 0 ? 1 : 0)
            ? results[results.length - 1]
            : false;

        console.log(`[Memory Distiller] Done: ${facts.length} facts, episode=${episodeStored}`);
        return {
            summary: `Stored ${facts.length} facts${episodeStored ? " + episode" : ""}`,
            factsExtracted: facts.length,
            episodeStored,
        };
    } catch (err) {
        console.error("[Memory Distiller] Error:", (err as Error).message);
        return { summary: "Cognee Error", factsExtracted: 0, episodeStored: false };
    }
}
