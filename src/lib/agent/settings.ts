import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface SkillSettings {
    enabled: boolean;
    tools: Record<string, boolean>;
}

export interface AgentSettings {
    memoryEnabled: boolean;
    systemMessage: string;
    skills: Record<string, SkillSettings>;
    autoApprovalTools: string[];
}

export const DEFAULT_SYSTEM_MESSAGE =
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

export const DEFAULT_AUTO_APPROVAL_TOOLS = [
    "read_file",
    "list_directory",
    "web_search",
    "sandbox_status",
];

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
    memoryEnabled: true,
    systemMessage: DEFAULT_SYSTEM_MESSAGE,
    skills: {},
    autoApprovalTools: DEFAULT_AUTO_APPROVAL_TOOLS,
};

export const AGENT_SETTINGS_PATH = process.env.AGENT_SETTINGS_PATH
    ? path.resolve(process.env.AGENT_SETTINGS_PATH)
    : path.join(process.cwd(), "src", "app", "agent-settings.json");

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSkillSettings(value: unknown): SkillSettings | null {
    if (!isRecord(value)) return null;

    const rawTools = isRecord(value.tools) ? value.tools : {};
    const tools: Record<string, boolean> = {};
    for (const [toolName, enabled] of Object.entries(rawTools)) {
        if (typeof toolName === "string" && typeof enabled === "boolean") {
            tools[toolName] = enabled;
        }
    }

    return {
        enabled: typeof value.enabled === "boolean" ? value.enabled : true,
        tools,
    };
}

export function normalizeAgentSettings(value: unknown): AgentSettings {
    if (!isRecord(value)) return { ...DEFAULT_AGENT_SETTINGS };

    const skills: Record<string, SkillSettings> = {};
    if (isRecord(value.skills)) {
        for (const [skillName, skillValue] of Object.entries(value.skills)) {
            const normalized = normalizeSkillSettings(skillValue);
            if (normalized) skills[skillName] = normalized;
        }
    }

    const autoApprovalTools = Array.isArray(value.autoApprovalTools)
        ? [...new Set(value.autoApprovalTools.filter((tool): tool is string => typeof tool === "string" && tool.length > 0))]
        : DEFAULT_AUTO_APPROVAL_TOOLS;

    return {
        memoryEnabled: typeof value.memoryEnabled === "boolean"
            ? value.memoryEnabled
            : DEFAULT_AGENT_SETTINGS.memoryEnabled,
        systemMessage: typeof value.systemMessage === "string" && value.systemMessage.trim().length > 0
            ? value.systemMessage
            : DEFAULT_SYSTEM_MESSAGE,
        skills,
        autoApprovalTools,
    };
}

export function getAgentSettingsSync(): AgentSettings {
    try {
        if (!existsSync(AGENT_SETTINGS_PATH)) {
            writeAgentSettingsSync(DEFAULT_AGENT_SETTINGS);
            return { ...DEFAULT_AGENT_SETTINGS };
        }

        const raw = readFileSync(AGENT_SETTINGS_PATH, "utf8");
        return normalizeAgentSettings(JSON.parse(raw));
    } catch (error) {
        console.warn("[Agent Settings] Failed to read settings, using defaults:", error);
        return { ...DEFAULT_AGENT_SETTINGS };
    }
}

export function writeAgentSettingsSync(settings: AgentSettings): AgentSettings {
    const normalized = normalizeAgentSettings(settings);
    mkdirSync(path.dirname(AGENT_SETTINGS_PATH), { recursive: true });

    const tempPath = `${AGENT_SETTINGS_PATH}.tmp`;
    writeFileSync(tempPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
    renameSync(tempPath, AGENT_SETTINGS_PATH);

    return normalized;
}
