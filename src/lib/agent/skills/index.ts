import { DynamicStructuredTool } from "@langchain/core/tools";
import { coreSkill } from "./core";
import { filesystemSkill } from "./filesystem";

/**
 * ─── Skill Registry ─────────────────────────────────────────────────────────
 *
 * Skills are groups of related tools that can be activated/deactivated.
 * The "core" skill is always active — it provides the fundamental
 * capabilities the agent needs to operate.
 *
 * Future skills can be added here and toggled on/off per session.
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

/**
 * Returns all tools from active skills.
 * Currently the "core" skill is always active.
 * Future: support enabling/disabling skills per session.
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
