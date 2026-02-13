import { NextRequest } from "next/server";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { agentGraph } from "@/lib/agent/graph";

// Allow longer execution times for local inference + tool execution
export const maxDuration = 120;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { messages, threadId } = body;

        // Debug: log the raw message format from AI SDK v6
        console.log("Raw messages received:", JSON.stringify(messages, null, 2));

        // Convert incoming messages to LangChain format
        const langchainMessages = messages
            .filter((m: Record<string, unknown>) => m != null)
            .map((m: Record<string, unknown>) => {
                let text = "";
                if (typeof m.content === "string") {
                    text = m.content;
                } else if (Array.isArray(m.parts)) {
                    text = (m.parts as Array<Record<string, unknown>>)
                        .filter((p) => p.type === "text")
                        .map((p) => p.text as string)
                        .join("");
                }

                return m.role === "user"
                    ? new HumanMessage(text)
                    : new AIMessage(text);
            });

        // Configure thread ID for memory persistence
        const config = {
            configurable: { thread_id: threadId || "default_thread" },
        };

        // Stream the graph execution
        const eventStream = agentGraph.streamEvents(
            { messages: langchainMessages },
            { ...config, version: "v2" }
        );

        // Create a plain text ReadableStream
        const encoder = new TextEncoder();
        let isClosed = false;

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const { event, data } of eventStream) {
                        if (isClosed) break;

                        // Filter for LLM token generation events
                        if (event === "on_chat_model_stream" && data.chunk?.content) {
                            const rawContent = data.chunk.content;
                            let textChunk = "";

                            if (typeof rawContent === "string") {
                                // Ollama / simple providers return plain strings
                                textChunk = rawContent;
                            } else if (Array.isArray(rawContent)) {
                                // Anthropic returns content blocks: [{type: "text", text: "..."}]
                                textChunk = rawContent
                                    .filter((block: any) => block.type === "text" && block.text)
                                    .map((block: any) => block.text)
                                    .join("");
                            }

                            if (textChunk.length > 0) {
                                controller.enqueue(encoder.encode(textChunk));
                            }
                        }
                    }
                } catch (err) {
                    if (!isClosed) {
                        console.error("Stream processing error:", err);
                    }
                } finally {
                    if (!isClosed) {
                        isClosed = true;
                        controller.close();
                    }
                }
            },
            cancel() {
                isClosed = true;
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-cache",
            },
        });
    } catch (error: unknown) {
        console.error("Agent execution error:", error);
        const message =
            error instanceof Error ? error.message : "Unknown error occurred";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
