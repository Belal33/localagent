import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { coreSkill } from "./core";
import { filesystemSkill } from "./filesystem";
import { camofoxSkill } from "./camofox";
import { scrapingSkill } from "./scraping";
import { gnomeSkill } from "./gnome";
import { getAgentSettingsSync, type AgentSettings } from "../settings";

/**
 * ─── Skill Registry ─────────────────────────────────────────────────────────
 *
 * Skills are groups of related tools that can be activated/deactivated.
 * The "core" skill is always active — it provides the fundamental
 * capabilities the agent needs to operate.
 *
 * Inactive skills appear to the agent as a single placeholder tool
 * (e.g. `use_filesystem`). When the agent calls it, the system activates
 * the skill's real tools for subsequent iterations.
 */

export interface Skill {
    name: string;
    description: string;
    tools: DynamicStructuredTool[];
    alwaysActive: boolean;
    /**
     * Optional hook called every time the skill is (re)activated via its
     * `use_<name>` placeholder. Use this to reset any in-memory resources
     * the skill holds (e.g. close stale browser sessions) so each fresh
     * activation starts from a clean slate.
     */
    onActivate?: () => Promise<string | void>;
}

// ─── Skill Registry ─────────────────────────────────────────────────────────
// Add more skills here as needed (e.g., coding, research, data analysis)

const allSkills: Skill[] = [coreSkill, filesystemSkill, camofoxSkill, scrapingSkill, gnomeSkill];

// ─── Placeholder Tool Prefix ────────────────────────────────────────────────
const PLACEHOLDER_PREFIX = "use_";

function resolveSettings(settings?: AgentSettings): AgentSettings {
    return settings ?? getAgentSettingsSync();
}

function isSkillEnabled(skill: Skill, settings: AgentSettings): boolean {
    return settings.skills[skill.name]?.enabled ?? true;
}

function getEnabledToolsForSkill(skill: Skill, settings: AgentSettings): DynamicStructuredTool[] {
    const toolSettings = settings.skills[skill.name]?.tools ?? {};
    return skill.tools.filter((tool) => toolSettings[tool.name] !== false);
}

function createSkillPlaceholderTool(skill: Skill, settings?: AgentSettings): DynamicStructuredTool {
    const effectiveSettings = resolveSettings(settings);
    const enabledTools = getEnabledToolsForSkill(skill, effectiveSettings);

    return new DynamicStructuredTool({
        name: `${PLACEHOLDER_PREFIX}${skill.name}`,
        description:
            `Activate the "${skill.name}" skill to gain access to its tools. ` +
            `${skill.description} ` +
            `Tools included: ${enabledTools.map((t) => t.name).join(", ") || "none"}. ` +
            `Call this tool when you need any of these capabilities.`,
        schema: z.object({}),
        func: async () => {
            const latestSettings = getAgentSettingsSync();
            if (!isSkillEnabled(skill, latestSettings)) {
                return `Skill "${skill.name}" is disabled in agent settings.`;
            }

            const latestEnabledTools = getEnabledToolsForSkill(skill, latestSettings);
            if (latestEnabledTools.length === 0) {
                return `Skill "${skill.name}" has no enabled tools in agent settings.`;
            }

            const toolNames = latestEnabledTools.map((t) => t.name).join(", ");
            let extra = "";
            if (skill.onActivate) {
                try {
                    const r = await skill.onActivate();
                    if (typeof r === "string" && r) extra = ` ${r}`;
                } catch (err) {
                    console.warn(
                        `[skills] onActivate hook for "${skill.name}" failed:`,
                        err,
                    );
                }
            }
            return (
                `✅ Skill "${skill.name}" activated! ` +
                `You now have access to: ${toolNames}.${extra} ` +
                `Use these tools directly in your next action.`
            );
        },
    });
}

/**
 * Returns all tools from always-active skills.
 */
export function getActiveTools(settings?: AgentSettings): DynamicStructuredTool[] {
    const effectiveSettings = resolveSettings(settings);
    return allSkills
        .filter((skill) => skill.alwaysActive && isSkillEnabled(skill, effectiveSettings))
        .flatMap((skill) => getEnabledToolsForSkill(skill, effectiveSettings));
}

/**
 * Returns the list of all registered skills with their metadata.
 */
export function getSkillRegistry(): Skill[] {
    return allSkills;
}

/**
 * For each inactive skill, creates a placeholder `DynamicStructuredTool`
 * named `use_{skill.name}`. The agent sees this tool with the skill's
 * description and can call it to activate the skill.
 */
export function getSkillPlaceholderTools(settings?: AgentSettings): DynamicStructuredTool[] {
    const effectiveSettings = resolveSettings(settings);
    return allSkills
        .filter((skill) => (
            !skill.alwaysActive &&
            isSkillEnabled(skill, effectiveSettings) &&
            getEnabledToolsForSkill(skill, effectiveSettings).length > 0
        ))
        .map((skill) => createSkillPlaceholderTool(skill, effectiveSettings));
}

/**
 * Returns the complete set of tools the agent should see, given
 * the current list of activated skill names.
 *
 * - Always-active skill tools are always included
 * - Activated skill tools replace their placeholder
 * - Still-inactive skills appear as placeholder tools
 */
export function getToolsForState(activeSkillNames: string[], settings?: AgentSettings): DynamicStructuredTool[] {
    const effectiveSettings = resolveSettings(settings);
    const tools: DynamicStructuredTool[] = [];

    for (const skill of allSkills) {
        if (!isSkillEnabled(skill, effectiveSettings)) continue;

        const enabledTools = getEnabledToolsForSkill(skill, effectiveSettings);
        if (enabledTools.length === 0) continue;

        if (skill.alwaysActive || activeSkillNames.includes(skill.name)) {
            tools.push(...enabledTools);
        } else {
            tools.push(createSkillPlaceholderTool(skill, effectiveSettings));
        }
    }

    return tools;
}

/**
 * Returns ALL possible tools (active + inactive real tools + placeholders).
 * Used to register with ToolNode so it can execute any tool call.
 */
export function getAllPossibleTools(options: {
    settings?: AgentSettings;
    respectSettings?: boolean;
} = {}): DynamicStructuredTool[] {
    if (options.respectSettings === false) {
        const realTools = allSkills.flatMap((skill) => skill.tools);
        const placeholders = allSkills
            .filter((skill) => !skill.alwaysActive)
            .map((skill) => createSkillPlaceholderTool(skill));
        return [...realTools, ...placeholders];
    }

    const effectiveSettings = resolveSettings(options.settings);
    const realTools = allSkills
        .filter((skill) => isSkillEnabled(skill, effectiveSettings))
        .flatMap((skill) => getEnabledToolsForSkill(skill, effectiveSettings));
    const placeholders = getSkillPlaceholderTools(effectiveSettings);
    return [...realTools, ...placeholders];
}

export function getEnabledToolNames(settings?: AgentSettings): Set<string> {
    return new Set(getAllPossibleTools({ settings, respectSettings: true }).map((tool) => tool.name));
}

/**
 * Checks if a tool name is a skill placeholder (starts with "use_").
 * Returns the skill name if it is, or null otherwise.
 */
export function getSkillNameFromPlaceholder(toolName: string, settings?: AgentSettings): string | null {
    if (!toolName.startsWith(PLACEHOLDER_PREFIX)) return null;
    const skillName = toolName.slice(PLACEHOLDER_PREFIX.length);
    const skill = allSkills.find((s) => s.name === skillName);
    if (!skill) return null;

    const effectiveSettings = resolveSettings(settings);
    if (!isSkillEnabled(skill, effectiveSettings)) return null;
    if (getEnabledToolsForSkill(skill, effectiveSettings).length === 0) return null;

    return skillName;
}
