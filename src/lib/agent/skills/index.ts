import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { coreSkill } from "./core";
import { filesystemSkill } from "./filesystem";

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
}

// ─── Skill Registry ─────────────────────────────────────────────────────────
// Add more skills here as needed (e.g., coding, research, data analysis)

const allSkills: Skill[] = [coreSkill, filesystemSkill];

// ─── Placeholder Tool Prefix ────────────────────────────────────────────────
const PLACEHOLDER_PREFIX = "use_";

/**
 * Returns all tools from always-active skills.
 */
export function getActiveTools(): DynamicStructuredTool[] {
    return allSkills
        .filter((skill) => skill.alwaysActive)
        .flatMap((skill) => skill.tools);
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
export function getSkillPlaceholderTools(): DynamicStructuredTool[] {
    return allSkills
        .filter((skill) => !skill.alwaysActive)
        .map(
            (skill) =>
                new DynamicStructuredTool({
                    name: `${PLACEHOLDER_PREFIX}${skill.name}`,
                    description:
                        `Activate the "${skill.name}" skill to gain access to its tools. ` +
                        `${skill.description} ` +
                        `Tools included: ${skill.tools.map((t) => t.name).join(", ")}. ` +
                        `Call this tool when you need any of these capabilities.`,
                    schema: z.object({}),
                    func: async () => {
                        const toolNames = skill.tools.map((t) => t.name).join(", ");
                        return (
                            `✅ Skill "${skill.name}" activated! ` +
                            `You now have access to: ${toolNames}. ` +
                            `Use these tools directly in your next action.`
                        );
                    },
                })
        );
}

/**
 * Returns the complete set of tools the agent should see, given
 * the current list of activated skill names.
 *
 * - Always-active skill tools are always included
 * - Activated skill tools replace their placeholder
 * - Still-inactive skills appear as placeholder tools
 */
export function getToolsForState(activeSkillNames: string[]): DynamicStructuredTool[] {
    const tools: DynamicStructuredTool[] = [];

    for (const skill of allSkills) {
        if (skill.alwaysActive || activeSkillNames.includes(skill.name)) {
            // Include the real tools
            tools.push(...skill.tools);
        } else {
            // Include the placeholder tool
            const placeholder = getSkillPlaceholderTools().find(
                (t) => t.name === `${PLACEHOLDER_PREFIX}${skill.name}`
            );
            if (placeholder) tools.push(placeholder);
        }
    }

    return tools;
}

/**
 * Returns ALL possible tools (active + inactive real tools + placeholders).
 * Used to register with ToolNode so it can execute any tool call.
 */
export function getAllPossibleTools(): DynamicStructuredTool[] {
    const realTools = allSkills.flatMap((skill) => skill.tools);
    const placeholders = getSkillPlaceholderTools();
    return [...realTools, ...placeholders];
}

/**
 * Checks if a tool name is a skill placeholder (starts with "use_").
 * Returns the skill name if it is, or null otherwise.
 */
export function getSkillNameFromPlaceholder(toolName: string): string | null {
    if (!toolName.startsWith(PLACEHOLDER_PREFIX)) return null;
    const skillName = toolName.slice(PLACEHOLDER_PREFIX.length);
    const exists = allSkills.some((s) => s.name === skillName);
    return exists ? skillName : null;
}
