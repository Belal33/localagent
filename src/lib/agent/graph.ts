import {
  StateGraph,
  MemorySaver,
  Annotation,
  END,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import { getActiveTools } from "./skills";
import { AgentAnnotation } from "./state";
import { humanReviewNode } from "./nodes/human-review";
import { plannerNode } from "./nodes/planner";
import { executorNode } from "./nodes/executor";
import { replanNode } from "./nodes/replan";
import { classifierNode } from "./nodes/classifier";

// ─── Configuration ──────────────────────────────────────────────────────────
const ANTHROPIC_PROXY_URL = "http://localhost:8080";

// ─── Load Tools from Skills ─────────────────────────────────────────────────
const tools = getActiveTools();
console.log(
  `[Agent Graph] Loaded ${tools.length} tools:`,
  tools.map((t) => t.name).join(", ")
);

// ─── System Prompt (Phase 3) ────────────────────────────────────────────────
const SYSTEM_PROMPT = new SystemMessage(
  "You are a highly capable autonomous AI agent running natively on an Ubuntu Linux system. " +
  "You are in Phase 3 — you have access to tools for file operations, " +
  "terminal execution, web search, and file downloads. " +
  "Destructive operations require human approval before execution. " +
  "For complex tasks, a plan is created before executing. " +
  "Use your tools proactively to accomplish tasks. " +
  "Be concise, helpful, and precise."
);

// ─── LLM via Antigravity Claude Proxy ───────────────────────────────────────
const llm = new ChatAnthropic({
  model: "gemini-3-flash",
  maxTokens: 64000,
  temperature: 0.1,
  apiKey: "not-needed",
  clientOptions: {
    baseURL: ANTHROPIC_PROXY_URL,
  },
});
const llmWithTools = llm.bindTools(tools);

// ─── Extended State (adds classification field for routing) ─────────────────
const GraphAnnotation = Annotation.Root({
  ...AgentAnnotation.spec,
  classification: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "simple",
  }),
});

// ─── Agent Node ─────────────────────────────────────────────────────────────
async function callModel(state: typeof GraphAnnotation.State) {
  const { messages } = state;
  const response = await llmWithTools.invoke([SYSTEM_PROMPT, ...messages]);
  return { messages: [response] };
}

// ─── Conditional Routing: After Agent ───────────────────────────────────────
function afterAgent(state: typeof GraphAnnotation.State) {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  if (lastMessage?.tool_calls?.length) {
    return "humanReview"; // Route through safety check
  }
  // No tool calls — check if we're in plan-execute mode
  if (state.plan.length > 0) {
    return "replan";
  }
  return "__end__";
}

// ─── Conditional Routing: After Classifier ──────────────────────────────────
function afterClassifier(state: typeof GraphAnnotation.State) {
  return state.classification === "complex" ? "planner" : "agent";
}

// ─── Conditional Routing: After Replan ──────────────────────────────────────
function afterReplan(state: typeof GraphAnnotation.State) {
  if (state.response) {
    // Task is complete — inject final response and end
    return "__end__";
  }
  if (state.plan.length > 0) {
    return "executor";
  }
  return "__end__";
}

// ─── Build the Phase 3 State Machine ────────────────────────────────────────
//
// Topology:
//   START → classifier → (simple: agent ⇄ humanReview → tools → agent → END)
//                       → (complex: planner → executor → agent ⇄ humanReview → tools → agent → replan → ...)
//

const workflow = new StateGraph(GraphAnnotation)
  // Nodes
  .addNode("classifier", classifierNode)
  .addNode("planner", plannerNode)
  .addNode("executor", executorNode)
  .addNode("agent", callModel)
  .addNode("humanReview", humanReviewNode, {
    ends: ["tools", "agent", "__end__"],
  })
  .addNode("tools", new ToolNode(tools))
  .addNode("replan", replanNode)

  // Edges
  .addEdge("__start__", "classifier")
  .addConditionalEdges("classifier", afterClassifier, ["planner", "agent"])
  .addEdge("planner", "executor")
  .addEdge("executor", "agent")
  .addConditionalEdges("agent", afterAgent, [
    "humanReview",
    "replan",
    "__end__",
  ])
  .addEdge("tools", "agent")
  .addConditionalEdges("replan", afterReplan, ["executor", "__end__"]);

// ─── Compile & Export ───────────────────────────────────────────────────────
const checkpointer = new MemorySaver();
export const agentGraph = workflow.compile({
  checkpointer,

  // The humanReview node uses interrupt() which requires a checkpointer
});
