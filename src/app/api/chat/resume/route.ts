import { NextRequest } from "next/server";
import { Command } from "@langchain/langgraph";
import { AIMessageChunk, AIMessage, ToolMessage } from "@langchain/core/messages";
import { agentGraph } from "@/lib/agent/graph";

export const maxDuration = 120;

function ndjsonLine(obj: Record<string, unknown>): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(obj) + "\n");
}

/**
 * POST /api/chat/resume
 *
 * Resumes an interrupted graph execution after human review.
 * Uses graph.stream() with multi-mode streaming for reliable resume handling.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { threadId, decision } = body;

        if (!threadId) {
            return new Response(
                JSON.stringify({ error: "threadId is required" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        const config = {
            configurable: { thread_id: threadId },
        };

        // Load existing plan from graph state before resuming
        let lastPlan: string[] = [];
        let currentStepIndex = 0;
        try {
            const initialState = await agentGraph.getState(config);
            const existingPlan = (initialState.values as any)?.plan as string[] | undefined;
            if (existingPlan && existingPlan.length > 0) {
                lastPlan = existingPlan;
                const pastSteps = (initialState.values as any)?.pastSteps as [string, string][] | undefined;
                currentStepIndex = pastSteps?.length || 0;
            }
        } catch {
            // getState may not be available yet
        }

        // Resume using graph.stream() with multi-mode (messages + updates)
        // This is the documented approach for Command resume in LangGraph
        const resumeStream = await agentGraph.stream(
            new Command({ resume: decision }),
            { ...config, streamMode: ["messages", "updates"] as any, recursionLimit: 300 }
        );

        let isClosed = false;
        let lastEmittedNode = "";

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of resumeStream) {
                        if (isClosed) break;

                        // Multi-mode stream returns [mode, data] tuples
                        const [mode, data] = chunk as [string, any];

                        if (mode === "messages") {
                            // "messages" mode yields [message, metadata] tuples
                            const [message, metadata] = data;

                            // Token streaming from AIMessageChunk
                            if (message instanceof AIMessageChunk) {
                                const langgraphNode = metadata?.langgraph_node;

                                // Only stream tokens from the "agent" node
                                if (langgraphNode === "agent") {
                                    const rawContent = message.content;
                                    let textChunk = "";

                                    if (typeof rawContent === "string") {
                                        textChunk = rawContent;
                                    } else if (Array.isArray(rawContent)) {
                                        textChunk = rawContent
                                            .filter((block: any) => block.type === "text" && block.text)
                                            .map((block: any) => block.text)
                                            .join("");
                                    }

                                    if (textChunk.length > 0) {
                                        controller.enqueue(
                                            ndjsonLine({ type: "token", content: textChunk })
                                        );
                                    }

                                    // Check for tool calls on the complete message
                                    if (message.tool_call_chunks?.length) {
                                        // Tool call chunks are accumulated — only emit when we have complete data
                                        for (const tc of message.tool_call_chunks) {
                                            if (tc.name && tc.id) {
                                                controller.enqueue(
                                                    ndjsonLine({
                                                        type: "tool_call",
                                                        tool: tc.name,
                                                        args: tc.args ? JSON.parse(tc.args) : {},
                                                        id: tc.id,
                                                    })
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if (mode === "updates") {
                            // "updates" mode yields { nodeName: nodeOutput } objects
                            for (const [nodeName, nodeOutput] of Object.entries(data)) {
                                // Skip internal nodes
                                if (nodeName === "__start__" || nodeName === "__interrupt__") continue;

                                // Node transition (deduplicated)
                                if (nodeName !== lastEmittedNode) {
                                    lastEmittedNode = nodeName;
                                    controller.enqueue(
                                        ndjsonLine({
                                            type: "node_start",
                                            node: nodeName,
                                        })
                                    );
                                }

                                // Step tracking for plan-execute mode
                                if (nodeName === "executor" && lastPlan.length > 0 && currentStepIndex < lastPlan.length) {
                                    controller.enqueue(
                                        ndjsonLine({
                                            type: "step_status",
                                            step: lastPlan[currentStepIndex],
                                            status: "running",
                                        })
                                    );
                                }

                                if (nodeName === "replan" && lastPlan.length > 0 && currentStepIndex < lastPlan.length) {
                                    controller.enqueue(
                                        ndjsonLine({
                                            type: "step_status",
                                            step: lastPlan[currentStepIndex],
                                            status: "done",
                                        })
                                    );
                                    currentStepIndex++;
                                }

                                // Tool results from the "tools" node
                                if (nodeName === "tools" && nodeOutput) {
                                    const messages = (nodeOutput as any)?.messages;
                                    if (Array.isArray(messages)) {
                                        for (const msg of messages) {
                                            if (msg instanceof ToolMessage || msg?.constructor?.name === "ToolMessage") {
                                                const output = typeof msg.content === "string"
                                                    ? msg.content
                                                    : JSON.stringify(msg.content);
                                                controller.enqueue(
                                                    ndjsonLine({
                                                        type: "tool_result",
                                                        tool: msg.name || "unknown",
                                                        output: output.slice(0, 2000),
                                                        id: msg.tool_call_id || "",
                                                    })
                                                );
                                            }
                                        }
                                    }
                                }

                                // Final response from replan
                                if (nodeName === "replan" && (nodeOutput as any)?.response) {
                                    controller.enqueue(
                                        ndjsonLine({
                                            type: "token",
                                            content: (nodeOutput as any).response,
                                        })
                                    );
                                }

                                // Tool calls from the agent node (from complete messages)
                                if (nodeName === "agent" && nodeOutput) {
                                    const messages = (nodeOutput as any)?.messages;
                                    if (Array.isArray(messages)) {
                                        for (const msg of messages) {
                                            if ((msg instanceof AIMessage || msg?.constructor?.name === "AIMessage") && msg.tool_calls?.length) {
                                                for (const tc of msg.tool_calls) {
                                                    controller.enqueue(
                                                        ndjsonLine({
                                                            type: "tool_call",
                                                            tool: tc.name,
                                                            args: tc.args,
                                                            id: tc.id,
                                                        })
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // After stream completes, check for pending interrupts
                    const graphState = await agentGraph.getState(config);
                    if (
                        graphState.tasks &&
                        graphState.tasks.some(
                            (t: any) => t.interrupts && t.interrupts.length > 0
                        )
                    ) {
                        const interruptData = graphState.tasks
                            .flatMap((t: any) => t.interrupts || [])
                            .map((i: any) => i.value);

                        controller.enqueue(
                            ndjsonLine({
                                type: "interrupt",
                                data: interruptData[0] || {},
                            })
                        );
                    }

                    controller.enqueue(ndjsonLine({ type: "done" }));
                } catch (err) {
                    if (!isClosed) {
                        // Check for GraphInterrupt — the graph paused at a new interrupt
                        const isGraphInterrupt = err instanceof Error && (
                            err.constructor.name === "GraphInterrupt" ||
                            err.message?.includes("interrupt")
                        );

                        if (isGraphInterrupt) {
                            try {
                                const graphState = await agentGraph.getState(config);
                                if (
                                    graphState.tasks &&
                                    graphState.tasks.some(
                                        (t: any) => t.interrupts && t.interrupts.length > 0
                                    )
                                ) {
                                    const interruptData = graphState.tasks
                                        .flatMap((t: any) => t.interrupts || [])
                                        .map((i: any) => i.value);

                                    controller.enqueue(
                                        ndjsonLine({
                                            type: "interrupt",
                                            data: interruptData[0] || {},
                                        })
                                    );
                                }
                            } catch (stateErr) {
                                console.error("Failed to get graph state after interrupt:", stateErr);
                            }
                        } else {
                            console.error("Resume stream error:", err);
                            controller.enqueue(
                                ndjsonLine({
                                    type: "error",
                                    message: err instanceof Error ? err.message : "Unknown error",
                                })
                            );
                        }
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
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "Cache-Control": "no-cache",
            },
        });
    } catch (error: unknown) {
        console.error("Resume error:", error);
        const message =
            error instanceof Error ? error.message : "Unknown error occurred";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
