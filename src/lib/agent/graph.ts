import {
  StateGraph,
  Annotation,
  END,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
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
const ANTHROPIC_PROXY_URL = process.env.ANTHROPIC_PROXY_URL;

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

// ─── LLM via Antigravity Claude Proxy ───────────────────────────────────────
const llm = new ChatAnthropic({
  // model: "gemini-3-flash",
  // model: "claude-opus-4-6-thinking",
  model: "claude-sonnet-4-6",
  maxTokens: 64000,
  temperature: 0.1,
  apiKey: "not-needed",
  clientOptions: {
    baseURL: ANTHROPIC_PROXY_URL,
  },
});

// ─── Extended State (adds classification field for routing) ─────────────────
const GraphAnnotation = Annotation.Root({
  ...AgentAnnotation.spec,
  classification: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "simple",
  }),
});

// ─── Agent Node (dynamic tool binding based on active skills) ───────────────
async function callModel(state: typeof GraphAnnotation.State) {
  const { messages, activeSkills } = state;
  // Dynamically compute the tools the agent should see
  const currentTools = getToolsForState(activeSkills);
  const llmWithTools = llm.bindTools(currentTools);
  const response = await llmWithTools.invoke([SYSTEM_PROMPT, ...messages]);
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
