import {
  StateGraph,
  Annotation,
  END,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";

import {
  getToolsForState,
  getAllPossibleTools,
  getSkillNameFromPlaceholder,
} from "./skills";
import { AgentAnnotation } from "./state";
import { humanReviewNode } from "./nodes/human-review";
import { plannerNode } from "./nodes/planner";
import { executorNode } from "./nodes/executor";
import { replanNode } from "./nodes/replan";
import { classifierNode } from "./nodes/classifier";
import { memoryRetrievalNode } from "./nodes/memory-retrieval";
import { getCheckpointer } from "@/lib/memory/db";

// ─── Configuration ──────────────────────────────────────────────────────────
const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";

// ─── LLM via OpenCode Zen (OpenAI-compatible) — lazily initialized ──────────
let _llm: ChatOpenAI | null = null;
let _llmModel = "minimax-m2.7";

export function getLLM(model?: string): ChatOpenAI {
  const targetModel = model || _llmModel;
  if (!_llm || targetModel !== _llmModel) {
    _llmModel = targetModel;
    _llm = new ChatOpenAI({
      model: targetModel,
      maxTokens: 64000,
      temperature: 0.1,
      configuration: {
        apiKey: process.env.OPENCODE_API_KEY,
        baseURL: OPENCODE_BASE_URL,
      },
    });
  }
  return _llm;
}

// ─── Register ALL possible tools (for ToolNode execution) ───────────────────
const allTools = getAllPossibleTools();
console.log(
  `[Agent Graph] Registered ${allTools.length} total tools:`,
  allTools.map((t) => t.name).join(", ")
);

// ─── System Prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = new SystemMessage(
  "You are a highly capable autonomous AI agent running natively on an Ubuntu Linux system. " +
  "You have access to tools for terminal execution and web search. " +
  "Additional capabilities are available as skills you can activate by calling use_<skill> tools. " +
  "Destructive operations require human approval before execution. " +
  "For complex tasks, a plan is created before executing. " +
  "Use your tools proactively to accomplish tasks. " +
  "Be concise, helpful, and precise."
);


// ─── Extended State (adds classification field for routing) ─────────────────
const GraphAnnotation = Annotation.Root({
  ...AgentAnnotation.spec,
  classification: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "simple",
  }),
});

// ─── Agent Node (dynamic tool binding based on active skills) ───────────────
async function callModel(state: typeof GraphAnnotation.State, config: RunnableConfig) {
  const { messages, activeSkills, memoryContextText } = state;
  const chatModel = (config?.configurable as Record<string, string> | undefined)?.chatModel;
  const currentTools = getToolsForState(activeSkills);
  const llmWithTools = getLLM(chatModel).bindTools(currentTools);

  // Build system prompt — merge memory context into it so it comes BEFORE user messages
  const systemContent = memoryContextText
    ? `${SYSTEM_PROMPT.content}\n\n${memoryContextText}`
    : String(SYSTEM_PROMPT.content);
  const systemMsg = new SystemMessage(systemContent);

  // Filter out any injected system messages from the memory retrieval node
  // (they'd appear after the user message due to reducer ordering)
  const conversationMessages = messages.filter(
    (m) => !(m._getType() === "system" && typeof m.content === "string" && m.content.includes("[MEMORY CONTEXT"))
  );

  console.log(`[Agent] Invoking model with ${currentTools.length} tools, ${conversationMessages.length} msgs, systemPrompt=${systemContent.length} chars`);

  // Try with tools first; fall back to no-tools if model returns empty
  // (minimax-m2.7 via OpenCode doesn't support OpenAI function calling)
  let response = await llmWithTools.invoke([systemMsg, ...conversationMessages]);

  const isEmpty = !response.content && (!response.tool_calls || response.tool_calls.length === 0);
  if (isEmpty) {
    console.warn(`[Agent] Model returned empty with tools bound — retrying without tools`);
    const llmNoTools = getLLM(chatModel);
    response = await llmNoTools.invoke([systemMsg, ...conversationMessages]);
  }

  const contentLen = typeof response.content === 'string' ? response.content.length : JSON.stringify(response.content).length;
  console.log(`[Agent] Response: ${contentLen} chars, ${response.tool_calls?.length ?? 0} tool calls${isEmpty ? ' (fallback)' : ''}`);
  return { messages: [response] };
}

// ─── Custom Tools Node ──────────────────────────────────────────────────────
// Executes tool calls and detects skill activation placeholders.
// When a use_<skill> placeholder is called, it adds the skill name
// to activeSkills so the next callModel iteration sees the real tools.

const toolNode = new ToolNode(allTools);

async function toolsWithActivation(state: typeof GraphAnnotation.State) {
  const lastMsg = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMsg.tool_calls ?? [];

  // Detect any skill activation calls
  const activatedSkills: string[] = [];
  for (const tc of toolCalls) {
    const skillName = getSkillNameFromPlaceholder(tc.name);
    if (skillName) {
      activatedSkills.push(skillName);
    }
  }

  // Execute all tool calls via the standard ToolNode
  const result = await toolNode.invoke(state);

  // If any skills were activated, update state
  if (activatedSkills.length > 0) {
    return {
      ...result,
      activeSkills: activatedSkills,
    };
  }

  return result;
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

// ─── Conditional Routing: After Replan ──────────────────────────────────
// On "done" or exhausted retries → response is set → __end__
// On "retry" → plan is unchanged (plan[0] = failed step) → executor re-runs it
// On "continue" → plan advanced to next step → executor picks up plan[0]
function afterReplan(state: typeof GraphAnnotation.State) {
  if (state.response) {
    // Task complete or max retries exhausted
    return "__end__";
  }
  if (state.plan.length > 0) {
    return "executor";
  }
  return "__end__";
}

// ─── Build the State Machine ────────────────────────────────────────────────
//
// Phase 4 Topology:
//   START → memoryRetrieval → classifier → (simple: agent ⇄ humanReview → tools → agent → END)
//                                        → (complex: planner → executor → agent ⇄ humanReview → tools → agent → replan → ...)
//

const workflow = new StateGraph(GraphAnnotation)
  // Nodes
  .addNode("memoryRetrieval", memoryRetrievalNode)
  .addNode("classifier", classifierNode)
  .addNode("planner", plannerNode)
  .addNode("executor", executorNode)
  .addNode("agent", callModel)
  .addNode("humanReview", humanReviewNode, {
    ends: ["tools", "agent", "__end__"],
  })
  .addNode("tools", toolsWithActivation)
  .addNode("replan", replanNode)

  // Edges — memoryRetrieval is the new entry point
  .addEdge("__start__", "memoryRetrieval")
  .addEdge("memoryRetrieval", "classifier")
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

// ─── Lazy Async Compiled Graph ───────────────────────────────────────────────
// Compiled once and reused across requests (singleton).
// Using PostgresSaver for durable cross-restart session persistence (Phase 4).
// The humanReview node uses interrupt() which requires a checkpointer.

let _compiledGraph: ReturnType<typeof workflow.compile> | null = null;

export async function getAgentGraph(): Promise<ReturnType<typeof workflow.compile>> {
  if (!_compiledGraph) {
    const checkpointer = await getCheckpointer();
    _compiledGraph = workflow.compile({ checkpointer });
  }
  return _compiledGraph;
}
