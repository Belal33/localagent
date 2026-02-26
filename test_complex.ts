import { HumanMessage } from "@langchain/core/messages";
import { agentGraph } from "./src/lib/agent/graph";

async function runTest() {
    console.log("Starting Complex Workflow Test...");
    const config = { configurable: { thread_id: "test-" + Date.now() } };

    // A query that requires multi-steps to trigger complex workflow
    const prompt = "Please create a simple python script called hello.py that prints hello world. Then read the file to confirm it was created.";
    console.log(`Prompt: "${prompt}"`);

    try {
        const stream = await agentGraph.streamEvents(
            { messages: [new HumanMessage(prompt)] },
            { ...config, version: "v2", recursionLimit: 50 }
        );

        let lastNode = "";
        for await (const { event, data, metadata } of stream) {
            const node = metadata?.langgraph_node;
            if (node && node !== lastNode && event === "on_chain_start") {
                if (node !== "__start__") {
                    console.log(`\n▶ [Node Transition] Entered: ${node}`);
                }
                lastNode = node;
            }

            if (event === "on_chat_model_stream" && data.chunk?.content) {
                if (typeof data.chunk.content === "string") {
                    process.stdout.write(data.chunk.content);
                }
            }

            if (event === "on_tool_end") {
                console.log(`\n  [Tool executed] ${data.output?.name || 'unknown'}`);
            }

            if (event === "on_chain_end" && node === "planner") {
                const state = await agentGraph.getState(config);
                console.log("\n  [Plan generated]:", (state.values as any).plan);
            }
        }
        console.log("\n\nTest complete.");
    } catch (error) {
        console.error("Error during execution:", error);
    }
}

runTest();
