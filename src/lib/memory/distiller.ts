/**
 * src/lib/memory/distiller.ts
 *
 * Memory Distiller: runs asynchronously after a conversation ends.
 * Replaced the legacy manual LLM parsing logic with Cognee framework via HTTP.
 * 
 * Cognee automatically handles chunking, vector embedding, and Triple KG extraction.
 */
import { type BaseMessage } from "@langchain/core/messages";

const COGNEE_BASE_URL = process.env.COGNEE_URL || "http://cognee:8000";

interface DistillerOutput {
    summary: string;
}

/**
 * Distill a conversation into Cognee memory.
 * This sends the structured text to Cognee's /add and /cognify endpoints.
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
        return { summary: "" };
    }

    try {
        console.log(`[Memory Distiller] Sending thread=${threadId} to Cognee Service...`);
        
        // 1. Add interaction text — POST /api/v1/add (multipart/form-data required)
        const formData = new FormData();
        formData.append(
            "data",
            new Blob([conversationText], { type: "text/plain" }),
            `${threadId}.txt`,
        );
        formData.append("datasetName", `chat_${threadId}`);

        const addRes = await fetch(`${COGNEE_BASE_URL}/api/v1/add`, {
            method: "POST",
            // Do NOT set Content-Type — fetch auto-sets multipart boundary
            body: formData,
        });

        if (!addRes.ok) {
            console.warn(`[Memory Distiller] Failed to add dataset. ${await addRes.text()}`);
        }

        // 2. Form memory structure (Cognify) — POST /api/v1/cognify
        const cognifyRes = await fetch(`${COGNEE_BASE_URL}/api/v1/cognify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ datasets: [`chat_${threadId}`] })
        });
        
        if (!cognifyRes.ok) {
            console.warn(`[Memory Distiller] Failed to cognify. ${await cognifyRes.text()}`);
        }

        console.log(`[Memory Distiller] Successfully distilled thread ${threadId} to Cognee`);
        return { summary: "Sent to Cognee" };

    } catch (err) {
        console.error("[Memory Distiller] Error interfacing with Cognee:", (err as Error).message);
        return { summary: "Cognee Error" };
    }
}
