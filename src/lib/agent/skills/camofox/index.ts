import { Skill } from "../index";
import { tabManagementTools } from "./tab-management";
import { pageInteractionTools } from "./page-interaction";
import { sessionManagementTools } from "./session-management";
import { closeBrowser } from "./shared";

// ─── CamoFox Browser Skill ─────────────────────────────────────────────────

export const camofoxSkill: Skill = {
    name: "camofox",
    description:
        "Anti-detect web browsing powered by CamoFox (Firefox-based). " +
        "Bypasses bot detection on Google, Cloudflare, and more. " +
        "Browse any website, take accessibility snapshots, click, type, scroll, " +
        "take screenshots, and use search macros (@google_search, @youtube_search, etc.). " +
        "Supports persistent logged-in sessions (camofox_save_session / sessionLabel on " +
        "camofox_create_tab) and an encrypted credential vault (camofox_save_credential, " +
        "camofox_login_with_credential) so the agent can operate the user's accounts. " +
        "The CamoFox server starts automatically on first use.",
    tools: [
        ...tabManagementTools,
        ...pageInteractionTools,
        ...sessionManagementTools,
    ],
    alwaysActive: false,
    /**
     * Each fresh activation closes any pre-existing browser so that
     * camofox_create_tab launches with the latest imported Firefox cookies.
     * Without this, a browser left running from an earlier turn keeps stale
     * cookies and the agent appears logged out even after a refresh.
     */
    onActivate: async () => {
        await closeBrowser();
        return "Browser was reset to pick up the latest cookies.";
    },
};
