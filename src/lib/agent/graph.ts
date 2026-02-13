import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, AIMessage } from "@langchain/core/messages";
import { getActiveTools } from "./skills";

// ─── Configuration ──────────────────────────────────────────────────────────
const ANTHROPIC_PROXY_URL = "http://localhost:8080";

// ─── Load Tools from Skills ─────────────────────────────────────────────────
const tools = getActiveTools();
console.log(
  `[Agent Graph] Loaded ${tools.length} tools:`,
  tools.map((t) => t.name).join(", ")
);

// ─── System Prompt (Phase 2) ────────────────────────────────────────────────
const SYSTEM_PROMPT = new SystemMessage(
  "You are a highly capable autonomous AI agent running natively on an Ubuntu Linux system. " +
  "You are in Phase 2 — you have access to tools for file operations, " +
  "terminal execution, web search, and file downloads. " +
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

// ─── Agent Node ─────────────────────────────────────────────────────────────
async function callModel(state: typeof MessagesAnnotation.State) {
  const { messages } = state;
  const response = await llmWithTools.invoke([SYSTEM_PROMPT, ...messages]);
  return { messages: [response] };
}

// ─── Conditional Routing ────────────────────────────────────────────────────
function shouldContinue(state: typeof MessagesAnnotation.State) {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  if (lastMessage?.tool_calls?.length) {
    return "tools";
  }
  return "__end__";
}

// ─── Build the ReAct State Machine ──────────────────────────────────────────
// START → agent ⇄ tools → END
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", new ToolNode(tools))
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue, ["tools", "__end__"])
  .addEdge("tools", "agent");

// ─── Compile & Export ───────────────────────────────────────────────────────
const checkpointer = new MemorySaver();
export const agentGraph = workflow.compile({ checkpointer });
