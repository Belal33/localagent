import { Skill } from "../index";
import { terminalTools } from "./terminal";
import { webSearchTools } from "./web-search";

// ─── Core Skill ─────────────────────────────────────────────────────────────

export const coreSkill: Skill = {
    name: "core",
    description:
        "Core agent capabilities: terminal commands and web search.",
    tools: [...terminalTools, ...webSearchTools],
    alwaysActive: true,
};
