import {
  StateGraph,
  Annotation,
  END,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI, ChatOpenAICompletions } from "@langchain/openai";
import { SystemMessage, AIMessage, ToolMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import { readFile } from "node:fs/promises";
import type { OpenAI } from "openai";
import { extractWorkspaceScreenshotPath, mimeTypeForImage } from "./screenshot-artifacts";

import {
  getToolsForState,
  getAllPossibleTools,
  getSkillNameFromPlaceholder,
  getEnabledToolNames,
} from "./skills";
import { AgentAnnotation } from "./state";
import { humanReviewNode } from "./nodes/human-review";
import { plannerNode } from "./nodes/planner";
import { executorNode } from "./nodes/executor";
import { replanNode } from "./nodes/replan";
import { classifierNode } from "./nodes/classifier";
import { memoryRetrievalNode } from "./nodes/memory-retrieval";
import { getCheckpointer } from "@/lib/memory/db";
import { DEFAULT_SYSTEM_MESSAGE, getAgentSettingsSync } from "./settings";

// ─── Configuration ──────────────────────────────────────────────────────────
const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";
const DEEPSEEK_MODELS = new Set(["deepseek-v4-pro", "deepseek-v4-flash"]);
const DEFAULT_CHAT_MODEL = "mimo-v2-pro";
const DEFAULT_VISION_MODEL = "mimo-v2-omni";
const MULTIMODAL_MODELS = new Set(["mimo-v2.5", "mimo-v2-omni"]);

// ─── LLM via OpenCode Zen (OpenAI-compatible) — lazily initialized ──────────
let _llm: ChatOpenAI | null = null;
let _llmModel = DEFAULT_CHAT_MODEL;

class DeepSeekChatOpenAICompletions extends ChatOpenAICompletions {
  private activeMessages: BaseMessage[] = [];

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    this.activeMessages = messages;
    try {
      return await super._generate(messages, options, runManager);
    } finally {
      this.activeMessages = [];
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): ReturnType<ChatOpenAICompletions["_streamResponseChunks"]> {
    this.activeMessages = messages;
    try {
      return yield* super._streamResponseChunks(messages, options, runManager);
    } finally {
      this.activeMessages = [];
    }
  }

  completionWithRetry(
    request: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    requestOptions?: OpenAI.RequestOptions
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>;
  completionWithRetry(
    request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    requestOptions?: OpenAI.RequestOptions
  ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
  async completionWithRetry(
    request:
      | OpenAI.Chat.ChatCompletionCreateParamsStreaming
      | OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    requestOptions?: OpenAI.RequestOptions
  ): Promise<
    | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    | OpenAI.Chat.Completions.ChatCompletion
  > {
    this.attachReasoningContent(request as unknown as Record<string, unknown>);
    return super.completionWithRetry(request as never, requestOptions as never);
  }

  private attachReasoningContent(request: Record<string, unknown>) {
    if (!Array.isArray(request.messages)) return;

    const sourceAssistantMessages = this.activeMessages.filter(
      (message): message is AIMessage => AIMessage.isInstance(message)
    );
    const outboundAssistantMessages = request.messages.filter(
      (message): message is Record<string, unknown> =>
        typeof message === "object" && message !== null && message.role === "assistant"
    );

    for (let i = 0; i < outboundAssistantMessages.length; i += 1) {
      const reasoningContent = sourceAssistantMessages[i]?.additional_kwargs?.reasoning_content;
      if (typeof reasoningContent === "string" && reasoningContent.length > 0) {
        outboundAssistantMessages[i].reasoning_content = reasoningContent;
      }
    }
  }
}

export function getLLM(model?: string): ChatOpenAI {
  const targetModel = model || _llmModel;
  if (!_llm || targetModel !== _llmModel) {
    _llmModel = targetModel;
    const fields = {
      model: targetModel,
      maxTokens: 64000,
      temperature: 0.1,
      configuration: {
        apiKey: process.env.OPENCODE_API_KEY,
        baseURL: OPENCODE_BASE_URL,
      },
    };
    const llm = new ChatOpenAI({
      ...fields,
      ...(DEEPSEEK_MODELS.has(targetModel)
        ? { completions: new DeepSeekChatOpenAICompletions(fields) }
        : {}),
    });
    _llm = llm;
  }
  return _llm;
}

function isMultimodalModel(model?: string): boolean {
  return !!model && MULTIMODAL_MODELS.has(model);
}

function messageHasImageContent(message: BaseMessage): boolean {
  if (!Array.isArray(message.content)) return false;
  return message.content.some((block) => (
    typeof block === "object" &&
    block !== null &&
    "type" in block &&
    block.type === "image_url"
  ));
}

// ─── Register ALL possible tools (for ToolNode execution) ───────────────────
const allTools = getAllPossibleTools({ respectSettings: false });
console.log(
  `[Agent Graph] Registered ${allTools.length} total tools:`,
  allTools.map((t) => t.name).join(", ")
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
  const { messages, activeSkills, memoryContextText, plan, currentStep, pastSteps } = state;
  const settings = getAgentSettingsSync();
  const requestedChatModel = (config?.configurable as Record<string, string> | undefined)?.chatModel;
  const hasScreenshotImage = messages.some(messageHasImageContent);
  const chatModel = hasScreenshotImage && !isMultimodalModel(requestedChatModel)
    ? DEFAULT_VISION_MODEL
    : requestedChatModel;
  const currentTools = getToolsForState(activeSkills, settings);
  const llmWithTools = getLLM(chatModel).bindTools(currentTools);

  // Build system prompt — merge memory context + (if planning) step focus.
  const parts: string[] = [settings.systemMessage || DEFAULT_SYSTEM_MESSAGE];

  if (memoryContextText) {
    parts.push(memoryContextText);
  }

  // ─── Step-focus block: only present when executing a plan ─────────────────
  // This keeps the model committed to the current step even in long histories.
  if (currentStep && plan.length > 0) {
    const remainingSteps = plan.slice(1);
    const completedText =
      pastSteps.length > 0
        ? pastSteps.map(([s], i) => `  ${i + 1}. [done] ${s}`).join("\n")
        : "  (none yet)";
    const remainingText =
      remainingSteps.length > 0
        ? remainingSteps.map((s, i) => `  ${pastSteps.length + 2 + i}. ${s}`).join("\n")
        : "  (none)";

    parts.push(
      `[CURRENT PLAN EXECUTION]\n` +
      `You are executing a multi-step plan. Focus on ONLY the current step.\n\n` +
      `Completed steps:\n${completedText}\n\n` +
      `➡ CURRENT STEP (step ${pastSteps.length + 1}): ${currentStep}\n\n` +
      `Upcoming steps (DO NOT address yet):\n${remainingText}\n\n` +
      `Rules:\n` +
      `- Use tools to actually perform the current step. Do not describe, plan, or summarize in prose when a tool is appropriate.\n` +
      `- Do NOT attempt upcoming steps in the same turn.\n` +
      `- After the step's tools succeed, reply with a short one-line confirmation of what you did — nothing more.\n` +
      `- If the step is not achievable with the available tools, say so briefly and stop.`
    );
  }

  if (hasScreenshotImage) {
    parts.push(
      `[SCREENSHOT IMAGE ATTACHED]\n` +
      `A screenshot image has been attached as an image_url content block in the conversation. ` +
      `Inspect the attached image directly. Do not use read_file on PNG/JPEG/WebP screenshots; binary image files are not useful as text. ` +
      `If the user asked what is on screen, answer from the attached image unless additional non-visual details are required.`
    );
  }

  const systemContent = parts.join("\n\n");
  const systemMsg = new SystemMessage(systemContent);

  // Filter out any injected system messages from the memory retrieval node
  // (they'd appear after the user message due to reducer ordering)
  const conversationMessages = messages.filter(
    (m) => !(m._getType() === "system" && typeof m.content === "string" && m.content.includes("[MEMORY CONTEXT"))
  );

  console.log(`[Agent] Invoking model ${chatModel || DEFAULT_CHAT_MODEL}${hasScreenshotImage ? " (vision)" : ""} with ${currentTools.length} tools, ${conversationMessages.length} msgs, systemPrompt=${systemContent.length} chars${currentStep ? `, step="${currentStep.slice(0, 60)}"` : ''}`);

  // Try with tools first; fall back to no-tools if model returns empty
  // (minimax-m2.7 via OpenCode doesn't support OpenAI function calling)
  let response;
  let parseRecovered = false;
  try {
    response = await llmWithTools.invoke([systemMsg, ...conversationMessages]);
  } catch (err: unknown) {
    // minimax-m2.7 sometimes emits a bogus "[TOOL_CALL]...[/TOOL_CALL]" text
    // block instead of real OpenAI function calls, which triggers
    // OUTPUT_PARSING_FAILURE. Retry with a stricter instruction.
    const e = err as { lc_error_code?: string; message?: string; llmOutput?: string };
    const isParseError =
      e?.lc_error_code === "OUTPUT_PARSING_FAILURE" ||
      /Failed to parse/i.test(e?.message ?? "");
    if (!isParseError) throw err;

    console.warn(`[Agent] OUTPUT_PARSING_FAILURE caught — retrying with stricter prompt. Offending output: ${(e.llmOutput ?? "").slice(0, 200)}`);

    const stricterSystem = new SystemMessage(
      systemContent +
      `\n\n[TOOL CALL FORMAT — STRICT]\n` +
      `Your previous response used an invalid tool-call format and was rejected.\n` +
      `DO NOT emit text like "[TOOL_CALL]...[/TOOL_CALL]" or pseudo-JSON with "=>".\n` +
      `You have two — and only two — valid options for this turn:\n` +
      `  1. Call a tool using the native function-calling API (no custom text markers).\n` +
      `  2. Reply with plain prose only (no tool syntax at all).\n` +
      `If the model cannot make a real tool call, prefer option 2 and describe what you would do.`
    );

    try {
      response = await llmWithTools.invoke([stricterSystem, ...conversationMessages]);
      parseRecovered = true;
    } catch (retryErr) {
      // Final fallback: no tools bound at all — guaranteed plain text response.
      console.warn(`[Agent] Retry with stricter prompt also failed — falling back to plain-text (no tools)`);
      const llmNoTools = getLLM(chatModel);
      response = await llmNoTools.invoke([stricterSystem, ...conversationMessages]);
      parseRecovered = true;
    }
  }

  const isEmpty = !response.content && (!response.tool_calls || response.tool_calls.length === 0);
  if (isEmpty) {
    console.warn(`[Agent] Model returned empty with tools bound — retrying without tools`);
    const llmNoTools = getLLM(chatModel);
    response = await llmNoTools.invoke([systemMsg, ...conversationMessages]);
  }

  const contentLen = typeof response.content === 'string' ? response.content.length : JSON.stringify(response.content).length;
  console.log(`[Agent] Response: ${contentLen} chars, ${response.tool_calls?.length ?? 0} tool calls${isEmpty ? ' (fallback)' : ''}${parseRecovered ? ' (parse-recovered)' : ''}`);
  return { messages: [response] };
}

// ─── Custom Tools Node ──────────────────────────────────────────────────────
// Executes tool calls and detects skill activation placeholders.
// When a use_<skill> placeholder is called, it adds the skill name
// to activeSkills so the next callModel iteration sees the real tools.

const toolNode = new ToolNode(allTools);

type MultimodalToolContent = Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
>;

async function appendScreenshotImageMessages(
  toolCalls: NonNullable<AIMessage["tool_calls"]>,
  messages: ToolMessage[]
): Promise<BaseMessage[]> {
  const toolCallIds = new Set(
    toolCalls.map((tc) => tc.id).filter((id): id is string => typeof id === "string")
  );

  if (toolCallIds.size === 0) return messages;

  const output: BaseMessage[] = [...messages];

  for (const message of messages) {
    if (!toolCallIds.has(message.tool_call_id)) continue;
    if (typeof message.content !== "string") continue;

    const imagePath = extractWorkspaceScreenshotPath(message.content);
    if (!imagePath) continue;

    try {
      const buffer = await readFile(imagePath);
      const mimeType = mimeTypeForImage(imagePath);
      if (!mimeType) continue;
      const content: MultimodalToolContent = [
        {
          type: "text",
          text: "Inspect this screenshot image and use it to answer the user's request about what is on screen.",
        },
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` },
        },
      ];

      output.push(new HumanMessage({ content }));
    } catch (error) {
      output.push(
        new ToolMessage({
          content: `${message.content}\n\nCould not attach screenshot image for vision: ${error instanceof Error ? error.message : String(error)}`,
          tool_call_id: message.tool_call_id,
          name: message.name,
          status: message.status,
          artifact: message.artifact,
          metadata: message.metadata,
        })
      );
    }
  }

  return output;
}

async function toolsWithActivation(state: typeof GraphAnnotation.State) {
  const lastMsg = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMsg.tool_calls ?? [];
  const settings = getAgentSettingsSync();

  console.log(`[Tools] ▶ ENTRY — ${toolCalls.length} tool call(s): ${toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.args).slice(0, 80)})`).join(", ")}`);

  const enabledToolNames = getEnabledToolNames(settings);
  const disabledCalls = toolCalls.filter((tc) => !enabledToolNames.has(tc.name));
  if (disabledCalls.length > 0) {
    return {
      messages: disabledCalls.map((tc) => new ToolMessage({
        tool_call_id: tc.id ?? "unknown",
        name: tc.name,
        content: `Tool "${tc.name}" is disabled in agent settings and was not executed.`,
      })),
    };
  }

  // Detect any skill activation calls
  const activatedSkills: string[] = [];
  for (const tc of toolCalls) {
    const skillName = getSkillNameFromPlaceholder(tc.name, settings);
    if (skillName) {
      activatedSkills.push(skillName);
    }
  }

  // Execute all tool calls via the standard ToolNode
  let result;
  try {
    result = await toolNode.invoke(state);
  } catch (err) {
    console.error(`[Tools] ✗ ToolNode.invoke THREW:`, err);
    throw err;
  }

  const resultMsgs = await appendScreenshotImageMessages(
    toolCalls,
    (result as { messages?: ToolMessage[] })?.messages ?? []
  );
  console.log(`[Tools] ◀ EXIT — produced ${resultMsgs.length} ToolMessage(s), activatedSkills=[${activatedSkills.join(",")}]`);

  // If any skills were activated, update state
  if (activatedSkills.length > 0) {
    return {
      ...result,
      messages: resultMsgs,
      activeSkills: activatedSkills,
    };
  }

  return {
    ...result,
    messages: resultMsgs,
  };
}

// ─── Conditional Routing: After Agent ───────────────────────────────────────
function afterAgent(state: typeof GraphAnnotation.State) {
  const { messages } = state;
  // Find the most recent AI message. Using messages[last] is unsafe because
  // other nodes (historically the memory-retrieval node) may append their
  // own messages via the reducer AFTER the agent's response.
  let lastAi: AIMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?._getType?.() === "ai") {
      lastAi = messages[i] as AIMessage;
      break;
    }
  }
  const hasToolCalls = !!lastAi?.tool_calls?.length;
  const inPlan = state.plan.length > 0;
  const decision = hasToolCalls ? "humanReview" : (inPlan ? "replan" : "__end__");
  const tailType = messages[messages.length - 1]?._getType?.();
  console.log(`[Router afterAgent] tail.type=${tailType}, lastAi.tool_calls=${lastAi?.tool_calls?.length ?? 0}, plan.length=${state.plan.length} → ${decision}`);
  if (hasToolCalls) {
    return "humanReview";
  }
  if (inPlan) {
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
