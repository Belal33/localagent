"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, Clock, GitBranch } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EpisodicMemory {
    date: string;
    summary: string;
    relevance: number | null;
}

export interface KnowledgeFact {
    subject: string;
    subjectType: string;
    predicate: string;
    object: string;
    objectType: string;
}

interface MemoryContextProps {
    episodic: EpisodicMemory[];
    knowledge: KnowledgeFact[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MemoryContext({ episodic, knowledge }: MemoryContextProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    const totalItems = episodic.length + knowledge.length;
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
                <div className="px-4 pb-3 space-y-3 border-t border-purple-900/20">
                    {/* Episodic Memories */}
                    {episodic.length > 0 && (
                        <div className="mt-3">
                            <div className="flex items-center gap-1.5 mb-2">
                                <Clock size={12} className="text-purple-400" />
                                <span className="text-[11px] font-medium text-purple-300">
                                    Past Conversations
                                </span>
                            </div>
                            <div className="space-y-1.5">
                                {episodic.map((mem, idx) => (
                                    <div
                                        key={`ep-${idx}`}
                                        className="flex items-start gap-2 text-xs group/item"
                                    >
                                        <span className="text-purple-600 mt-0.5 shrink-0">•</span>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-purple-200/80 leading-relaxed">
                                                {mem.summary}
                                            </span>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[10px] text-purple-500">
                                                    {mem.date}
                                                </span>
                                                {mem.relevance != null && (
                                                    <span className="text-[10px] text-purple-500">
                                                        •{" "}
                                                        <span
                                                            className={
                                                                mem.relevance >= 70
                                                                    ? "text-emerald-400"
                                                                    : mem.relevance >= 40
                                                                        ? "text-amber-400"
                                                                        : "text-purple-400"
                                                            }
                                                        >
                                                            {mem.relevance}% match
                                                        </span>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Knowledge Graph Facts */}
                    {knowledge.length > 0 && (
                        <div className={episodic.length > 0 ? "mt-2" : "mt-3"}>
                            <div className="flex items-center gap-1.5 mb-2">
                                <GitBranch size={12} className="text-purple-400" />
                                <span className="text-[11px] font-medium text-purple-300">
                                    Knowledge Graph
                                </span>
                            </div>
                            <div className="space-y-1.5">
                                {knowledge.map((fact, idx) => (
                                    <div
                                        key={`kg-${idx}`}
                                        className="flex items-center gap-1.5 text-xs flex-wrap"
                                    >
                                        <span className="text-purple-600 shrink-0">•</span>
                                        <span className="text-cyan-300/80 font-medium">
                                            {fact.subject}
                                        </span>
                                        <span className="text-purple-600/60 text-[10px]">
                                            ({fact.subjectType})
                                        </span>
                                        <span className="text-purple-400 text-[10px]">
                                            —[{fact.predicate}]→
                                        </span>
                                        <span className="text-cyan-300/80 font-medium">
                                            {fact.object}
                                        </span>
                                        <span className="text-purple-600/60 text-[10px]">
                                            ({fact.objectType})
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
