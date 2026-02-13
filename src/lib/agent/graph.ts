import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
} from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { SystemMessage } from "@langchain/core/messages";

// ─── Configuration ──────────────────────────────────────────────────────────
// Change the model name here to swap models easily.
const MODEL_NAME = "deepseek-r1:7b";
const OLLAMA_BASE_URL = "http://localhost:11434";

// ─── LLM Initialization ────────────────────────────────────────────────────
const llm = new ChatOllama({
  model: MODEL_NAME,
  baseUrl: OLLAMA_BASE_URL,
  temperature: 0.1, // Low temp for deterministic agent behavior
});

// ─── System Prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = new SystemMessage(
  "You are a highly capable autonomous AI agent running natively on an Ubuntu Linux system. " +
    "You are currently in Phase 1 of your initialization — the Core Scaffolding phase. " +
    "You have access to a local LLM via Ollama, orchestrated through LangGraph. " +
    "Be concise, helpful, and precise. Acknowledge your local environment when relevant."
);

// ─── Agent Node ─────────────────────────────────────────────────────────────
async function callModel(state: typeof MessagesAnnotation.State) {
  const { messages } = state;

  // Prepend the system prompt + forward the full conversation history
  const response = await llm.invoke([SYSTEM_PROMPT, ...messages]);

  // LangGraph's messages reducer automatically appends the response
  return { messages: [response] };
}

// ─── Graph Construction ─────────────────────────────────────────────────────
// Phase 1: Simple START → agent → END pipeline
// Phase 2 will add conditional routing to a Tools node here.
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addEdge("__start__", "agent")
  .addEdge("agent", "__end__");

// ─── Memory (Checkpointer) ─────────────────────────────────────────────────
// MemorySaver provides in-memory thread-level persistence.
// Phase 4 will swap this with PostgresSaver + pgvector.
const checkpointer = new MemorySaver();

// ─── Compile & Export ───────────────────────────────────────────────────────
export const agentGraph = workflow.compile({ checkpointer });
