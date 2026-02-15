"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ClipboardList } from "lucide-react";

interface PlanStep {
    text: string;
    status: "pending" | "running" | "done";
}

interface PlanDisplayProps {
    steps: PlanStep[];
}

const STATUS_ICON: Record<string, string> = {
    pending: "⏳",
    running: "🔄",
    done: "✅",
};

export default function PlanDisplay({ steps }: PlanDisplayProps) {
    const [expanded, setExpanded] = useState(false);

    if (steps.length === 0) return null;

    const doneCount = steps.filter((s) => s.status === "done").length;
    const runningStep = steps.find((s) => s.status === "running");

    return (
        <div className="animate-fade-in border border-blue-500/30 bg-blue-950/15 rounded-xl overflow-hidden max-w-[80%]">
            {/* Collapsed Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left 
                    hover:bg-blue-950/30 transition-all duration-200"
            >
                <ClipboardList size={16} className="text-blue-400 shrink-0" />
                <span className="text-sm font-bold text-blue-300">
                    Plan ({doneCount}/{steps.length} steps)
                </span>
                {runningStep && (
                    <span className="text-xs text-blue-400/60 truncate flex-1">
                        — {runningStep.text}
                    </span>
                )}
                <span className="text-blue-400/50 shrink-0 transition-transform duration-200">
                    {expanded ? (
                        <ChevronDown size={16} />
                    ) : (
                        <ChevronRight size={16} />
                    )}
                </span>
            </button>

            {/* Expanded Steps */}
            <div
                className={`transition-all duration-300 ease-in-out overflow-hidden ${expanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
                    }`}
            >
                <div className="px-4 pb-3 pt-1 space-y-1.5 border-t border-blue-900/30">
                    {steps.map((step, i) => (
                        <div
                            key={i}
                            className={`flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 transition-all duration-300 ${step.status === "running"
                                    ? "bg-blue-900/20 border border-blue-800/30"
                                    : step.status === "done"
                                        ? "opacity-60"
                                        : ""
                                }`}
                        >
                            <span className="shrink-0 w-5 text-center">
                                {STATUS_ICON[step.status]}
                            </span>
                            <span className="text-neutral-300">
                                <span className="text-neutral-500 font-mono mr-1.5">
                                    {i + 1}.
                                </span>
                                {step.text}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
