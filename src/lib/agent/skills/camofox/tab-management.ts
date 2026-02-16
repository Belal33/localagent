import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { newPage, registerPage, getPage, removePage, listPages } from "./shared";

// ─── Tab Lifecycle Tools ────────────────────────────────────────────────────

const createTab = new DynamicStructuredTool({
    name: "camofox_create_tab",
    description:
        "Open a new browser tab in the anti-detect CamoFox browser and navigate to a URL. " +
        "Returns a tab ID to use with other camofox tools (snapshot, click, type, etc.).",
    schema: z.object({
        url: z.string().describe("URL to open"),
    }),
    func: async ({ url }) => {
        try {
            const page = await newPage();
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
            const tabId = registerPage(page);
            const title = await page.title();
            return `Tab created: ${tabId}\nURL: ${page.url()}\nTitle: ${title}`;
        } catch (error: any) {
            return `Failed to create tab: ${error.message}`;
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
            return tabs.map((t) => `• ${t.tabId}: ${t.url}`).join("\n");
        } catch (error: any) {
            return `Failed to list tabs: ${error.message}`;
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
        } catch (error: any) {
            return `Failed to close tab: ${error.message}`;
        }
    },
});

export const tabManagementTools = [createTab, listTabs, closeTab];
