import { NextRequest } from "next/server";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { getAgentGraph } from "@/lib/agent/graph";
import { distillConversation } from "@/lib/memory/distiller";

// Allow longer execution times for local inference + tool execution
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ─── NDJSON Event Types ─────────────────────────────────────────────────────
// { type: "token",       content: "..." }                         — text token
// { type: "interrupt",   data: {...} }                            — HITL approval request
// { type: "plan",        steps: [...] }                           — plan update
// { type: "step_status", step: "...", status: "..." }             — step progress
// { type: "tool_call",   tool: "...", args: {...}, id: "..." }    — agent invokes a tool
// { type: "tool_result", tool: "...", output: "...", id: "..." }  — tool execution result
// { type: "node_start",  node: "..." }                            — graph node transition
// { type: "memory",      episodic: [...], knowledge: [...] }      — retrieved memory context
// { type: "done" }                                                — stream complete

function ndjsonLine(obj: Record<string, unknown>): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(obj) + "\n");
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { messages, threadId } = body;

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

        // Get the compiled graph (lazy singleton — initializes PostgresSaver on first call)
        const graph = await getAgentGraph();

        // Stream the graph execution
        const eventStream = graph.streamEvents(
            { messages: langchainMessages },
            { ...config, version: "v2", recursionLimit: 100 }
        );

        // Create NDJSON ReadableStream
        let isClosed = false;

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    let lastPlan: string[] = [];
                    let lastEmittedNode = "";
                    let currentStepIndex = 0;

                    for await (const { event, data, metadata } of eventStream) {
                        if (isClosed) break;

                        // ─── Text Tokens (only from the "agent" node) ─────
                        const langgraph_node = (metadata as any)?.langgraph_node;
                        if (event === "on_chat_model_stream" && data.chunk?.content && langgraph_node === "agent") {
                            const rawContent = data.chunk.content;
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
                        }

                        // ─── Tool Calls (agent requesting tool use) ─────
                        if (event === "on_chat_model_end" && langgraph_node === "agent") {
                            const toolCalls = data.output?.tool_calls;
                            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                                for (const tc of toolCalls) {
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

                        // ─── Tool Results ───────────────────────
                        if (event === "on_tool_end") {
                            const output = typeof data.output?.content === "string"
                                ? data.output.content
                                : JSON.stringify(data.output?.content ?? data.output);
                            controller.enqueue(
                                ndjsonLine({
                                    type: "tool_result",
                                    tool: (metadata as any)?.langgraph_node === "tools"
                                        ? (data.output?.name || "unknown")
                                        : "unknown",
                                    output: output.slice(0, 2000),
                                    id: data.output?.tool_call_id || "",
                                })
                            );
                        }

                        // ─── Node Transitions (deduplicated) ────────────
                        if (event === "on_chain_start" && langgraph_node && langgraph_node !== lastEmittedNode && (metadata as any)?.langgraph_step !== undefined) {
                            const skipNodes = new Set(["__start__"]);
                            if (!skipNodes.has(langgraph_node)) {
                                lastEmittedNode = langgraph_node;
                                controller.enqueue(
                                    ndjsonLine({
                                        type: "node_start",
                                        node: langgraph_node,
                                    })
                                );
                            }
                        }

                        // ─── Memory Context: emit retrieved memories to client ──
                        if (event === "on_chain_end" && langgraph_node === "memoryRetrieval") {
                            try {
                                const memState = await graph.getState(config);
                                const mem = (memState.values as any)?.retrievedMemory;
                                if (mem && (mem.episodic?.length > 0 || mem.knowledge?.length > 0)) {
                                    controller.enqueue(
                                        ndjsonLine({
                                            type: "memory",
                                            episodic: mem.episodic || [],
                                            knowledge: mem.knowledge || [],
                                        })
                                    );
                                }
                            } catch {
                                // State read may fail if not yet checkpointed
                            }
                        }

                        // ─── Plan: Emit plan when planner node finishes ────
                        if (event === "on_chain_end" && langgraph_node === "planner") {
                            try {
                                const graphState = await graph.getState(config);
                                const plan = (graphState.values as any)?.plan as string[] | undefined;
                                if (plan && plan.length > 0 && JSON.stringify(plan) !== JSON.stringify(lastPlan)) {
                                    lastPlan = plan;
                                    currentStepIndex = 0;
                                    controller.enqueue(
                                        ndjsonLine({ type: "plan", steps: plan })
                                    );
                                }
                            } catch {
                                // getState may fail if graph hasn't checkpointed yet
                            }
                        }

                        // ─── Step Running: executor starts = current step is running ──
                        if (event === "on_chain_start" && langgraph_node === "executor" && lastPlan.length > 0) {
                            if (currentStepIndex < lastPlan.length) {
                                controller.enqueue(
                                    ndjsonLine({
                                        type: "step_status",
                                        step: lastPlan[currentStepIndex],
                                        status: "running",
                                    })
                                );
                            }
                        }

                        // ─── Step Outcome: replan ends = step was evaluated ──
                        if (event === "on_chain_end" && langgraph_node === "replan" && lastPlan.length > 0) {
                            try {
                                const stepState = await graph.getState(config);
                                const stepStatus = (stepState.values as any)?.stepStatus;
                                if (currentStepIndex < lastPlan.length) {
                                    if (stepStatus === "failed") {
                                        // Step failed — emit "failed", don't advance index
                                        controller.enqueue(
                                            ndjsonLine({
                                                type: "step_status",
                                                step: lastPlan[currentStepIndex],
                                                status: "failed",
                                            })
                                        );
                                    } else {
                                        // Step succeeded — emit "done" and advance
                                        controller.enqueue(
                                            ndjsonLine({
                                                type: "step_status",
                                                step: lastPlan[currentStepIndex],
                                                status: "done",
                                            })
                                        );
                                        currentStepIndex++;
                                    }
                                }
                            } catch {
                                // Fallback: assume done if state read fails
                                if (currentStepIndex < lastPlan.length) {
                                    controller.enqueue(
                                        ndjsonLine({
                                            type: "step_status",
                                            step: lastPlan[currentStepIndex],
                                            status: "done",
                                        })
                                    );
                                    currentStepIndex++;
                                }
                            }
                        }

                        // ─── Final Response ─────────────────────
                        if (event === "on_chain_end" && data.output?.response) {
                            controller.enqueue(
                                ndjsonLine({
                                    type: "token",
                                    content: data.output.response,
                                })
                            );
                        }
                    }

                    // Check if graph was interrupted (HITL)
                    const graphState = await graph.getState(config);
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

                    // Stream complete
                    controller.enqueue(ndjsonLine({ type: "done" }));

                    // ─── Fire-and-forget memory distillation ──────────────────
                    // Runs in background after stream closes; never blocks the response.
                    const allMessages = langchainMessages;
                    distillConversation("default", threadId || "default_thread", allMessages).catch((err) =>
                        console.error("[Memory Distiller] Background distillation failed:", err),
                    );
                } catch (err) {
                    if (!isClosed) {
                        // Check if this is a GraphInterrupt (from interrupt())
                        // In this case, the graph has pending interrupts we need to surface
                        const isGraphInterrupt = err instanceof Error && (
                            err.constructor.name === "GraphInterrupt" ||
                            err.message?.includes("interrupt")
                        );

                        if (isGraphInterrupt) {
                            try {
                                const graphState = await graph.getState(config);
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
                            console.error("Stream processing error:", err);
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
        console.error("Agent execution error:", error);
        const message =
            error instanceof Error ? error.message : "Unknown error occurred";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
