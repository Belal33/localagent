"use client";

import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { Send, TerminalSquare, User, Cpu } from "lucide-react";

export default function AgentInterface() {
  // Generate a stable thread ID per session for LangGraph memory
  // Initialized client-side only to avoid SSR hydration mismatch
  const [threadId, setThreadId] = useState("");

  useEffect(() => {
    setThreadId(
      `thread_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    );
  }, []);

  // Manual input state (v6 pattern)
  const [input, setInput] = useState("");

  const { messages, sendMessage, status } = useChat({
    transport: new TextStreamChatTransport({
      api: "/api/chat",
      body: { threadId },
    }),
  });

  const isLoading = status === "streaming" || status === "submitted";

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom as tokens stream in
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      sendMessage({ text: input });
      setInput("");
    }
  };

  // Extract text from message parts (v6 pattern)
  const getMessageText = (message: (typeof messages)[number]) => {
    return message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("");
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
                Phase 1
              </span>
            </h1>
            <p className="text-xs text-neutral-500 mt-1 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Engine: LangGraph + Ollama (deepseek-r1:7b)
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <Cpu size={14} />
            <span>Local Inference</span>
          </div>
        </div>
      </header>

      {/* ─── Chat Transcript Area ────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-950/50 border border-emerald-900/30 flex items-center justify-center">
                <TerminalSquare size={28} className="text-emerald-500/70" />
              </div>
              <div className="text-center">
                <p className="text-neutral-400 text-sm">
                  System initialized. Awaiting input.
                </p>
                <p className="text-neutral-600 text-xs mt-1">
                  Thread: <code className="text-neutral-500">{threadId}</code>
                </p>
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-3 animate-fade-in ${m.role === "user" ? "justify-end" : "justify-start"
                }`}
            >
              {m.role !== "user" && (
                <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-900/40 flex items-center justify-center shrink-0 mt-0.5">
                  <TerminalSquare className="text-emerald-500" size={16} />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 ${m.role === "user"
                  ? "bg-neutral-800/80 text-neutral-200 border border-neutral-700/50"
                  : "bg-emerald-950/20 text-emerald-50 border border-emerald-900/30"
                  }`}
              >
                <div className="whitespace-pre-wrap leading-relaxed text-sm">
                  {getMessageText(m)}
                </div>
              </div>
              {m.role === "user" && (
                <div className="w-8 h-8 rounded-lg bg-neutral-800 border border-neutral-700/50 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="text-blue-400" size={16} />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-3 text-emerald-500 text-sm animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-900/40 flex items-center justify-center">
                <TerminalSquare size={16} className="animate-pulse" />
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
        <form onSubmit={handleSubmit} className="flex gap-3 max-w-4xl mx-auto">
          <input
            ref={inputRef}
            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 
              focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 
              transition-all duration-200 text-sm placeholder:text-neutral-600"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Initialize command sequence..."
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
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
    </div>
  );
}
