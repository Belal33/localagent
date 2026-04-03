"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, Clock, Eye, MessageSquare } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemoryItem {
    text: string;
    score: number | null;
    source: string;
}

export interface EpisodicMemory {
    date: string;
    summary: string;
}

interface MemoryContextProps {
    memories: MemoryItem[];
    episodes: EpisodicMemory[];
    contextText: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MemoryContext({ memories, episodes, contextText }: MemoryContextProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showRaw, setShowRaw] = useState(false);

    const totalItems = memories.length + episodes.length;
    if (totalItems === 0) return null;

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
                    {totalItems} {totalItems === 1 ? "item" : "items"}
                </span>
                <span className="ml-auto text-purple-500 group-hover:text-purple-400 transition-colors">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
            </button>

            {/* ─── Expanded Content ───────────────────────────────────────── */}
            {isExpanded && (
                <div className="px-4 pb-3 border-t border-purple-900/20">
                    {/* Toggle tabs */}
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
                        /* ─── Raw Injected Context ───────────────────────────── */
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
                        <div className="space-y-3 mt-1">
                            {/* ─── Episodic Memories (Past Conversations) ──── */}
                            {episodes.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <Clock size={12} className="text-purple-400" />
                                        <span className="text-[11px] font-medium text-purple-300">
                                            Past Conversations
                                        </span>
                                    </div>
                                    <div className="space-y-1.5">
                                        {episodes.map((ep, idx) => (
                                            <div
                                                key={`ep-${idx}`}
                                                className="flex items-start gap-2 text-xs group/item"
                                            >
                                                <span className="text-purple-600 mt-0.5 shrink-0">•</span>
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-purple-200/80 leading-relaxed">
                                                        {ep.summary}
                                                    </span>
                                                    <div className="mt-0.5">
                                                        <span className="text-[10px] text-purple-500">
                                                            {ep.date}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* ─── Knowledge Facts ───────────────────────────── */}
                            {memories.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <MessageSquare size={12} className="text-purple-400" />
                                        <span className="text-[11px] font-medium text-purple-300">
                                            Known Facts
                                        </span>
                                    </div>
                                    <div className="space-y-1.5">
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
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
