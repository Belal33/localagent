import { Skill } from "../index";
import { tabManagementTools } from "./tab-management";
import { pageInteractionTools } from "./page-interaction";

// ─── CamoFox Browser Skill ─────────────────────────────────────────────────

export const camofoxSkill: Skill = {
    name: "camofox",
    description:
        "Anti-detect web browsing powered by CamoFox (Firefox-based). " +
        "Bypasses bot detection on Google, Cloudflare, and more. " +
        "Browse any website, take accessibility snapshots, click, type, scroll, " +
        "take screenshots, and use search macros (@google_search, @youtube_search, etc.). " +
        "The CamoFox server starts automatically on first use.",
    tools: [...tabManagementTools, ...pageInteractionTools],
    alwaysActive: false,
};
