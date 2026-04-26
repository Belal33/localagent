/**
 * src/lib/memory/distiller.ts
 *
 * Memory Distiller: runs asynchronously after each agent turn.
 *
 * Produces TWO types of memory:
 *   1. FACTS — standalone knowledge statements → Cognee (vector search)
 *   2. EPISODE — a conversation summary → Postgres+pgvector (upsert per thread)
 *
 * The distiller receives the FULL thread history (not just the last turn),
 * so facts and episode summaries reflect the complete conversation context.
 * Episodes are upserted: if one already exists for this thread, it's updated.
 */
import { type BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { upsertEpisode } from "./episodes";
import { COGNEE_BASE_URL } from "@/lib/cognee-client";

const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";

interface DistillerOutput {
    summary: string;
    factsExtracted: number;
    episodeStored: boolean;
}

/**
 * Get a lightweight LLM for extraction (runs in background, speed matters).
 */
function getDistillerLLM(): ChatOpenAI {
    return new ChatOpenAI({
        model: "minimax-m2.5",
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
    `You are a conversation summarizer. Given a conversation between a User and an Assistant, write a concise summary (1-3 sentences, max 150 words) describing EVERYTHING that happened in this interaction.

Focus on:
- What the user wanted or asked about  
- What was accomplished, discussed, or decided
- Key outcomes, errors encountered, or solutions found

Write in past tense. Be specific — include names of technologies, tools, and concepts discussed.
If the conversation was trivial (just greetings with no substance), respond with exactly: TRIVIAL`
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract LLM response text */
function extractContent(response: { content: string | Array<{ type: string; text?: string }> }): string {
    if (typeof response.content === "string") return response.content;
    return (response.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("");
}

/** Build readable transcript from messages */
function buildTranscript(messages: BaseMessage[]): string {
    return messages
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
}

/** Store facts in Cognee */
async function storeFacts(facts: string[], threadId: string, userId: string): Promise<boolean> {
    try {
        const factsDocument = facts.join("\n");
        const formData = new FormData();
        formData.append(
            "data",
            new Blob([factsDocument], { type: "text/plain" }),
            `${threadId}_facts.txt`,
        );
        formData.append("datasetName", `memory_${userId}`);

        const addRes = await fetch(`${COGNEE_BASE_URL}/api/v1/add`, {
            method: "POST",
            body: formData,
        });

        if (!addRes.ok) {
            console.warn(`[Distiller] Failed to add facts: ${await addRes.text()}`);
            return false;
        }

        const cognifyRes = await fetch(`${COGNEE_BASE_URL}/api/v1/cognify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ datasets: [`memory_${userId}`] }),
        });

        if (!cognifyRes.ok) {
            console.warn(`[Distiller] Failed to cognify: ${await cognifyRes.text()}`);
            return false;
        }

        return true;
    } catch (err) {
        console.warn(`[Distiller] Cognee store error:`, (err as Error).message);
        return false;
    }
}

// ─── Main Distiller ─────────────────────────────────────────────────────────

/**
 * Distill a conversation into facts (Cognee) + episode (Postgres).
 *
 * @param userId - User ID for scoping memory
 * @param threadId - Thread ID (one episode per thread, upserted)
 * @param messages - FULL thread history (all messages in this conversation)
 */
export async function distillConversation(
    userId: string,
    threadId: string,
    messages: BaseMessage[],
): Promise<DistillerOutput> {
    const conversationText = buildTranscript(messages);

    if (!conversationText.trim()) {
        return { summary: "", factsExtracted: 0, episodeStored: false };
    }

    // Count turns for metadata
    const turnCount = messages.filter((m) => m._getType() === "human").length;

    try {
        const llm = getDistillerLLM();
        console.log(`[Distiller] Processing thread=${threadId} (${turnCount} turns, ${messages.length} messages)...`);

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

        // Parse episode
        const episodeContent = extractContent(episodeResponse).trim();
        const hasEpisode = episodeContent !== "TRIVIAL" && episodeContent.length > 10;

        console.log(`[Distiller] Extracted ${facts.length} facts, episode: ${hasEpisode ? "yes" : "no"}`);

        // ─── Step 2: Store both in parallel ─────────────────────────────
        const storePromises: Promise<unknown>[] = [];

        if (facts.length > 0) {
            console.log(`[Distiller] Facts:`, facts);
            storePromises.push(storeFacts(facts, threadId, userId));
        }

        let episodeStored = false;
        if (hasEpisode) {
            console.log(`[Distiller] Episode: ${episodeContent}`);
            storePromises.push(
                upsertEpisode({
                    threadId,
                    userId,
                    summary: episodeContent,
                    metadata: { turnCount, messageCount: messages.length },
                }).then(() => { episodeStored = true; })
                    .catch((err) => {
                        console.warn(`[Distiller] Episode upsert failed:`, (err as Error).message);
                    })
            );
        }

        await Promise.all(storePromises);

        console.log(`[Distiller] Done: ${facts.length} facts, episode=${episodeStored}`);
        return {
            summary: `Stored ${facts.length} facts${episodeStored ? " + episode" : ""}`,
            factsExtracted: facts.length,
            episodeStored,
        };
    } catch (err) {
        console.error("[Distiller] Error:", (err as Error).message);
        return { summary: "Distiller Error", factsExtracted: 0, episodeStored: false };
    }
}
