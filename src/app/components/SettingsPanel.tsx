"use client";

import React, { useEffect, useState } from "react";
import { X, Settings, Cpu, Brain, ChevronDown } from "lucide-react";

export interface ModelSettings {
  chatModel: string;
  plannerModel: string;
}

export const GO_MODELS = [
  { id: "minimax-m2.7",  label: "MiniMax M2.7",  note: "Best quality" },
  { id: "minimax-m2.5",  label: "MiniMax M2.5",  note: "Fast & cheap" },
  { id: "glm-5",         label: "GLM-5",          note: "High reasoning" },
  { id: "kimi-k2.5",    label: "Kimi K2.5",      note: "Long context" },
  { id: "mimo-v2-pro",   label: "MiMo V2 Pro",   note: "Code focus" },
  { id: "mimo-v2-omni",  label: "MiMo V2 Omni",  note: "Multimodal" },
];

export const DEFAULT_SETTINGS: ModelSettings = {
  chatModel: "minimax-m2.7",
  plannerModel: "minimax-m2.5",
};

// ─── Model Select Field ─────────────────────────────────────────────────────
function ModelSelect({
  id,
  label,
  icon: Icon,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  icon: React.ElementType;
  description: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const selected = GO_MODELS.find((m) => m.id === value);
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="flex items-center gap-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest"
      >
        <Icon size={13} className="text-emerald-500" />
        {label}
      </label>
      <p className="text-xs text-neutral-600">{description}</p>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-neutral-900 border border-neutral-700/60 rounded-lg px-4 py-2.5 pr-10 text-sm text-neutral-200
                     focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20 transition-all cursor-pointer"
        >
          {GO_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.note}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
        />
      </div>
      {selected && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-500/70">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
          <span>{selected.label} selected</span>
        </div>
      )}
    </div>
  );
}

// ─── Settings Panel ─────────────────────────────────────────────────────────
interface SettingsPanelProps {
  isOpen: boolean;
  settings: ModelSettings;
  onClose: () => void;
  onSave: (settings: ModelSettings) => void;
}

export default function SettingsPanel({
  isOpen,
  settings,
  onClose,
  onSave,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState<ModelSettings>(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings, isOpen]);

  const isDirty =
    draft.chatModel !== settings.chatModel ||
    draft.plannerModel !== settings.plannerModel;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Slide-in Panel */}
      <aside className="fixed right-0 top-0 h-full w-80 bg-neutral-900 border-l border-neutral-800 z-50 flex flex-col shadow-2xl shadow-black/50 animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-950/60 border border-emerald-900/40 flex items-center justify-center">
              <Settings size={14} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-100">Settings</h2>
              <p className="text-xs text-neutral-600">OpenCode Go · Model Config</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center transition-colors"
          >
            <X size={14} className="text-neutral-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <section className="space-y-5">
            <div>
              <h3 className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1">
                Language Models
              </h3>
              <p className="text-xs text-neutral-600">
                All models via OpenCode Go plan (
                <code className="text-neutral-500">opencode.ai/zen/go/v1</code>)
              </p>
            </div>

            <ModelSelect
              id="chat-model"
              label="Chat Model"
              icon={Cpu}
              description="Used by the main agent for reasoning and responses."
              value={draft.chatModel}
              onChange={(v) => setDraft((p) => ({ ...p, chatModel: v }))}
            />

            <div className="border-t border-neutral-800" />

            <ModelSelect
              id="planner-model"
              label="Planner / Memory Model"
              icon={Brain}
              description="Used for task planning, classification, and memory distillation. A faster model is recommended."
              value={draft.plannerModel}
              onChange={(v) => setDraft((p) => ({ ...p, plannerModel: v }))}
            />
          </section>

          {/* Info */}
          <div className="bg-neutral-800/50 rounded-lg p-3 border border-neutral-700/40 space-y-1">
            <p className="text-xs text-neutral-400 font-semibold">OpenCode Go Plan</p>
            <p className="text-xs text-neutral-600 leading-relaxed">
              6 models · $10/mo · Up to $60/mo usage · Changes apply to the next
              message.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-neutral-800 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-neutral-400 bg-neutral-800 hover:bg-neutral-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            disabled={!isDirty}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500
                       text-neutral-950 transition-all disabled:opacity-40 disabled:cursor-not-allowed
                       shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20"
          >
            Save
          </button>
        </div>
      </aside>
    </>
  );
}
