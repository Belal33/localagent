import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getPage } from "./shared";
import { saveScreenshotArtifact } from "../../screenshot-artifacts";

// ─── Page Interaction Tools ─────────────────────────────────────────────────

const getContent = new DynamicStructuredTool({
    name: "camofox_get_content",
    description:
        "Get the text content of the current page in a tab. " +
        "Returns the visible text (~90% smaller than raw HTML), ideal for reading page content.",
    schema: z.object({
        tabId: z.string().describe("The tab ID"),
        maxLength: z
            .number()
            .default(8000)
            .describe("Max characters to return (default 8000 to save tokens)"),
    }),
    func: async ({ tabId, maxLength }) => {
        try {
            const page = getPage(tabId);
            if (!page) return `Tab ${tabId} not found.`;

            const title = await page.title();
            const url = page.url();
            const content = await page.evaluate(() => document.body.innerText);

            let output = `**URL:** ${url}\n**Title:** ${title}\n\n`;
            output += content.slice(0, maxLength);
            if (content.length > maxLength) {
                output += `\n\n… (truncated, ${content.length} total chars)`;
            }
            return output;
        } catch (error: any) {
            return `Failed to get content: ${error.message}`;
        }
    },
});

const click = new DynamicStructuredTool({
    name: "camofox_click",
    description:
        "Click an element on the page using a CSS selector. " +
        "Use camofox_get_content first to understand the page structure.",
    schema: z.object({
        tabId: z.string().describe("The tab ID"),
        selector: z.string().describe("CSS selector of the element to click (e.g. 'a.btn', '#submit', 'button:has-text(\"Login\")')"),
    }),
    func: async ({ tabId, selector }) => {
        try {
            const page = getPage(tabId);
            if (!page) return `Tab ${tabId} not found.`;

            await page.click(selector, { timeout: 10_000 });
            // Wait for potential navigation
            await page.waitForLoadState("domcontentloaded").catch(() => { });
            return `Clicked "${selector}". Current URL: ${page.url()}`;
        } catch (error: any) {
            return `Failed to click: ${error.message}`;
        }
    },
});

const type = new DynamicStructuredTool({
    name: "camofox_type",
    description:
        "Type text into an input element using a CSS selector. " +
        "Optionally press Enter after typing (useful for search forms).",
    schema: z.object({
        tabId: z.string().describe("The tab ID"),
        selector: z.string().describe("CSS selector of the input element"),
        text: z.string().describe("Text to type"),
        pressEnter: z
            .boolean()
            .default(false)
            .describe("Whether to press Enter after typing"),
    }),
    func: async ({ tabId, selector, text, pressEnter }) => {
        try {
            const page = getPage(tabId);
            if (!page) return `Tab ${tabId} not found.`;

            await page.fill(selector, text);
            if (pressEnter) {
                await page.press(selector, "Enter");
                await page.waitForLoadState("domcontentloaded").catch(() => { });
            }
            return `Typed "${text}" into "${selector}"${pressEnter ? " and pressed Enter" : ""}. Current URL: ${page.url()}`;
        } catch (error: any) {
            return `Failed to type: ${error.message}`;
        }
    },
});

const navigate = new DynamicStructuredTool({
    name: "camofox_navigate",
    description:
        "Navigate a tab to a new URL. Waits for the page to load.",
    schema: z.object({
        tabId: z.string().describe("The tab ID"),
        url: z.string().describe("URL to navigate to"),
    }),
    func: async ({ tabId, url }) => {
        try {
            const page = getPage(tabId);
            if (!page) return `Tab ${tabId} not found.`;

            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
            const title = await page.title();
            return `Navigated to: ${page.url()}\nTitle: ${title}`;
        } catch (error: any) {
            return `Failed to navigate: ${error.message}`;
        }
    },
});

const scroll = new DynamicStructuredTool({
    name: "camofox_scroll",
    description: "Scroll the page in a tab up or down.",
    schema: z.object({
        tabId: z.string().describe("The tab ID"),
        direction: z
            .enum(["up", "down"])
            .default("down")
            .describe("Direction to scroll"),
        pixels: z
            .number()
            .default(500)
            .describe("Number of pixels to scroll"),
    }),
    func: async ({ tabId, direction, pixels }) => {
        try {
            const page = getPage(tabId);
            if (!page) return `Tab ${tabId} not found.`;

            const delta = direction === "down" ? pixels : -pixels;
            await page.evaluate((d) => window.scrollBy(0, d), delta);
            return `Scrolled ${direction} ${pixels}px.`;
        } catch (error: any) {
            return `Failed to scroll: ${error.message}`;
        }
    },
});

const screenshot = new DynamicStructuredTool({
    name: "camofox_screenshot",
    description:
        "Take a screenshot of the current page in a tab. " +
        "Saves the screenshot into the shared workspace screenshots folder and returns the path.",
    schema: z.object({
        tabId: z.string().describe("The tab ID"),
        fullPage: z
            .boolean()
            .default(false)
            .describe("Capture full scrollable page instead of viewport only"),
    }),
    func: async ({ tabId, fullPage }) => {
        try {
            const page = getPage(tabId);
            if (!page) return `Tab ${tabId} not found.`;

            const buffer = await page.screenshot({ fullPage, type: "png" });
            const artifact = await saveScreenshotArtifact(buffer, "camofox");
            return `Screenshot captured for ${page.url()}\nScreenshot available for vision inspection: ${artifact.path}\nScreenshot available in client: ${artifact.url}`;
        } catch (error: any) {
            return `Failed to take screenshot: ${error.message}`;
        }
    },
});

export const pageInteractionTools = [
    getContent,
    click,
    type,
    navigate,
    scroll,
    screenshot,
];
