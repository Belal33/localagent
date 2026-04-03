/**
 * src/lib/memory/distiller.ts
 *
 * Memory Distiller: runs asynchronously after a conversation ends.
 *
 * Strategy: LLM-first fact extraction → Cognee storage
 *   1. Uses a fast LLM to extract structured facts/knowledge from the conversation
 *   2. Sends ONLY the extracted facts to Cognee (not the raw transcript)
 *   3. Cognee then builds vector embeddings + knowledge graph from clean data
 *
 * This prevents Cognee from storing noise (echoed user queries like "User: hi")
 * and ensures only meaningful knowledge gets indexed for future retrieval.
 */
import { type BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const COGNEE_BASE_URL = process.env.COGNEE_URL || "http://cognee:8000";
const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";

interface DistillerOutput {
    summary: string;
    factsExtracted: number;
}

/**
 * Get a lightweight LLM instance for fact extraction.
 * Uses a fast model since this runs in the background after the conversation.
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

/**
 * Extract structured facts from a conversation using an LLM.
 * Returns clean, standalone knowledge statements.
 */
async function extractFacts(conversationText: string): Promise<string[]> {
    try {
        const llm = getDistillerLLM();
        const response = await llm.invoke([
            FACT_EXTRACTION_PROMPT,
            new HumanMessage(`Extract the memorable facts from this conversation:\n\n${conversationText}`),
        ]);

        const content = typeof response.content === "string"
            ? response.content
            : (response.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === "text" && c.text)
                .map((c) => c.text)
                .join("");

        if (content.trim() === "NO_FACTS" || !content.trim()) {
            return [];
        }

        // Split by newlines, filter empty lines
        return content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    } catch (err) {
        console.warn("[Memory Distiller] Fact extraction failed:", (err as Error).message);
        return [];
    }
}

/**
 * Distill a conversation into Cognee memory.
 * 
 * Flow: Raw conversation → LLM fact extraction → Clean facts → Cognee /add → /cognify
 */
export async function distillConversation(
    userId: string,
    threadId: string,
    messages: BaseMessage[],
): Promise<DistillerOutput> {
    // Build raw transcript for LLM analysis
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
        return { summary: "", factsExtracted: 0 };
    }

    try {
        // ─── Step 1: LLM Fact Extraction ────────────────────────────────
        console.log(`[Memory Distiller] Extracting facts from thread=${threadId}...`);
        const facts = await extractFacts(conversationText);

        if (facts.length === 0) {
            console.log(`[Memory Distiller] No meaningful facts found in thread=${threadId}, skipping Cognee.`);
            return { summary: "No facts to store", factsExtracted: 0 };
        }

        console.log(`[Memory Distiller] Extracted ${facts.length} facts:`, facts);

        // ─── Step 2: Send clean facts to Cognee ─────────────────────────
        // Join facts into a clean document — no "User:" prefixes, no noise
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
            console.warn(`[Memory Distiller] Failed to add facts. ${await addRes.text()}`);
        }

        // ─── Step 3: Cognify (build knowledge graph) ────────────────────
        const cognifyRes = await fetch(`${COGNEE_BASE_URL}/api/v1/cognify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ datasets: [`memory_${userId}`] }),
        });

        if (!cognifyRes.ok) {
            console.warn(`[Memory Distiller] Failed to cognify. ${await cognifyRes.text()}`);
        }

        console.log(`[Memory Distiller] Successfully stored ${facts.length} facts from thread ${threadId}`);
        return { summary: `Stored ${facts.length} facts`, factsExtracted: facts.length };

    } catch (err) {
        console.error("[Memory Distiller] Error:", (err as Error).message);
        return { summary: "Cognee Error", factsExtracted: 0 };
    }
}
