"use client";

import { useState } from "react";
import { ShieldAlert, Check, X, Pencil } from "lucide-react";

interface FlaggedCall {
    index: number;
    toolName: string;
    reason?: string;
    args?: Record<string, unknown>;
}

interface ApprovalCardProps {
    flaggedCalls: FlaggedCall[];
    message: string;
    onDecision: (decision: {
        action: "approve" | "reject" | "edit";
        reason?: string;
        newArgs?: Record<string, unknown>;
    }) => void;
    isLoading?: boolean;
}

export default function ApprovalCard({
    flaggedCalls,
    message,
    onDecision,
    isLoading = false,
}: ApprovalCardProps) {
    const [editMode, setEditMode] = useState(false);
    const [editedArgs, setEditedArgs] = useState(
        JSON.stringify(flaggedCalls[0]?.args ?? {}, null, 2)
    );
    const [rejectReason, setRejectReason] = useState("");
    const [showRejectInput, setShowRejectInput] = useState(false);

    return (
        <div className="animate-fade-in border border-amber-500/40 bg-amber-950/20 rounded-xl p-4 space-y-3 max-w-[80%]">
            {/* Header */}
            <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <ShieldAlert size={18} />
                <span>Approval Required</span>
            </div>

            <p className="text-amber-200/80 text-xs">{message}</p>

            {/* Flagged Tool Calls */}
            {flaggedCalls.map((fc, i) => (
                <div
                    key={i}
                    className="bg-neutral-900/80 border border-neutral-700/50 rounded-lg p-3 space-y-2"
                >
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-amber-300 bg-amber-900/30 px-2 py-0.5 rounded">
                            {fc.toolName}
                        </span>
                        {fc.reason && (
                            <span className="text-xs text-neutral-400">
                                — {fc.reason}
                            </span>
                        )}
                    </div>
                    {fc.args && !editMode && (
                        <pre className="text-xs text-neutral-300 bg-neutral-950 rounded p-2 overflow-x-auto max-h-40 font-mono">
                            {JSON.stringify(fc.args, null, 2)}
                        </pre>
                    )}
                </div>
            ))}

            {/* Edit Mode */}
            {editMode && (
                <div className="space-y-2">
                    <label className="text-xs text-neutral-400">
                        Edit tool arguments (JSON):
                    </label>
                    <textarea
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 
                            text-xs font-mono text-neutral-200 focus:outline-none focus:border-amber-500/60 
                            focus:ring-1 focus:ring-amber-500/30 resize-y min-h-[80px]"
                        value={editedArgs}
                        onChange={(e) => setEditedArgs(e.target.value)}
                    />
                </div>
            )}

            {/* Reject Reason Input */}
            {showRejectInput && (
                <div className="space-y-2">
                    <label className="text-xs text-neutral-400">
                        Reason for rejection (optional):
                    </label>
                    <input
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 
                            text-xs text-neutral-200 focus:outline-none focus:border-red-500/60 
                            focus:ring-1 focus:ring-red-500/30"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Why reject this operation?"
                    />
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-1">
                {!showRejectInput && !editMode && (
                    <>
                        <button
                            onClick={() => onDecision({ action: "approve" })}
                            disabled={isLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                                bg-emerald-600 hover:bg-emerald-500 text-neutral-950 
                                transition-all disabled:opacity-40 disabled:cursor-not-allowed
                                shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20"
                        >
                            <Check size={14} />
                            Approve
                        </button>
                        <button
                            onClick={() => setShowRejectInput(true)}
                            disabled={isLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                                bg-red-600 hover:bg-red-500 text-neutral-50 
                                transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <X size={14} />
                            Reject
                        </button>
                        <button
                            onClick={() => setEditMode(true)}
                            disabled={isLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                                bg-amber-600 hover:bg-amber-500 text-neutral-950 
                                transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Pencil size={14} />
                            Edit
                        </button>
                    </>
                )}

                {showRejectInput && (
                    <>
                        <button
                            onClick={() =>
                                onDecision({
                                    action: "reject",
                                    reason: rejectReason || "Rejected by user",
                                })
                            }
                            disabled={isLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                                bg-red-600 hover:bg-red-500 text-neutral-50 
                                transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <X size={14} />
                            Confirm Reject
                        </button>
                        <button
                            onClick={() => {
                                setShowRejectInput(false);
                                setRejectReason("");
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 
                                hover:text-neutral-200 transition-all"
                        >
                            Cancel
                        </button>
                    </>
                )}

                {editMode && (
                    <>
                        <button
                            onClick={() => {
                                try {
                                    const parsed = JSON.parse(editedArgs);
                                    onDecision({
                                        action: "edit",
                                        newArgs: parsed,
                                    });
                                } catch {
                                    alert("Invalid JSON");
                                }
                            }}
                            disabled={isLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                                bg-amber-600 hover:bg-amber-500 text-neutral-950 
                                transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Check size={14} />
                            Apply & Run
                        </button>
                        <button
                            onClick={() => {
                                setEditMode(false);
                                setEditedArgs(
                                    JSON.stringify(
                                        flaggedCalls[0]?.args ?? {},
                                        null,
                                        2
                                    )
                                );
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 
                                hover:text-neutral-200 transition-all"
                        >
                            Cancel
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
