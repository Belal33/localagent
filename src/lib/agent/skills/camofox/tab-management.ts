import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { newPage, registerPage, getPage, removePage, listPages } from "./shared";

// ─── Tab Lifecycle Tools ────────────────────────────────────────────────────

const createTab = new DynamicStructuredTool({
    name: "camofox_create_tab",
    description:
        "Open a new browser tab in the anti-detect CamoFox browser and navigate to a URL. " +
        "Optionally pass a `sessionLabel` to reuse a previously saved login session " +
        "(e.g. 'github', 'gmail-work'). If no label is given, an anonymous context is used. " +
        "Returns a tab ID for other camofox_* tools.",
    schema: z.object({
        url: z.string().describe("URL to open"),
        sessionLabel: z
            .string()
            .optional()
            .describe(
                "Optional session label. If a saved session exists, cookies/localStorage are restored so the user stays logged in. Use camofox_list_sessions to see available labels.",
            ),
    }),
    func: async ({ url, sessionLabel }) => {
        try {
            const page = await newPage(sessionLabel);
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
            const tabId = registerPage(page, sessionLabel);
            const title = await page.title();
            return `Tab created: ${tabId}\nSession: ${sessionLabel ?? "(anonymous)"}\nURL: ${page.url()}\nTitle: ${title}`;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to create tab: ${msg}`;
        }
    },
});

const listTabs = new DynamicStructuredTool({
    name: "camofox_list_tabs",
    description: "List all open browser tabs in the CamoFox browser.",
    schema: z.object({}),
    func: async () => {
        try {
            const tabs = listPages();
            if (tabs.length === 0) return "No open tabs.";
            return tabs.map((t) => `• ${t.tabId} [${t.label}]: ${t.url}`).join("\n");
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to list tabs: ${msg}`;
        }
    },
});

const closeTab = new DynamicStructuredTool({
    name: "camofox_close_tab",
    description: "Close an open browser tab by its tab ID.",
    schema: z.object({
        tabId: z.string().describe("The tab ID to close (e.g. tab_1)"),
    }),
    func: async ({ tabId }) => {
        try {
            const page = getPage(tabId);
            if (!page) return `Tab ${tabId} not found.`;
            await page.close();
            removePage(tabId);
            return `Tab ${tabId} closed.`;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to close tab: ${msg}`;
        }
    },
});

export const tabManagementTools = [createTab, listTabs, closeTab];
