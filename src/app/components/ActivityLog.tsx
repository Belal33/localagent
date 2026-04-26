"use client";

import { useState } from "react";
import {
    ChevronDown,
    ChevronRight,
    Terminal,
    CheckCircle2,
    Loader2,
    Wrench,
    GitBranch,
    Zap,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActivityItem {
    id: string;
    timestamp: number;
    type: "tool_call" | "tool_result" | "node_start";
    // tool_call
    tool?: string;
    args?: Record<string, unknown>;
    callId?: string;
    // tool_result
    output?: string;
    // node_start
    node?: string;
    // screenshot attachment (set on the matching tool_call)
    screenshotUrl?: string;
    screenshotName?: string;
}

interface ActivityLogProps {
    items: ActivityItem[];
}

// ─── Friendly Node Labels ───────────────────────────────────────────────────

const NODE_LABELS: Record<string, string> = {
    classifier: "🧭 Classifying request",
    planner: "📋 Creating plan",
    executor: "🎯 Preparing next step",
    agent: "🤖 Thinking",
    humanReview: "🛡️ Safety check",
    tools: "⚙️ Executing tool",
    replan: "🔄 Evaluating progress",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function ActivityLog({ items }: ActivityLogProps) {
    const [expanded, setExpanded] = useState(true);
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

    if (items.length === 0) return null;

    const toggleItem = (id: string) => {
        setExpandedItems((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Group tool_call + tool_result by callId
    const latestNode = items.filter((i) => i.type === "node_start").at(-1);
    const toolCalls = items.filter((i) => i.type === "tool_call");
    const completedTools = items.filter((i) => i.type === "tool_result").length;

    return (
        <div className="animate-fade-in border border-neutral-700/40 bg-neutral-900/40 rounded-xl overflow-hidden max-w-[80%]">
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left 
                    hover:bg-neutral-800/40 transition-all duration-200"
            >
                <Terminal size={14} className="text-neutral-400 shrink-0" />
                <span className="text-xs font-bold text-neutral-300">
                    Activity
                </span>
                <span className="text-xs text-neutral-500">
                    {toolCalls.length > 0 && `${completedTools}/${toolCalls.length} tools`}
                    {latestNode && toolCalls.length > 0 && " · "}
                    {latestNode && (NODE_LABELS[latestNode.node!] || latestNode.node)}
                </span>
                <span className="ml-auto text-neutral-500 shrink-0">
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
            </button>

            {/* Activity Items */}
            <div
                className={`transition-all duration-300 ease-in-out overflow-hidden ${expanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                    }`}
            >
                <div className="px-3 pb-3 pt-1 space-y-0.5 border-t border-neutral-800/50 overflow-y-auto max-h-[500px] custom-scrollbar">
                    {items.map((item) => {
                        const isExpanded = expandedItems.has(item.id);

                        if (item.type === "node_start") {
                            return (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-2 px-2 py-1 text-[11px] text-neutral-500"
                                >
                                    <GitBranch size={10} className="shrink-0" />
                                    <span>{NODE_LABELS[item.node!] || item.node}</span>
                                </div>
                            );
                        }

                        if (item.type === "tool_call") {
                            const hasResult = items.some(
                                (r) => r.type === "tool_result" && r.callId === item.callId
                            );
                            const isSkillActivation = item.tool?.startsWith("use_");

                            return (
                                <div key={item.id} className="group">
                                    <button
                                        onClick={() => toggleItem(item.id)}
                                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg
                                            transition-all text-left ${isSkillActivation
                                                ? "hover:bg-violet-500/10 border border-violet-500/20 bg-violet-500/5"
                                                : "hover:bg-neutral-800/50"
                                            }`}
                                    >
                                        {hasResult ? (
                                            <CheckCircle2 size={12} className={isSkillActivation ? "text-violet-400 shrink-0" : "text-emerald-500 shrink-0"} />
                                        ) : (
                                            <Loader2 size={12} className={isSkillActivation ? "text-violet-400 shrink-0 animate-spin" : "text-amber-400 shrink-0 animate-spin"} />
                                        )}
                                        {isSkillActivation ? (
                                            <Zap size={11} className="text-violet-400 shrink-0" />
                                        ) : (
                                            <Wrench size={11} className="text-neutral-500 shrink-0" />
                                        )}
                                        <span className={`text-xs font-mono ${isSkillActivation ? "text-violet-300" : "text-neutral-300"
                                            }`}>
                                            {item.tool}
                                        </span>
                                        {isSkillActivation && (
                                            <span className="text-[9px] font-bold uppercase tracking-widest 
                                                px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">
                                                skill
                                            </span>
                                        )}
                                        <span className="text-[10px] text-neutral-600 truncate flex-1">
                                            {summarizeArgs(item.args)}
                                        </span>
                                        <span className="text-neutral-600 shrink-0">
                                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                        </span>
                                    </button>

                                    {isExpanded && (
                                        <div className="ml-7 mr-2 mb-1 space-y-1 animate-fade-in">
                                            {item.args && !isSkillActivation && (
                                                <div>
                                                    <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
                                                        Args
                                                    </span>
                                                    <pre className="text-[11px] text-neutral-400 bg-neutral-950/80 rounded-lg p-2 
                                                        overflow-x-auto max-h-32 font-mono mt-0.5">
                                                        {JSON.stringify(item.args, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                            {item.screenshotUrl && (
                                                <div>
                                                    <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
                                                        Screenshot
                                                    </span>
                                                    <a
                                                        href={item.screenshotUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="block mt-0.5 rounded-lg overflow-hidden border border-neutral-800 hover:border-neutral-600 transition-colors bg-neutral-950/80"
                                                        title={item.screenshotName || "Open screenshot"}
                                                    >
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src={item.screenshotUrl}
                                                            alt={item.screenshotName || "screenshot"}
                                                            className="max-h-64 w-auto block"
                                                        />
                                                    </a>
                                                </div>
                                            )}
                                            {/* Show matching result if exists */}
                                            {items
                                                .filter(
                                                    (r) =>
                                                        r.type === "tool_result" &&
                                                        r.callId === item.callId
                                                )
                                                .map((result) => (
                                                    <div key={result.id}>
                                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isSkillActivation ? "text-violet-500" : "text-neutral-500"
                                                            }`}>
                                                            {isSkillActivation ? "Activated" : "Output"}
                                                        </span>
                                                        <pre className={`text-[11px] bg-neutral-950/80 rounded-lg p-2 
                                                            overflow-x-auto max-h-48 font-mono mt-0.5 whitespace-pre-wrap ${isSkillActivation ? "text-violet-300/80" : "text-emerald-400/80"
                                                            }`}>
                                                            {result.output}
                                                        </pre>
                                                    </div>
                                                ))}
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        // tool_result without matching tool_call (fallback)
                        if (item.type === "tool_result" && !items.some(
                            (tc) => tc.type === "tool_call" && tc.callId === item.callId
                        )) {
                            return (
                                <div key={item.id}>
                                    <button
                                        onClick={() => toggleItem(item.id)}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg
                                            hover:bg-neutral-800/50 transition-all text-left"
                                    >
                                        <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                                        <span className="text-xs font-mono text-neutral-300">
                                            {item.tool} result
                                        </span>
                                        <span className="text-neutral-600 shrink-0">
                                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                        </span>
                                    </button>
                                    {isExpanded && (
                                        <div className="ml-7 mr-2 mb-1 space-y-1 animate-fade-in">
                                            {item.screenshotUrl && (
                                                <a
                                                    href={item.screenshotUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block rounded-lg overflow-hidden border border-neutral-800 hover:border-neutral-600 transition-colors bg-neutral-950/80"
                                                    title={item.screenshotName || "Open screenshot"}
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={item.screenshotUrl}
                                                        alt={item.screenshotName || "screenshot"}
                                                        className="max-h-64 w-auto block"
                                                    />
                                                </a>
                                            )}
                                            <pre className="text-[11px] text-emerald-400/80 bg-neutral-950/80 rounded-lg p-2 
                                                overflow-x-auto max-h-48 font-mono whitespace-pre-wrap">
                                                {item.output}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        return null;
                    })}
                </div>
            </div>
        </div>
    );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function summarizeArgs(args?: Record<string, unknown>): string {
    if (!args) return "";
    const entries = Object.entries(args);
    if (entries.length === 0) return "";

    // Show first meaningful arg value
    const [key, val] = entries[0];
    const str = typeof val === "string" ? val : JSON.stringify(val);
    const preview = str.length > 60 ? str.slice(0, 60) + "…" : str;
    return `${key}: ${preview}`;
}
