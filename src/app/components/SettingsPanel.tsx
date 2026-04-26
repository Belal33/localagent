"use client";

import React, { useEffect, useState } from "react";
import { X, Settings, Cpu, Brain, ChevronDown, Globe, RefreshCw, CheckCircle2, AlertCircle, ShieldCheck, Wrench } from "lucide-react";

export interface ModelSettings {
  chatModel: string;
  plannerModel: string;
}

export interface AgentSkillSettings {
  enabled: boolean;
  tools: Record<string, boolean>;
}

export interface AgentSettings {
  memoryEnabled: boolean;
  systemMessage: string;
  skills: Record<string, AgentSkillSettings>;
  autoApprovalTools: string[];
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  alwaysActive: boolean;
  tools: ToolInfo[];
}

export interface AgentSettingsPayload {
  settings: AgentSettings;
  registry: SkillInfo[];
}

export const GO_MODELS = [
  { id: "minimax-m2.7",     label: "MiniMax M2.7",     note: "Best quality" },
  { id: "minimax-m2.5",     label: "MiniMax M2.5",     note: "Fast & cheap" },
  { id: "deepseek-v4-pro",  label: "DeepSeek V4 Pro",  note: "Top reasoning" },
  { id: "deepseek-v4-flash",label: "DeepSeek V4 Flash",note: "Fast reasoning" },
  { id: "glm-5.1",          label: "GLM-5.1",          note: "High reasoning" },
  { id: "glm-5",            label: "GLM-5",            note: "High reasoning" },
  { id: "kimi-k2.6",        label: "Kimi K2.6",        note: "Long context" },
  { id: "kimi-k2.5",        label: "Kimi K2.5",        note: "Long context" },
  { id: "mimo-v2.5-pro",    label: "MiMo V2.5 Pro",    note: "Code focus" },
  { id: "mimo-v2.5",        label: "MiMo V2.5",        note: "Multimodal" },
  { id: "mimo-v2-pro",      label: "MiMo V2 Pro",      note: "Code focus" },
  { id: "mimo-v2-omni",     label: "MiMo V2 Omni",     note: "Multimodal" },
  { id: "qwen3.6-plus",     label: "Qwen3.6 Plus",     note: "Balanced" },
  { id: "qwen3.5-plus",     label: "Qwen3.5 Plus",     note: "Fast & cheap" },
];

export const DEFAULT_SETTINGS: ModelSettings = {
  chatModel: "mimo-v2-pro",
  plannerModel: "minimax-m2.5",
};

const DEFAULT_AGENT_SYSTEM_MESSAGE =
  "You are a highly capable autonomous AI agent controlled by a Next.js app running on the host Ubuntu system. " +
  "Terminal commands execute inside the isolated agent_app Docker sandbox, not directly on the host. " +
  "Use execute_command for normal shell work in the sandbox; it can proceed automatically when safe. " +
  "Use host_execute_command only when you truly need the user's host terminal/filesystem; it always requires explicit human approval. " +
  "Host desktop/computer-use tools also require human approval before execution. " +
  "You have access to tools for sandbox terminal execution and web search. " +
  "Additional capabilities are available as skills you can activate by calling use_<skill> tools. " +
  "Destructive operations require human approval before execution. " +
  "For complex tasks, a plan is created before executing. " +
  "Use your tools proactively to accomplish tasks. " +
  "Be concise, helpful, and precise.";

const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  memoryEnabled: true,
  systemMessage: DEFAULT_AGENT_SYSTEM_MESSAGE,
  skills: {},
  autoApprovalTools: ["read_file", "list_directory", "web_search", "sandbox_status"],
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

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${checked
        ? "bg-emerald-600 border-emerald-500/60"
        : "bg-neutral-800 border-neutral-700"
        }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-neutral-100 transition-transform ${checked ? "translate-x-4" : "translate-x-1"
          }`}
      />
    </button>
  );
}

// ─── Firefox Profile Section ────────────────────────────────────────────────
function FirefoxProfileSection() {
  const [status, setStatus] = useState<{
    imported: boolean;
    lastImport: string | null;
    hostProfilePath: string;
    discoveredProfile: string | null;
    userDataDir: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; cookiesImported: number; firefoxWarning: string | null }
    | { ok: false; error: string }
    | null
  >(null);

  const refreshStatus = async () => {
    try {
      const res = await fetch("/api/camofox/import-profile");
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const handleImport = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/camofox/import-profile", { method: "POST" });
      const data = await res.json();
      setResult(data);
      await refreshStatus();
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const lastLabel = status?.lastImport
    ? new Date(status.lastImport).toLocaleString()
    : "Never";

  return (
    <section className="space-y-4 pt-2">
      <div>
        <h3 className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1 flex items-center gap-2">
          <Globe size={12} className="text-orange-500" />
          Browser Profile
        </h3>
        <p className="text-xs text-neutral-600">
          Import your real Firefox cookies & logins so the agent can operate your accounts.
        </p>
      </div>

      <div className="bg-neutral-800/40 rounded-lg p-3 border border-neutral-700/40 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">Status</span>
          {status?.imported ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 size={12} /> Imported
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertCircle size={12} /> Not imported
            </span>
          )}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">Last refresh</span>
          <span className="text-neutral-300">{lastLabel}</span>
        </div>
        {status?.discoveredProfile && (
          <div className="flex items-start justify-between text-xs gap-2">
            <span className="text-neutral-500 shrink-0">Profile</span>
            <span className="text-neutral-300 break-all text-right" title={status.discoveredProfile}>
              {status.discoveredProfile}
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleImport}
        disabled={loading}
        className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-orange-600 hover:bg-orange-500
                   text-neutral-950 transition-all disabled:opacity-50 disabled:cursor-not-allowed
                   shadow-lg shadow-orange-500/10 hover:shadow-orange-500/20
                   flex items-center justify-center gap-2"
      >
        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        {loading
          ? "Copying profile…"
          : status?.imported
            ? "Refresh Firefox Data"
            : "Import Firefox Data"}
      </button>

      {result && result.ok && (
        <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-3 text-xs text-emerald-300 space-y-1">
          <p className="font-semibold">✓ Cookies imported</p>
          <p className="text-emerald-400/80">
            {result.cookiesImported} cookies extracted from Firefox and loaded into the agent.
          </p>
          {result.firefoxWarning && (
            <p className="text-amber-400 mt-1">⚠ {result.firefoxWarning}</p>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3 text-xs text-red-300 space-y-1">
          <p className="font-semibold">Import failed</p>
          <p className="text-red-400/80 break-all">{result.error}</p>
        </div>
      )}

      <p className="text-xs text-neutral-600 leading-relaxed">
        Only cookies are extracted — no profile format compatibility issues.
        Close Firefox first for the most complete cookie import.
      </p>
    </section>
  );
}

// ─── Settings Panel ─────────────────────────────────────────────────────────
interface SettingsPanelProps {
  isOpen: boolean;
  settings: ModelSettings;
  agentSettings: AgentSettingsPayload | null;
  agentSettingsLoading: boolean;
  agentSettingsError: string | null;
  onClose: () => void;
  onSave: (settings: ModelSettings) => void;
  onAgentSettingsSave: (settings: AgentSettings) => Promise<void>;
  onAgentSettingsRefresh: () => void;
}

export default function SettingsPanel({
  isOpen,
  settings,
  agentSettings,
  agentSettingsLoading,
  agentSettingsError,
  onClose,
  onSave,
  onAgentSettingsSave,
  onAgentSettingsRefresh,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState<ModelSettings>(settings);
  const [agentDraft, setAgentDraft] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const [savingAgentSettings, setSavingAgentSettings] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings, isOpen]);

  useEffect(() => {
    if (isOpen) onAgentSettingsRefresh();
  }, [isOpen, onAgentSettingsRefresh]);

  useEffect(() => {
    if (agentSettings?.settings) {
      setAgentDraft(agentSettings.settings);
    }
  }, [agentSettings, isOpen]);

  const isDirty =
    draft.chatModel !== settings.chatModel ||
    draft.plannerModel !== settings.plannerModel;

  const agentIsDirty = agentSettings
    ? JSON.stringify(agentDraft) !== JSON.stringify(agentSettings.settings)
    : false;

  const registry = agentSettings?.registry ?? [];
  const allToolNames = registry.flatMap((skill) => skill.tools.map((tool) => tool.name));

  const updateSkillEnabled = (skillName: string, enabled: boolean) => {
    setAgentDraft((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [skillName]: {
          enabled,
          tools: prev.skills[skillName]?.tools ?? {},
        },
      },
    }));
  };

  const updateToolEnabled = (skillName: string, toolName: string, enabled: boolean) => {
    setAgentDraft((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [skillName]: {
          enabled: prev.skills[skillName]?.enabled ?? true,
          tools: {
            ...(prev.skills[skillName]?.tools ?? {}),
            [toolName]: enabled,
          },
        },
      },
    }));
  };

  const updateAutoApproval = (toolName: string, enabled: boolean) => {
    setAgentDraft((prev) => ({
      ...prev,
      autoApprovalTools: enabled
        ? [...new Set([...prev.autoApprovalTools, toolName])]
        : prev.autoApprovalTools.filter((name) => name !== toolName),
    }));
  };

  const handleSave = async () => {
    setSaveError(null);
    if (isDirty) onSave(draft);

    if (agentIsDirty) {
      setSavingAgentSettings(true);
      try {
        await onAgentSettingsSave(agentDraft);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Failed to save agent settings");
        setSavingAgentSettings(false);
        return;
      }
      setSavingAgentSettings(false);
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Slide-in Panel */}
      <aside className="fixed right-0 top-0 h-full w-full sm:w-[34rem] bg-neutral-900 border-l border-neutral-800 z-50 flex flex-col shadow-2xl shadow-black/50 animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-950/60 border border-emerald-900/40 flex items-center justify-center">
              <Settings size={14} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-100">Settings</h2>
              <p className="text-xs text-neutral-600">Agent Control Panel</p>
            </div>
          </div>
          <button
            type="button"
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

          <div className="border-t border-neutral-800" />

          <section className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1 flex items-center gap-2">
                  <Brain size={12} className="text-purple-400" />
                  Memory
                </h3>
                <p className="text-xs text-neutral-600">
                  Controls retrieval and background distillation for future context.
                </p>
              </div>
              <Toggle
                checked={agentDraft.memoryEnabled}
                disabled={agentSettingsLoading || !agentSettings}
                onChange={(checked) => setAgentDraft((prev) => ({ ...prev, memoryEnabled: checked }))}
              />
            </div>
          </section>

          <div className="border-t border-neutral-800" />

          <section className="space-y-4">
            <div>
              <h3 className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1 flex items-center gap-2">
                <Wrench size={12} className="text-sky-400" />
                Skills & Tools
              </h3>
              <p className="text-xs text-neutral-600">
                Disable a whole skill or individual tools so the agent cannot attach them.
              </p>
            </div>

            {agentSettingsLoading && !agentSettings && (
              <p className="text-xs text-neutral-500">Loading agent tools...</p>
            )}

            {agentSettingsError && (
              <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3 text-xs text-red-300">
                {agentSettingsError}
              </div>
            )}

            <div className="space-y-3">
              {registry.map((skill) => {
                const skillDraft = agentDraft.skills[skill.name];
                const skillEnabled = skillDraft?.enabled ?? true;
                return (
                  <div key={skill.name} className="bg-neutral-800/40 rounded-lg border border-neutral-700/40 p-3 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-neutral-200 font-semibold">{skill.name}</p>
                          {skill.alwaysActive && (
                            <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-950/50 border border-emerald-900/50 rounded-full px-2 py-0.5">
                              Core
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-600 mt-1 leading-relaxed">{skill.description}</p>
                      </div>
                      <Toggle
                        checked={skillEnabled}
                        disabled={agentSettingsLoading || !agentSettings}
                        onChange={(checked) => updateSkillEnabled(skill.name, checked)}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {skill.tools.map((tool) => {
                        const toolEnabled = skillDraft?.tools?.[tool.name] ?? true;
                        return (
                          <label
                            key={tool.name}
                            className={`flex items-start gap-2 rounded-md border p-2 transition-colors ${skillEnabled
                              ? "bg-neutral-900/60 border-neutral-700/50"
                              : "bg-neutral-950/50 border-neutral-800 opacity-50"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={toolEnabled}
                              disabled={!skillEnabled || agentSettingsLoading || !agentSettings}
                              onChange={(e) => updateToolEnabled(skill.name, tool.name, e.target.checked)}
                              className="mt-0.5 accent-emerald-500"
                            />
                            <span className="min-w-0">
                              <span className="block text-xs text-neutral-300 font-semibold break-all">{tool.name}</span>
                              <span className="block text-[11px] text-neutral-600 leading-relaxed line-clamp-2">{tool.description}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="border-t border-neutral-800" />

          <section className="space-y-4">
            <div>
              <h3 className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1 flex items-center gap-2">
                <ShieldCheck size={12} className="text-amber-400" />
                Auto Approval Whitelist
              </h3>
              <p className="text-xs text-neutral-600">
                Tools checked here can run without a human approval card unless they are host-only approval tools.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {allToolNames.map((toolName) => (
                <label key={toolName} className="flex items-center gap-2 rounded-md bg-neutral-800/40 border border-neutral-700/40 p-2 text-xs text-neutral-300">
                  <input
                    type="checkbox"
                    checked={agentDraft.autoApprovalTools.includes(toolName)}
                    disabled={agentSettingsLoading || !agentSettings}
                    onChange={(e) => updateAutoApproval(toolName, e.target.checked)}
                    className="accent-emerald-500"
                  />
                  <span className="break-all">{toolName}</span>
                </label>
              ))}
            </div>
          </section>

          <div className="border-t border-neutral-800" />

          <section className="space-y-3">
            <div>
              <h3 className="text-xs text-neutral-500 uppercase tracking-widest font-semibold mb-1">
                Agent System Message
              </h3>
              <p className="text-xs text-neutral-600">
                Saved in <code className="text-neutral-500">src/app/agent-settings.json</code> and applied to the next agent call.
              </p>
            </div>
            <textarea
              value={agentDraft.systemMessage}
              disabled={agentSettingsLoading || !agentSettings}
              onChange={(e) => setAgentDraft((prev) => ({ ...prev, systemMessage: e.target.value }))}
              className="w-full min-h-44 resize-y rounded-lg bg-neutral-950 border border-neutral-700/60 px-3 py-2 text-xs text-neutral-200 leading-relaxed focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20 disabled:opacity-50"
            />
          </section>

          <div className="border-t border-neutral-800" />

          <FirefoxProfileSection />

          {saveError && (
            <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3 text-xs text-red-300">
              {saveError}
            </div>
          )}

          {/* Info */}
          <div className="bg-neutral-800/50 rounded-lg p-3 border border-neutral-700/40 space-y-1">
            <p className="text-xs text-neutral-400 font-semibold">OpenCode Go Plan</p>
            <p className="text-xs text-neutral-600 leading-relaxed">
              14 models · $10/mo · Up to $60/mo usage · Changes apply to the next
              message.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-neutral-800 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-neutral-400 bg-neutral-800 hover:bg-neutral-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={(!isDirty && !agentIsDirty) || savingAgentSettings}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500
                       text-neutral-950 transition-all disabled:opacity-40 disabled:cursor-not-allowed
                       shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20"
          >
            {savingAgentSettings ? "Saving..." : "Save"}
          </button>
        </div>
      </aside>
    </>
  );
}
