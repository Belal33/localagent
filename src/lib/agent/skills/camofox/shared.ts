import { Camoufox } from "camoufox-js";
import type { Browser, Page, BrowserContext } from "playwright-core";

// ─── Configuration ──────────────────────────────────────────────────────────

const HEADLESS = process.env.NODE_ENV === "production";

// ─── Browser Lifecycle ──────────────────────────────────────────────────────

let browser: Browser | null = null;
let context: BrowserContext | null = null;

/**
 * Lazily launches the Camoufox browser on first use.
 * Reuses the same browser instance across all tool calls.
 */
export async function getBrowser(): Promise<Browser> {
    if (browser && browser.isConnected()) return browser;

    console.log("[camofox] Launching Camoufox browser…");
    browser = await Camoufox({
        headless: HEADLESS,
        os: "linux",
    }) as unknown as Browser;
    console.log("[camofox] Browser launched.");
    return browser!;
}

/**
 * Returns a shared browser context (isolated cookies/storage).
 */
export async function getContext(): Promise<BrowserContext> {
    if (context) return context;
    const b = await getBrowser();
    context = await b.newContext();
    return context;
}

/**
 * Opens a new page in the shared context.
 */
export async function newPage(): Promise<Page> {
    const ctx = await getContext();
    return ctx.newPage();
}

// ─── Page Registry ──────────────────────────────────────────────────────────
// Maps tab IDs to Playwright Page objects so the agent can refer to them.

const pages = new Map<string, Page>();
let nextId = 1;

export function registerPage(page: Page): string {
    const id = `tab_${nextId++}`;
    pages.set(id, page);
    return id;
}

export function getPage(tabId: string): Page | undefined {
    return pages.get(tabId);
}

export function removePage(tabId: string): boolean {
    return pages.delete(tabId);
}

export function listPages(): Array<{ tabId: string; url: string }> {
    const result: Array<{ tabId: string; url: string }> = [];
    for (const [id, page] of pages) {
        try {
            result.push({ tabId: id, url: page.url() });
        } catch {
            // Page may have been closed externally
            pages.delete(id);
        }
    }
    return result;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

export async function closeBrowser(): Promise<void> {
    for (const [id, page] of pages) {
        try { await page.close(); } catch { /* ignore */ }
        pages.delete(id);
    }
    if (context) {
        try { await context.close(); } catch { /* ignore */ }
        context = null;
    }
    if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
        browser = null;
    }
}
