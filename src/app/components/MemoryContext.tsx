"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, Eye, MessageSquare } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemoryItem {
    text: string;
    score: number | null;
    source: string;
}

interface MemoryContextProps {
    memories: MemoryItem[];
    contextText: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MemoryContext({ memories, contextText }: MemoryContextProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showRaw, setShowRaw] = useState(false);

    if (memories.length === 0) return null;

    return (
        <div className="w-full max-w-[80%] rounded-xl border border-purple-900/40 bg-purple-950/15 overflow-hidden animate-fade-in">
            {/* ─── Header (always visible, clickable) ─────────────────────── */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left 
                   hover:bg-purple-900/10 transition-colors duration-200 group"
            >
                <Brain size={14} className="text-purple-400 shrink-0" />
                <span className="text-xs font-semibold text-purple-300 tracking-wide uppercase">
                    Memory Context
                </span>
                <span className="text-[10px] text-purple-500 bg-purple-900/30 px-1.5 py-0.5 rounded-full">
                    {memories.length} {memories.length === 1 ? "recall" : "recalls"}
                </span>
                <span className="ml-auto text-purple-500 group-hover:text-purple-400 transition-colors">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
            </button>

            {/* ─── Expanded Content ───────────────────────────────────────── */}
            {isExpanded && (
                <div className="px-4 pb-3 border-t border-purple-900/20">
                    {/* Toggle between structured view and raw agent view */}
                    <div className="flex items-center gap-2 mt-3 mb-2">
                        <button
                            onClick={() => setShowRaw(false)}
                            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors ${
                                !showRaw
                                    ? "bg-purple-900/40 text-purple-200 font-medium"
                                    : "text-purple-500 hover:text-purple-300"
                            }`}
                        >
                            <MessageSquare size={11} />
                            Memories
                        </button>
                        <button
                            onClick={() => setShowRaw(true)}
                            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors ${
                                showRaw
                                    ? "bg-purple-900/40 text-purple-200 font-medium"
                                    : "text-purple-500 hover:text-purple-300"
                            }`}
                        >
                            <Eye size={11} />
                            What Agent Sees
                        </button>
                    </div>

                    {showRaw ? (
                        /* ─── Raw Injected Context (exactly what the agent gets) ── */
                        <div className="mt-1">
                            <pre className="text-[11px] leading-relaxed text-purple-200/70 bg-purple-950/40 
                                          border border-purple-900/30 rounded-lg p-3 font-mono whitespace-pre-wrap 
                                          overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar">
                                {contextText || "No context injected"}
                            </pre>
                            <p className="text-[10px] text-purple-600 mt-1.5 italic">
                                This text is injected as a HumanMessage before the classifier node processes the query.
                            </p>
                        </div>
                    ) : (
                        /* ─── Structured Memory List ─────────────────────────── */
                        <div className="space-y-2 mt-1">
                            {memories.map((mem, idx) => (
                                <div
                                    key={`mem-${idx}`}
                                    className="flex items-start gap-2 text-xs group/item"
                                >
                                    <span className="text-purple-600 mt-0.5 shrink-0">•</span>
                                    <div className="flex-1 min-w-0">
                                        <span className="text-purple-200/80 leading-relaxed">
                                            {mem.text}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
