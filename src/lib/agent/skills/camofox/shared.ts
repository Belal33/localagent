import { Camoufox } from "camoufox-js";
import type { Browser, Page, BrowserContext } from "playwright-core";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { encrypt, decrypt, isEncryptionAvailable } from "./crypto";
import { IMPORTED_COOKIES_LABEL } from "./profile-import";

// ─── Configuration ──────────────────────────────────────────────────────────

// Always headless — the agent never needs a visible window. Login sessions
// come from imported Firefox cookies or saved storageState files.
const HEADLESS = true;

// Encrypted storageState files live here (on the bind-mounted volume).
export const SESSIONS_DIR =
    process.env.CAMOFOX_SESSIONS_DIR ?? "/home/agent_worker/workspace/.camofox-sessions";

const DEFAULT_LABEL = "__default__";

// ─── Browser Lifecycle ──────────────────────────────────────────────────────

let browser: Browser | null = null;

// One BrowserContext per session label — allows the agent to operate multiple
// accounts at the same time (e.g. "github", "gmail-work", "__default__").
const contexts = new Map<string, BrowserContext>();

export async function getBrowser(): Promise<Browser> {
    if (browser && browser.isConnected()) return browser;
    console.log("[camofox] Launching Camoufox browser (headless)…");
    browser = await Camoufox({
        headless: HEADLESS,
        os: "linux",
    }) as unknown as Browser;
    console.log("[camofox] Browser launched.");
    return browser!;
}

// ─── StorageState helpers ────────────────────────────────────────────────────

async function sessionFilePath(label: string): Promise<string> {
    await mkdir(SESSIONS_DIR, { recursive: true });
    const safe = label.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return path.join(SESSIONS_DIR, `${safe}.json.enc`);
}

async function loadStorageState(label: string): Promise<object | null> {
    try {
        const fp = await sessionFilePath(label);
        const enc = await readFile(fp, "utf8");
        return JSON.parse(decrypt(enc.trim()));
    } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") return null;
        throw err;
    }
}

// ─── Context Management ─────────────────────────────────────────────────────

/**
 * Returns the BrowserContext for a session label, creating it on demand.
 *
 * Special behaviour for the default label:
 *   - If Firefox cookies have been imported (via the Settings panel), they are
 *     loaded automatically so the agent is already logged into every site you
 *     use on your host browser.
 *   - If a __default__ storageState file also exists it takes precedence.
 *
 * For any other label the saved encrypted storageState is loaded if present.
 */
export async function getContext(label: string = DEFAULT_LABEL): Promise<BrowserContext> {
    const existing = contexts.get(label);
    if (existing) return existing;

    const b = await getBrowser();

    // Determine which storageState to load:
    //   1. The label's own saved session (highest priority)
    //   2. For the default label: fall back to imported Firefox cookies
    let storageState = await loadStorageState(label);
    if (!storageState && label === DEFAULT_LABEL) {
        storageState = await loadStorageState(IMPORTED_COOKIES_LABEL);
        if (storageState) {
            console.log("[camofox] Loaded imported Firefox cookies into default context.");
        }
    } else if (storageState) {
        console.log(`[camofox] Restored saved session for "${label}".`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = storageState
        ? await b.newContext({ storageState: storageState as any })
        : await b.newContext();

    contexts.set(label, ctx);
    return ctx;
}

export async function saveSession(label: string = DEFAULT_LABEL): Promise<string> {
    if (!isEncryptionAvailable()) {
        throw new Error("AGENT_SECRET_KEY is not set; cannot encrypt session.");
    }
    const ctx = contexts.get(label);
    if (!ctx) throw new Error(`No active context for label "${label}". Open a tab first.`);
    const state = await ctx.storageState();
    const fp = await sessionFilePath(label);
    await writeFile(fp, encrypt(JSON.stringify(state)), "utf8");
    return fp;
}

export async function listSessions(): Promise<string[]> {
    try {
        await mkdir(SESSIONS_DIR, { recursive: true });
        const files = await readdir(SESSIONS_DIR);
        return files
            .filter((f) => f.endsWith(".json.enc"))
            .map((f) => f.replace(/\.json\.enc$/, ""))
            // Hide the internal import label from the agent's session list
            .filter((l) => l !== IMPORTED_COOKIES_LABEL);
    } catch {
        return [];
    }
}

export async function deleteSession(label: string): Promise<boolean> {
    try {
        const fp = await sessionFilePath(label);
        await unlink(fp);
        return true;
    } catch {
        return false;
    }
}

export async function newPage(label: string = DEFAULT_LABEL): Promise<Page> {
    const ctx = await getContext(label);
    return ctx.newPage();
}

// ─── Page Registry ──────────────────────────────────────────────────────────

interface TabEntry {
    page: Page;
    label: string;
}

const pages = new Map<string, TabEntry>();
let nextId = 1;

export function registerPage(page: Page, label: string = DEFAULT_LABEL): string {
    const id = `tab_${nextId++}`;
    pages.set(id, { page, label });
    return id;
}

export function getPage(tabId: string): Page | undefined {
    return pages.get(tabId)?.page;
}

export function getPageLabel(tabId: string): string | undefined {
    return pages.get(tabId)?.label;
}

export function removePage(tabId: string): boolean {
    return pages.delete(tabId);
}

export function listPages(): Array<{ tabId: string; url: string; label: string }> {
    const result: Array<{ tabId: string; url: string; label: string }> = [];
    for (const [id, entry] of pages) {
        try {
            result.push({ tabId: id, url: entry.page.url(), label: entry.label });
        } catch {
            pages.delete(id);
        }
    }
    return result;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

export async function closeBrowser(): Promise<void> {
    for (const [id, entry] of pages) {
        try { await entry.page.close(); } catch { /* ignore */ }
        pages.delete(id);
    }
    for (const [, ctx] of contexts) {
        try { await ctx.close(); } catch { /* ignore */ }
    }
    contexts.clear();
    if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
        browser = null;
    }
}
