"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Send, TerminalSquare, User, Cpu, Settings } from "lucide-react";
import MarkdownRenderer from "./components/MarkdownRenderer";
import ApprovalCard from "./components/ApprovalCard";
import PlanDisplay from "./components/PlanDisplay";
import ActivityLog, { type ActivityItem } from "./components/ActivityLog";
import MemoryContext, { type EpisodicMemory, type KnowledgeFact } from "./components/MemoryContext";
import SettingsPanel, { type ModelSettings, DEFAULT_SETTINGS, GO_MODELS } from "./components/SettingsPanel";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface PlanStep {
  text: string;
  status: "pending" | "running" | "done";
}

interface InterruptData {
  type: string;
  flaggedCalls: Array<{
    index: number;
    toolName: string;
    reason?: string;
    args?: Record<string, unknown>;
  }>;
  message: string;
}

// ─── NDJSON Event Types ─────────────────────────────────────────────────────

type StreamEvent =
  | { type: "token"; content: string }
  | { type: "interrupt"; data: InterruptData }
  | { type: "plan"; steps: string[] }
  | { type: "step_status"; step: string; status: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown>; id: string }
  | { type: "tool_result"; tool: string; output: string; id: string }
  | { type: "node_start"; node: string }
  | { type: "memory"; episodic: EpisodicMemory[]; knowledge: KnowledgeFact[] }
  | { type: "done" }
  | { type: "error"; message: string };

// ─── NDJSON Stream Reader ───────────────────────────────────────────────────

async function* readNDJSON(
  response: Response
): AsyncGenerator<StreamEvent> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as StreamEvent;
      } catch {
        console.warn("Failed to parse NDJSON line:", trimmed);
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim()) as StreamEvent;
    } catch {
      console.warn("Failed to parse final NDJSON:", buffer.trim());
    }
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function AgentInterface() {
  // Thread ID for LangGraph memory
  const [threadId, setThreadId] = useState("");
  useEffect(() => {
    setThreadId(
      `thread_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    );
  }, []);

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [interrupt, setInterrupt] = useState<InterruptData | null>(null);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [memoryEpisodic, setMemoryEpisodic] = useState<EpisodicMemory[]>([]);
  const [memoryKnowledge, setMemoryKnowledge] = useState<KnowledgeFact[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettings>(DEFAULT_SETTINGS);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, interrupt, planSteps, activityItems]);

  // Focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ─── Process NDJSON Stream ──────────────────────────────────
  const processStream = useCallback(
    async (response: Response) => {
      let assistantId = `msg_${Date.now()}`;
      let assistantContent = "";

      // Add empty assistant message to start streaming into
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      for await (const event of readNDJSON(response)) {
        switch (event.type) {
          case "token":
            assistantContent += event.content;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: assistantContent }
                  : m
              )
            );
            break;

          case "plan":
            setPlanSteps(
              event.steps.map((text) => ({
                text,
                status: "pending" as const,
              }))
            );
            break;

          case "step_status":
            setPlanSteps((prev) =>
              prev.map((s) =>
                s.text === event.step
                  ? { ...s, status: event.status as PlanStep["status"] }
                  : s
              )
            );
            break;

          case "tool_call":
            setActivityItems((prev) => [
              ...prev,
              {
                id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                timestamp: Date.now(),
                type: "tool_call",
                tool: event.tool,
                args: event.args,
                callId: event.id,
              },
            ]);
            break;

          case "tool_result":
            setActivityItems((prev) => [
              ...prev,
              {
                id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                timestamp: Date.now(),
                type: "tool_result",
                tool: event.tool,
                output: event.output,
                callId: event.id,
              },
            ]);
            break;

          case "node_start":
            setActivityItems((prev) => [
              ...prev,
              {
                id: `ns_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                timestamp: Date.now(),
                type: "node_start",
                node: event.node,
              },
            ]);
            break;

          case "memory":
            setMemoryEpisodic(event.episodic);
            setMemoryKnowledge(event.knowledge);
            break;

          case "interrupt":
            setInterrupt(event.data);
            setIsLoading(false);
            // Remove empty assistant message if no content yet
            if (!assistantContent) {
              setMessages((prev) =>
                prev.filter((m) => m.id !== assistantId)
              );
            }
            return; // Pause — user must approve/reject

          case "error":
            assistantContent += `\n\n⚠️ Error: ${event.message}`;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: assistantContent }
                  : m
              )
            );
            break;

          case "done":
            break;
        }
      }

      // Remove empty assistant message if no tokens were received
      if (!assistantContent) {
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantId)
        );
      }

      setIsLoading(false);
      // Clear plan if all steps are done
      if (planSteps.length > 0 && planSteps.every((s) => s.status === "done")) {
        setTimeout(() => setPlanSteps([]), 2000);
      }
    },
    [planSteps]
  );

  // ─── Send Message ───────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setInterrupt(null);
    setPlanSteps([]);
    setActivityItems([]);
    setMemoryEpisodic([]);
    setMemoryKnowledge([]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          threadId,
          chatModel: modelSettings.chatModel,
          plannerModel: modelSettings.plannerModel,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await processStream(response);
    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "assistant",
          content: `⚠️ Failed to connect: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
      setIsLoading(false);
    }
  };

  // ─── Handle HITL Decision ───────────────────────────────────
  const handleApprovalDecision = async (decision: {
    action: "approve" | "reject" | "edit";
    reason?: string;
    newArgs?: Record<string, unknown>;
  }) => {
    setInterrupt(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, decision }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await processStream(response);
    } catch (err) {
      console.error("Resume error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "assistant",
          content: `⚠️ Resume failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-50 font-mono selection:bg-emerald-500/30">
      {/* ─── Header ──────────────────────────────────────────────── */}
      <header className="py-4 px-6 border-b border-neutral-800/80 bg-neutral-900/80 backdrop-blur-md shadow-lg shadow-black/20">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-emerald-400 flex items-center gap-2.5 tracking-tight">
              <TerminalSquare size={22} className="text-emerald-500" />
              Local AI Core
              <span className="text-xs font-normal tracking-wide text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded-full">
                Phase 4
              </span>
            </h1>
            <p className="text-xs text-neutral-500 mt-1 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Engine: LangGraph + Cognitive Orchestration
            </p>
          </div>
          <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <Cpu size={14} />
                <span>{GO_MODELS.find(m => m.id === modelSettings.chatModel)?.label ?? modelSettings.chatModel}</span>
              </div>
              <button
                id="settings-btn"
                onClick={() => setSettingsOpen(true)}
                className="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/50 flex items-center justify-center transition-colors"
                title="Settings"
              >
                <Settings size={15} className="text-neutral-400" />
              </button>
            </div>
        </div>
      </header>

      {/* ─── Chat Transcript Area ────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-950/50 border border-emerald-900/30 flex items-center justify-center">
                <TerminalSquare
                  size={28}
                  className="text-emerald-500/70"
                />
              </div>
              <div className="text-center">
                <p className="text-neutral-400 text-sm">
                  System initialized. Awaiting input.
                </p>
                <p className="text-neutral-600 text-xs mt-1">
                  Thread:{" "}
                  <code className="text-neutral-500">
                    {threadId}
                  </code>
                </p>
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-3 animate-fade-in ${m.role === "user"
                ? "justify-end"
                : "justify-start"
                }`}
            >
              {m.role !== "user" && (
                <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-900/40 flex items-center justify-center shrink-0 mt-0.5">
                  <TerminalSquare
                    className="text-emerald-500"
                    size={16}
                  />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 ${m.role === "user"
                  ? "bg-neutral-800/80 text-neutral-200 border border-neutral-700/50"
                  : "bg-emerald-950/20 text-emerald-50 border border-emerald-900/30"
                  }`}
              >
                {m.role === "assistant" ? (
                  <MarkdownRenderer content={m.content} />
                ) : (
                  <div className="whitespace-pre-wrap leading-relaxed text-sm">
                    {m.content}
                  </div>
                )}
              </div>
              {m.role === "user" && (
                <div className="w-8 h-8 rounded-lg bg-neutral-800 border border-neutral-700/50 flex items-center justify-center shrink-0 mt-0.5">
                  <User
                    className="text-blue-400"
                    size={16}
                  />
                </div>
              )}
            </div>
          ))}

          {/* Memory Context */}
          {(memoryEpisodic.length > 0 || memoryKnowledge.length > 0) && (
            <div className="flex gap-3 justify-start animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-purple-950/60 border border-purple-900/40 flex items-center justify-center shrink-0 mt-0.5">
                <TerminalSquare
                  className="text-purple-400"
                  size={16}
                />
              </div>
              <MemoryContext episodic={memoryEpisodic} knowledge={memoryKnowledge} />
            </div>
          )}

          {/* Plan Display */}
          {planSteps.length > 0 && (
            <div className="flex gap-3 justify-start animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-900/40 flex items-center justify-center shrink-0 mt-0.5">
                <TerminalSquare
                  className="text-emerald-500"
                  size={16}
                />
              </div>
              <PlanDisplay steps={planSteps} />
            </div>
          )}

          {/* Activity Log */}
          {activityItems.length > 0 && (
            <div className="flex gap-3 justify-start animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-neutral-800/60 border border-neutral-700/40 flex items-center justify-center shrink-0 mt-0.5">
                <TerminalSquare
                  className="text-neutral-400"
                  size={16}
                />
              </div>
              <ActivityLog items={activityItems} />
            </div>
          )}

          {/* HITL Approval Card */}
          {interrupt && (
            <div className="flex gap-3 justify-start animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-amber-950/60 border border-amber-900/40 flex items-center justify-center shrink-0 mt-0.5">
                <TerminalSquare
                  className="text-amber-500"
                  size={16}
                />
              </div>
              <ApprovalCard
                flaggedCalls={interrupt.flaggedCalls}
                message={interrupt.message}
                onDecision={handleApprovalDecision}
                isLoading={isLoading}
              />
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && !interrupt && (
            <div className="flex items-center gap-3 text-emerald-500 text-sm animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-900/40 flex items-center justify-center">
                <TerminalSquare
                  size={16}
                  className="animate-pulse"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="text-emerald-400/70">
                  Computing response...
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* ─── Input Area ──────────────────────────────────────────── */}
      <footer className="p-4 border-t border-neutral-800/80 bg-neutral-900/80 backdrop-blur-md">
        <form
          onSubmit={handleSubmit}
          className="flex gap-3 max-w-4xl mx-auto"
        >
          <input
            ref={inputRef}
            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 
                            focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 
                            transition-all duration-200 text-sm placeholder:text-neutral-600"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Initialize command sequence..."
            disabled={isLoading || !!interrupt}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim() || !!interrupt}
            className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-neutral-950 
                            px-5 py-3 rounded-xl font-bold transition-all duration-200 
                            disabled:opacity-40 disabled:cursor-not-allowed 
                            flex items-center gap-2 text-sm shadow-lg shadow-emerald-500/10 
                            hover:shadow-emerald-500/20"
          >
            <Send size={16} />
            Send
          </button>
        </form>
      </footer>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={settingsOpen}
        settings={modelSettings}
        onClose={() => setSettingsOpen(false)}
        onSave={(s) => setModelSettings(s)}
      />
    </div>
  );
}
